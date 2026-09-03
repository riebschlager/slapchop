use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, SyncSender},
        Mutex,
    },
    thread::JoinHandle,
};

use serde::Serialize;
use tauri::Manager;

mod ipc_probe;

// .slapchop files opened from Finder (double-click / drag onto Dock icon) arrive
// as RunEvent::Opened, possibly before the webview has loaded. They are queued
// here; the frontend drains the queue on startup and whenever it hears the
// "slapchop://files-opened" ping, so a file is never opened twice.
struct PendingFiles(Mutex<Vec<String>>);

/// Frames held between the frontend and ffmpeg's stdin. Small on purpose: the
/// point is to let ffmpeg encode frame n while frame n+1 crosses the IPC
/// bridge, not to buffer an export. At 1080x1920 each frame is 8.29MB, so the
/// queue plus the frame in the writer's hands caps this side near 25MB.
const FRAME_QUEUE_DEPTH: usize = 2;

struct NativeVideoJob {
    child: Child,
    stderr_thread: JoinHandle<String>,
    /// Bounded hand-off to the writer thread. Dropping it signals EOF.
    frames: Option<SyncSender<Vec<u8>>>,
    /// Owns ffmpeg's stdin and writes queued frames in order.
    writer_thread: Option<JoinHandle<Result<(), String>>>,
    /// Exactly `width * height * 4`. Every frame body must match it, so a
    /// mis-sized write cannot silently shear the raw video stream.
    frame_bytes: usize,
    frames_queued: u32,
    total_frames: u32,
}

impl NativeVideoJob {
    /// Hand one frame to the writer thread. Blocks while the writer is behind,
    /// so OS pipe backpressure still reaches the frontend and frames cannot
    /// accumulate without bound.
    fn queue_frame(&mut self, frame: Vec<u8>) -> Result<(), String> {
        let sender = self
            .frames
            .as_ref()
            .ok_or_else(|| "ffmpeg is no longer accepting export frames.".to_string())?;
        if sender.send(frame).is_err() {
            // The receiver only hangs up when the writer thread has exited,
            // which it does on a write error. Its message is the useful one.
            self.frames = None;
            return Err(self
                .join_writer()
                .unwrap_or_else(|| "ffmpeg stopped accepting export frames.".to_string()));
        }
        self.frames_queued += 1;
        Ok(())
    }

    /// Drain the queue and close ffmpeg's stdin, surfacing a deferred write
    /// error. Writes are asynchronous now, so a failure may not be visible
    /// until the frame that caused it is actually written.
    fn finish_writes(&mut self) -> Result<(), String> {
        self.frames = None;
        match self.join_writer() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn join_writer(&mut self) -> Option<String> {
        match self.writer_thread.take()?.join() {
            Ok(Ok(())) => None,
            Ok(Err(error)) => Some(error),
            Err(_) => Some("The native video writer stopped unexpectedly.".to_string()),
        }
    }

    /// Abandon queued frames and stop ffmpeg. Killing the child first makes a
    /// blocked `write_all` fail, so the writer thread cannot be left parked on
    /// a full pipe.
    fn abort(&mut self) {
        let _ = self.child.kill();
        self.frames = None;
        let _ = self.join_writer();
        let _ = self.child.wait();
    }
}

struct NativeVideoExports(Mutex<HashMap<String, NativeVideoJob>>);

impl Drop for NativeVideoExports {
    fn drop(&mut self) {
        if let Ok(jobs) = self.0.get_mut() {
            for (_, mut job) in jobs.drain() {
                job.abort();
                let _ = job.stderr_thread.join();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeVideoStatus {
    code: Option<i32>,
    stderr: String,
}

static NEXT_EXPORT_ID: AtomicU64 = AtomicU64::new(1);

fn ffmpeg_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the Slapchop executable: {error}"))?;
    let executable_directory = executable
        .parent()
        .ok_or_else(|| "Could not locate the Slapchop executable directory.".to_string())?;
    let directory = if executable_directory.ends_with("deps") {
        executable_directory
            .parent()
            .unwrap_or(executable_directory)
    } else {
        executable_directory
    };
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let path = directory.join(name);
    if !path.is_file() {
        return Err(format!(
            "The bundled ffmpeg sidecar was not found at {}.",
            path.display()
        ));
    }
    Ok(path)
}

fn spawn_native_video_job(
    format: &str,
    fps: u32,
    total_frames: u32,
    width: u32,
    height: u32,
    output_path: &Path,
) -> Result<NativeVideoJob, String> {
    let args = native_video_args(format, fps, total_frames, width, height, output_path)?;
    let mut child = Command::new(ffmpeg_path()?)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the bundled ffmpeg sidecar: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open the ffmpeg input pipe.".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture ffmpeg error output.".to_string())?;
    let stderr_thread = std::thread::spawn(move || {
        let mut message = String::new();
        if let Err(error) = stderr.read_to_string(&mut message) {
            message.push_str(&format!("\nCould not read ffmpeg error output: {error}"));
        }
        message
    });
    // The writer owns stdin for the rest of the job, so dropping this thread's
    // handle at the end of the loop is what sends EOF and makes ffmpeg flush
    // its encoder and write the container trailer.
    let (frames, queue) = sync_channel::<Vec<u8>>(FRAME_QUEUE_DEPTH);
    let writer_thread = std::thread::spawn(move || {
        while let Ok(frame) = queue.recv() {
            stdin
                .write_all(&frame)
                .map_err(|error| format!("Could not send an export frame to ffmpeg: {error}"))?;
        }
        Ok(())
    });

    Ok(NativeVideoJob {
        child,
        stderr_thread,
        frames: Some(frames),
        writer_thread: Some(writer_thread),
        frame_bytes: frame_bytes(width, height)?,
        frames_queued: 0,
        total_frames,
    })
}

/// The exact body size one raw RGBA frame must have. Also the single place
/// that bounds a frame, so an absurd resolution cannot be used to make the
/// webview allocate without limit.
fn frame_bytes(width: u32, height: u32) -> Result<usize, String> {
    if !(16..=7680).contains(&width) || !(16..=7680).contains(&height) {
        return Err("Video dimensions must be between 16 and 7680 pixels.".to_string());
    }
    // yuv420p subsamples by two in both directions, so odd dimensions would be
    // silently padded by ffmpeg and desynchronize the raw stream.
    if width % 2 != 0 || height % 2 != 0 {
        return Err("Video dimensions must be even.".to_string());
    }
    Ok(width as usize * height as usize * 4)
}

fn native_video_args(
    format: &str,
    fps: u32,
    total_frames: u32,
    width: u32,
    height: u32,
    output_path: &Path,
) -> Result<Vec<String>, String> {
    frame_bytes(width, height)?;
    if !(1..=120).contains(&fps) {
        return Err("Video frame rate must be between 1 and 120 fps.".to_string());
    }
    if total_frames == 0 || total_frames > 2_000_000 {
        return Err("Video frame count is outside the supported range.".to_string());
    }
    if !output_path.is_absolute() {
        return Err("The video destination must be an absolute path.".to_string());
    }

    let expected_extension = match format {
        "mp4" => "mp4",
        "webm" => "webm",
        "prores" => "mov",
        _ => return Err(format!("Unsupported native video format: {format}")),
    };
    let extension = output_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != expected_extension {
        return Err(format!(
            "The {format} export destination must use the .{expected_extension} extension."
        ));
    }

    // Leave the main thread room to draw. x264 defaults to about 1.5 threads
    // per core, which starves the renderer once encoding overlaps drawing, and
    // the measured queue has enough slack that a smaller encoder pool still
    // keeps up. See docs/architecture/video-export-benchmark.md.
    let encoder_threads = std::thread::available_parallelism()
        .map(|cores| (cores.get() / 2).max(2))
        .unwrap_or(2);

    let mut args = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        // Raw RGBA in, so neither side spends time on a PNG the encoder would
        // immediately throw away. rawvideo carries no header, so the geometry
        // has to be declared here and enforced per frame on the write path.
        "-f".into(),
        "rawvideo".into(),
        "-pixel_format".into(),
        "rgba".into(),
        "-video_size".into(),
        format!("{width}x{height}"),
        "-framerate".into(),
        fps.to_string(),
        "-i".into(),
        "pipe:0".into(),
        "-frames:v".into(),
        total_frames.to_string(),
        "-an".into(),
        "-threads".into(),
        encoder_threads.to_string(),
    ];
    match format {
        "mp4" => args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ]
            .map(String::from),
        ),
        "webm" => args.extend(
            [
                "-c:v",
                "libvpx-vp9",
                "-crf",
                "30",
                "-b:v",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-row-mt",
                "1",
            ]
            .map(String::from),
        ),
        "prores" => args.extend(
            [
                "-c:v",
                "prores_ks",
                "-profile:v",
                "4444",
                "-pix_fmt",
                "yuva444p10le",
                "-vendor",
                "apl0",
            ]
            .map(String::from),
        ),
        _ => unreachable!(),
    }
    args.push(output_path.to_string_lossy().into_owned());
    Ok(args)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn start_native_video_export(
    format: String,
    fps: u32,
    total_frames: u32,
    width: u32,
    height: u32,
    output_path: String,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<String, String> {
    let output_path = PathBuf::from(output_path);
    let job = spawn_native_video_job(&format, fps, total_frames, width, height, &output_path)?;
    let id = format!(
        "{}-{}",
        std::process::id(),
        NEXT_EXPORT_ID.fetch_add(1, Ordering::Relaxed)
    );
    state
        .0
        .lock()
        .map_err(|_| "The native video export manager is unavailable.".to_string())?
        .insert(id.clone(), job);
    Ok(id)
}

/// Header carrying the job identifier, because the frame itself has to be the
/// whole invoke payload for Tauri to send it as a raw body rather than
/// expanding it into a JSON array of integers.
const VIDEO_JOB_HEADER: &str = "x-slapchop-video-job";

/// Job identifiers are generated as `<pid>-<counter>`. Validating the shape
/// before it is used as a map key keeps an arbitrary header value from
/// reaching further into the export manager than a lookup miss.
fn validate_job_id(raw: &str) -> Result<&str, String> {
    if raw.is_empty() || raw.len() > 64 || !raw.bytes().all(|b| b.is_ascii_digit() || b == b'-') {
        return Err("The native video export job identifier is malformed.".to_string());
    }
    Ok(raw)
}

/// Stream one raw RGBA frame to ffmpeg.
///
/// Deliberately synchronous: the write inherits OS pipe backpressure, and the
/// frontend awaits each call, so frames reach ffmpeg's stdin in order and no
/// more than one frame is ever held on this side.
#[tauri::command]
fn write_native_video_frame(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<(), String> {
    let job_id = request
        .headers()
        .get(VIDEO_JOB_HEADER)
        .ok_or_else(|| "The export frame is missing its job identifier.".to_string())?
        .to_str()
        .map_err(|_| "The native video export job identifier is malformed.".to_string())
        .and_then(validate_job_id)?;

    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err("Export frames must be sent as a raw request body.".to_string());
    };

    let mut jobs = state
        .0
        .lock()
        .map_err(|_| "The native video export manager is unavailable.".to_string())?;
    let job = jobs
        .get_mut(job_id)
        .ok_or_else(|| "The native video export job is no longer running.".to_string())?;

    // rawvideo has no per-frame header, so a short or long body would shift
    // every following frame instead of failing. Reject it here.
    if frame.len() != job.frame_bytes {
        return Err(format!(
            "Expected {} bytes for a raw export frame but received {}.",
            job.frame_bytes,
            frame.len()
        ));
    }
    if job.frames_queued >= job.total_frames {
        return Err("The native video export already received every frame.".to_string());
    }

    // The request only lends its body, so the writer thread needs its own
    // copy. One 8.29MB memcpy per frame buys the overlap between ffmpeg's
    // encode and the next frame's trip across the IPC bridge.
    job.queue_frame(frame.clone())
}

fn wait_for_native_video(mut job: NativeVideoJob) -> Result<NativeVideoStatus, String> {
    // Drain the queue and close stdin. EOF is what tells ffmpeg to flush its
    // encoder and write the container trailer before wait() returns.
    let write_result = job.finish_writes();
    let status = job
        .child
        .wait()
        .map_err(|error| format!("Could not wait for ffmpeg to finish: {error}"))?;
    let stderr = job
        .stderr_thread
        .join()
        .map_err(|_| "The ffmpeg error reader stopped unexpectedly.".to_string())?;
    // A deferred write failure is more specific than a nonzero exit code, but
    // ffmpeg's own message usually explains why the write failed.
    if let Err(error) = write_result {
        return Err(if stderr.trim().is_empty() {
            error
        } else {
            format!("{error}\n{}", stderr.trim())
        });
    }
    Ok(NativeVideoStatus {
        code: status.code(),
        stderr,
    })
}

#[tauri::command]
async fn finish_native_video_export(
    job_id: String,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<NativeVideoStatus, String> {
    let job = state
        .0
        .lock()
        .map_err(|_| "The native video export manager is unavailable.".to_string())?
        .remove(&job_id)
        .ok_or_else(|| "The native video export job is no longer running.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || wait_for_native_video(job))
        .await
        .map_err(|error| format!("The native video finalizer stopped unexpectedly: {error}"))?
}

#[tauri::command]
fn cancel_native_video_export(
    job_id: String,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<(), String> {
    let job = state
        .0
        .lock()
        .map_err(|_| "The native video export manager is unavailable.".to_string())?
        .remove(&job_id);
    if let Some(mut job) = job {
        job.abort();
        let _ = job.stderr_thread.join();
    }
    Ok(())
}

#[tauri::command]
fn take_pending_files(state: tauri::State<'_, PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .manage(NativeVideoExports(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            start_native_video_export,
            write_native_video_frame,
            finish_native_video_export,
            cancel_native_video_export,
            ipc_probe::probe_raw_frame,
            ipc_probe::probe_json_frame,
            ipc_probe::probe_report
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { ref urls } = event {
            use tauri::Emitter;
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if !paths.is_empty() {
                app_handle
                    .state::<PendingFiles>()
                    .0
                    .lock()
                    .unwrap()
                    .extend(paths);
                let _ = app_handle.emit("slapchop://files-opened", ());
            }
        }
        let _ = (&app_handle, &event);
    });
}

#[cfg(test)]
mod tests {
    use super::{
        ffmpeg_path, frame_bytes, native_video_args, spawn_native_video_job, validate_job_id,
        wait_for_native_video,
    };
    use std::{fs, path::Path, process::Command};

    #[test]
    fn builds_h264_args_for_an_absolute_mp4_path() {
        let args =
            native_video_args("mp4", 30, 300, 1080, 1920, Path::new("/tmp/export.mp4")).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    }

    #[test]
    fn rejects_a_mismatched_container_extension() {
        let error = native_video_args("prores", 30, 300, 1080, 1920, Path::new("/tmp/export.mp4"))
            .unwrap_err();
        assert!(error.contains(".mov"));
    }

    #[test]
    fn declares_raw_rgba_input_geometry_for_every_format() {
        for (format, extension) in [("mp4", "mp4"), ("webm", "webm"), ("prores", "mov")] {
            let path = format!("/tmp/export.{extension}");
            let args = native_video_args(format, 30, 300, 720, 1280, Path::new(&path)).unwrap();
            assert!(args.windows(2).any(|pair| pair == ["-f", "rawvideo"]));
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-pixel_format", "rgba"]));
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-video_size", "720x1280"]));
            // A leftover PNG decoder would make ffmpeg reject the raw stream.
            assert!(!args.iter().any(|arg| arg == "image2pipe"));
            assert!(!args.iter().any(|arg| arg == "png"));
        }
    }

    #[test]
    fn prores_keeps_its_alpha_pixel_format() {
        let args =
            native_video_args("prores", 30, 90, 540, 960, Path::new("/tmp/export.mov")).unwrap();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-pix_fmt", "yuva444p10le"]));
    }

    #[test]
    fn caps_encoder_threads_so_the_renderer_keeps_cpu() {
        let args =
            native_video_args("mp4", 30, 300, 1080, 1920, Path::new("/tmp/export.mp4")).unwrap();
        let threads = args
            .windows(2)
            .find(|pair| pair[0] == "-threads")
            .map(|pair| pair[1].parse::<usize>().unwrap())
            .expect("-threads was not passed");
        let cores = std::thread::available_parallelism().map_or(2, |c| c.get());
        assert!(threads >= 2, "at least two encoder threads");
        assert!(threads <= cores.max(2), "must not exceed the core count");
    }

    #[test]
    fn frame_bytes_matches_rgba_and_rejects_unusable_geometry() {
        assert_eq!(frame_bytes(1080, 1920), Ok(1080 * 1920 * 4));
        assert!(frame_bytes(1081, 1920).is_err(), "odd width");
        assert!(frame_bytes(1080, 1921).is_err(), "odd height");
        assert!(frame_bytes(8, 1920).is_err(), "below the minimum");
        assert!(frame_bytes(1080, 10_000).is_err(), "above the maximum");
    }

    #[test]
    fn rejects_odd_dimensions_before_spawning_ffmpeg() {
        let error = native_video_args("mp4", 30, 300, 1081, 1920, Path::new("/tmp/export.mp4"))
            .unwrap_err();
        assert!(error.contains("even"), "{error}");
    }

    #[test]
    fn validates_the_job_identifier_shape() {
        assert_eq!(validate_job_id("4321-7"), Ok("4321-7"));
        assert!(validate_job_id("").is_err());
        assert!(validate_job_id("../etc/passwd").is_err());
        assert!(validate_job_id("4321 7").is_err());
        assert!(validate_job_id(&"1".repeat(65)).is_err());
    }

    /// Decode a finished export back to RGBA so pixel-level claims can be
    /// checked instead of assumed. Returns one frame's worth of bytes at a
    /// time, plus the total frame count.
    fn decode_to_rgba(path: &Path, frame_bytes: usize) -> (Vec<u8>, usize) {
        let decoded = Command::new(ffmpeg_path().unwrap())
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                path.to_str().unwrap(),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        assert_eq!(
            decoded.stdout.len() % frame_bytes,
            0,
            "decoded output is not a whole number of {frame_bytes}-byte frames"
        );
        let frames = decoded.stdout.len() / frame_bytes;
        (decoded.stdout, frames)
    }

    /// A frame whose top half and bottom half differ, so a vertical flip is
    /// detectable, in colors whose channel order is unambiguous after a
    /// round-trip through yuv420p.
    fn split_frame(width: u32, height: u32, alpha: u8) -> Vec<u8> {
        let mut frame = Vec::with_capacity(width as usize * height as usize * 4);
        for y in 0..height {
            for _ in 0..width {
                let top = y < height / 2;
                frame.extend_from_slice(&[
                    if top { 255 } else { 0 },
                    0,
                    if top { 0 } else { 255 },
                    alpha,
                ]);
            }
        }
        frame
    }

    /// End-to-end proof of the raw geometry contract: exact-size RGBA bodies
    /// in, a readable container out with the expected frame count, and the
    /// same orientation and channel order coming back.
    #[test]
    fn streams_raw_rgba_into_a_decodable_mp4() {
        let (width, height, frames) = (32u32, 48u32, 3u32);
        let output = std::env::temp_dir().join(format!(
            "slapchop-raw-video-test-{}.mp4",
            std::process::id()
        ));
        let mut job = spawn_native_video_job("mp4", 30, frames, width, height, &output).unwrap();
        assert_eq!(job.frame_bytes, width as usize * height as usize * 4);

        let frame = split_frame(width, height, 255);
        assert_eq!(frame.len(), job.frame_bytes);
        for _ in 0..frames {
            job.queue_frame(frame.clone()).unwrap();
        }
        let status = wait_for_native_video(job).unwrap();
        assert_eq!(status.code, Some(0), "{}", status.stderr);

        let frame_bytes = width as usize * height as usize * 4;
        let (decoded, decoded_frames) = decode_to_rgba(&output, frame_bytes);
        assert_eq!(decoded_frames, frames as usize, "frame count must be exact");

        // Top-left stays red and bottom-left stays blue: no vertical flip, and
        // R and B were not swapped. Tolerances absorb the yuv420p round-trip.
        let top_left = &decoded[0..3];
        let bottom_row = (height as usize - 1) * width as usize * 4;
        let bottom_left = &decoded[bottom_row..bottom_row + 3];
        assert!(
            top_left[0] > 180 && top_left[2] < 80,
            "expected red at the top, got {top_left:?}"
        );
        assert!(
            bottom_left[2] > 180 && bottom_left[0] < 80,
            "expected blue at the bottom, got {bottom_left:?}"
        );
        fs::remove_file(output).unwrap();
    }

    /// The queue must not silently swallow a frame, and EOF must still reach
    /// ffmpeg once the queue drains.
    #[test]
    fn queued_frames_all_reach_ffmpeg_in_order() {
        let (width, height, frames) = (32u32, 48u32, 12u32);
        let output = std::env::temp_dir().join(format!(
            "slapchop-queue-order-test-{}.mp4",
            std::process::id()
        ));
        let mut job = spawn_native_video_job("mp4", 30, frames, width, height, &output).unwrap();

        // More frames than the queue is deep, so the writer has to keep up
        // while queue_frame blocks rather than dropping anything.
        assert!(frames as usize > super::FRAME_QUEUE_DEPTH);
        for i in 0..frames {
            let alpha = 255 - i as u8;
            job.queue_frame(split_frame(width, height, alpha)).unwrap();
        }
        assert_eq!(job.frames_queued, frames);

        let status = wait_for_native_video(job).unwrap();
        assert_eq!(status.code, Some(0), "{}", status.stderr);
        let frame_bytes = width as usize * height as usize * 4;
        let (_, decoded_frames) = decode_to_rgba(&output, frame_bytes);
        assert_eq!(decoded_frames, frames as usize);
        fs::remove_file(output).unwrap();
    }

    /// Aborting must not leave the writer thread parked on a full pipe.
    #[test]
    fn aborting_releases_the_writer_thread() {
        let (width, height) = (32u32, 48u32);
        let output = std::env::temp_dir().join(format!(
            "slapchop-queue-abort-test-{}.mp4",
            std::process::id()
        ));
        let mut job = spawn_native_video_job("mp4", 30, 600, width, height, &output).unwrap();
        for _ in 0..4 {
            let _ = job.queue_frame(split_frame(width, height, 255));
        }

        job.abort();
        assert!(job.frames.is_none());
        assert!(
            job.writer_thread.is_none(),
            "the writer thread was not joined"
        );
        let _ = job.stderr_thread.join();
        let _ = fs::remove_file(output);
    }

    /// ProRes 4444 is the one format whose alpha has to survive, and it is the
    /// reason the raw input format is rgba rather than a 3-channel layout.
    #[test]
    fn preserves_prores_4444_alpha_through_a_raw_export() {
        let (width, height) = (32u32, 48u32);
        let output = std::env::temp_dir().join(format!(
            "slapchop-raw-prores-test-{}.mov",
            std::process::id()
        ));
        let mut job = spawn_native_video_job("prores", 30, 2, width, height, &output).unwrap();

        let frame = split_frame(width, height, 128);
        for _ in 0..2 {
            job.queue_frame(frame.clone()).unwrap();
        }
        let status = wait_for_native_video(job).unwrap();
        assert_eq!(status.code, Some(0), "{}", status.stderr);

        let frame_bytes = width as usize * height as usize * 4;
        let (decoded, frames) = decode_to_rgba(&output, frame_bytes);
        assert_eq!(frames, 2);
        // Half-transparent in, half-transparent out. ProRes 4444 stores alpha
        // at reduced precision, so this is a range rather than an equality.
        assert!(
            (100..=155).contains(&decoded[3]),
            "expected alpha near 128, got {}",
            decoded[3]
        );
        fs::remove_file(output).unwrap();
    }
}
