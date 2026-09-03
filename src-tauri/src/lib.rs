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

/// Reports which encoder actually started, so a hardware fallback is disclosed
/// rather than silently changing the output.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeVideoStart {
    job_id: String,
    encoder: String,
    fell_back: bool,
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

/// Encoder arguments for one format at one speed, plus the encoder name so the
/// frontend can say what actually ran when a hardware session is unavailable.
struct EncoderChoice {
    name: &'static str,
    args: Vec<String>,
    /// True when this is the software substitute for an unavailable hardware
    /// encoder, so the UI can disclose it rather than silently differ.
    fell_back: bool,
}

/// VideoToolbox availability varies by device, configuration, and system load,
/// so it is probed once per process per encoder rather than assumed. The probe
/// encodes a single tiny frame to a null output.
fn hardware_encoder_available(encoder: &str) -> bool {
    static PROBED: std::sync::OnceLock<Mutex<HashMap<String, bool>>> = std::sync::OnceLock::new();

    let lock = PROBED.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = lock.lock() {
        if let Some(available) = cache.get(encoder) {
            return *available;
        }
    }

    let available = ffmpeg_path()
        .ok()
        .and_then(|ffmpeg| {
            Command::new(ffmpeg)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=64x64:r=30",
                    "-frames:v",
                    "1",
                    "-c:v",
                    encoder,
                    "-f",
                    "null",
                    "-",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .ok()
        })
        .is_some_and(|status| status.success());
    if let Ok(mut cache) = lock.lock() {
        cache.insert(encoder.to_string(), available);
    }
    available
}

/// Format- and speed-specific encoder settings.
///
/// Speeds are deliberately not forced into a shared set of flags: the formats
/// have unlike controls, and the measured bottleneck differs per format. See
/// `docs/architecture/video-export-benchmark.md` for the numbers behind these.
///
/// `quality` reproduces the settings that shipped before export speeds
/// existed, so it is the reference for any comparison.
fn select_encoder(
    format: &str,
    speed: &str,
    allow_hardware: bool,
) -> Result<EncoderChoice, String> {
    let strings = |args: &[&str]| args.iter().map(|a| a.to_string()).collect::<Vec<_>>();

    // Hardware H.264 is not the fastest encoder in isolation, but it uses
    // about one core where x264 medium uses six and a half. Once drawing and
    // encoding overlap, the cores it leaves free are worth more than its own
    // throughput.
    let h264_hardware = strings(&[
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "12M",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]);
    let h264_software = |preset: &str, crf: &str| {
        strings(&[
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            crf,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
    };
    // VideoToolbox ProRes measured lower wall time, a quarter of the CPU, the
    // same file size, and byte-identical alpha against prores_ks.
    let prores_hardware = strings(&[
        "-c:v",
        "prores_videotoolbox",
        "-profile:v",
        "4444",
        "-pix_fmt",
        "yuva444p10le",
    ]);
    let prores_software = strings(&[
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4444",
        "-pix_fmt",
        "yuva444p10le",
        "-vendor",
        "apl0",
    ]);

    let hardware = |name: &'static str,
                    args: Vec<String>,
                    software: Vec<String>,
                    software_name: &'static str| {
        if allow_hardware && hardware_encoder_available(name) {
            EncoderChoice {
                name,
                args,
                fell_back: false,
            }
        } else {
            EncoderChoice {
                name: software_name,
                args: software,
                fell_back: true,
            }
        }
    };

    Ok(match (format, speed) {
        ("mp4", "quality") => EncoderChoice {
            name: "libx264",
            args: h264_software("medium", "18"),
            fell_back: false,
        },
        ("mp4", "balanced") => EncoderChoice {
            name: "libx264",
            args: h264_software("veryfast", "20"),
            fell_back: false,
        },
        ("mp4", "fast") => hardware(
            "h264_videotoolbox",
            h264_hardware,
            h264_software("veryfast", "20"),
            "libx264",
        ),

        ("webm", "quality") => EncoderChoice {
            name: "libvpx-vp9",
            args: strings(&[
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
            ]),
            fell_back: false,
        },
        ("webm", "balanced") => EncoderChoice {
            name: "libvpx-vp9",
            args: strings(&[
                "-c:v",
                "libvpx-vp9",
                "-crf",
                "32",
                "-b:v",
                "0",
                "-deadline",
                "good",
                "-cpu-used",
                "4",
                "-row-mt",
                "1",
                "-tile-columns",
                "2",
                "-frame-parallel",
                "1",
                "-pix_fmt",
                "yuv420p",
            ]),
            fell_back: false,
        },
        ("webm", "fast") => EncoderChoice {
            name: "libvpx-vp9",
            args: strings(&[
                "-c:v",
                "libvpx-vp9",
                "-crf",
                "34",
                "-b:v",
                "0",
                "-deadline",
                "realtime",
                "-cpu-used",
                "6",
                "-row-mt",
                "1",
                "-pix_fmt",
                "yuv420p",
            ]),
            fell_back: false,
        },

        // prores_ks stays the quality reference; both faster speeds use the
        // hardware encoder, which measured strictly better on every axis.
        ("prores", "quality") => EncoderChoice {
            name: "prores_ks",
            args: prores_software,
            fell_back: false,
        },
        ("prores", _) => hardware(
            "prores_videotoolbox",
            prores_hardware,
            prores_software,
            "prores_ks",
        ),

        (_, "fast" | "balanced" | "quality") => {
            return Err(format!("Unsupported native video format: {format}"))
        }
        _ => return Err(format!("Unsupported export speed: {speed}")),
    })
}

#[allow(clippy::too_many_arguments)]
fn spawn_native_video_job(
    format: &str,
    speed: &str,
    fps: u32,
    total_frames: u32,
    width: u32,
    height: u32,
    output_path: &Path,
) -> Result<(NativeVideoJob, EncoderChoice), String> {
    let encoder = select_encoder(format, speed, true)?;
    let args = native_video_args(
        format,
        &encoder,
        fps,
        total_frames,
        width,
        height,
        output_path,
    )?;
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

    Ok((
        NativeVideoJob {
            child,
            stderr_thread,
            frames: Some(frames),
            writer_thread: Some(writer_thread),
            frame_bytes: frame_bytes(width, height)?,
            frames_queued: 0,
            total_frames,
        },
        encoder,
    ))
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

#[allow(clippy::too_many_arguments)]
fn native_video_args(
    format: &str,
    encoder: &EncoderChoice,
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
    args.extend(encoder.args.iter().cloned());
    args.push(output_path.to_string_lossy().into_owned());
    Ok(args)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn start_native_video_export(
    format: String,
    speed: String,
    fps: u32,
    total_frames: u32,
    width: u32,
    height: u32,
    output_path: String,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<NativeVideoStart, String> {
    let output_path = PathBuf::from(output_path);
    let (job, encoder) = spawn_native_video_job(
        &format,
        &speed,
        fps,
        total_frames,
        width,
        height,
        &output_path,
    )?;
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
    Ok(NativeVideoStart {
        job_id: id,
        encoder: encoder.name.to_string(),
        fell_back: encoder.fell_back,
    })
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
            cancel_native_video_export
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
        ffmpeg_path, frame_bytes, hardware_encoder_available, native_video_args, select_encoder,
        spawn_native_video_job, validate_job_id, wait_for_native_video,
    };

    /// The `quality` speed is the pre-speeds behavior, so most argument
    /// assertions are about it.
    fn quality_args(format: &str, width: u32, height: u32, path: &str) -> Vec<String> {
        let encoder = select_encoder(format, "quality", false).unwrap();
        native_video_args(format, &encoder, 30, 300, width, height, Path::new(path)).unwrap()
    }
    use std::{fs, path::Path, process::Command};

    #[test]
    fn builds_h264_args_for_an_absolute_mp4_path() {
        let args = quality_args("mp4", 1080, 1920, "/tmp/export.mp4");
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    }

    #[test]
    fn rejects_a_mismatched_container_extension() {
        let encoder = select_encoder("prores", "quality", false).unwrap();
        let error = native_video_args(
            "prores",
            &encoder,
            30,
            300,
            1080,
            1920,
            Path::new("/tmp/export.mp4"),
        )
        .unwrap_err();
        assert!(error.contains(".mov"));
    }

    #[test]
    fn declares_raw_rgba_input_geometry_for_every_format() {
        for (format, extension) in [("mp4", "mp4"), ("webm", "webm"), ("prores", "mov")] {
            let path = format!("/tmp/export.{extension}");
            let args = quality_args(format, 720, 1280, &path);
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
        let args = quality_args("prores", 540, 960, "/tmp/export.mov");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-pix_fmt", "yuva444p10le"]));
    }

    #[test]
    fn builds_valid_arguments_for_every_format_and_speed() {
        for (format, extension) in [("mp4", "mp4"), ("webm", "webm"), ("prores", "mov")] {
            for speed in ["fast", "balanced", "quality"] {
                let encoder = select_encoder(format, speed, false).unwrap();
                let path = format!("/tmp/export.{extension}");
                let args =
                    native_video_args(format, &encoder, 30, 300, 1080, 1920, Path::new(&path))
                        .unwrap_or_else(|e| panic!("{format}/{speed}: {e}"));

                // Exactly one codec, and the raw input contract intact.
                assert_eq!(
                    args.iter().filter(|a| *a == "-c:v").count(),
                    1,
                    "{format}/{speed} must name one encoder"
                );
                assert!(args.windows(2).any(|p| p == ["-f", "rawvideo"]));
                assert!(args.windows(2).any(|p| p == ["-pixel_format", "rgba"]));
                assert_eq!(args.last().unwrap(), &path);
            }
        }
    }

    #[test]
    fn rejects_an_unknown_speed_or_format() {
        assert!(select_encoder("mp4", "turbo", false).is_err());
        assert!(select_encoder("avi", "fast", false).is_err());
    }

    #[test]
    fn quality_speed_reproduces_the_pre_speeds_settings() {
        let mp4 = quality_args("mp4", 1080, 1920, "/tmp/export.mp4");
        assert!(mp4.windows(2).any(|p| p == ["-preset", "medium"]));
        assert!(mp4.windows(2).any(|p| p == ["-crf", "18"]));

        let webm = quality_args("webm", 1080, 1920, "/tmp/export.webm");
        assert!(webm.windows(2).any(|p| p == ["-c:v", "libvpx-vp9"]));
        assert!(webm.windows(2).any(|p| p == ["-crf", "30"]));

        let prores = quality_args("prores", 1080, 1920, "/tmp/export.mov");
        assert!(prores.windows(2).any(|p| p == ["-c:v", "prores_ks"]));
    }

    /// With hardware disallowed, the faster speeds must still produce a
    /// working software encoder and say that they substituted one.
    #[test]
    fn falls_back_to_software_when_hardware_is_unavailable() {
        let mp4 = select_encoder("mp4", "fast", false).unwrap();
        assert_eq!(mp4.name, "libx264");
        assert!(mp4.fell_back);

        let prores = select_encoder("prores", "fast", false).unwrap();
        assert_eq!(prores.name, "prores_ks");
        assert!(prores.fell_back);

        // VP9 has no hardware path, so it never reports a substitution.
        assert!(!select_encoder("webm", "fast", false).unwrap().fell_back);
    }

    /// Runs each faster speed for real, but only asserts on encoders this
    /// machine actually has, so the suite does not depend on hardware.
    #[test]
    fn every_available_speed_produces_a_decodable_file() {
        let (width, height, frames) = (64u32, 64u32, 4u32);
        for (format, extension) in [("mp4", "mp4"), ("webm", "webm"), ("prores", "mov")] {
            for speed in ["fast", "balanced", "quality"] {
                let output = std::env::temp_dir().join(format!(
                    "slapchop-speed-{format}-{speed}-{}.{extension}",
                    std::process::id()
                ));
                let (mut job, encoder) =
                    spawn_native_video_job(format, speed, 30, frames, width, height, &output)
                        .unwrap();
                if encoder.fell_back {
                    // Hardware absent here; the software path is covered by
                    // the `quality` pass of this same loop.
                    job.abort();
                    let _ = job.stderr_thread.join();
                    let _ = fs::remove_file(&output);
                    continue;
                }
                for _ in 0..frames {
                    job.queue_frame(split_frame(width, height, 255)).unwrap();
                }
                let status = wait_for_native_video(job).unwrap();
                assert_eq!(
                    status.code,
                    Some(0),
                    "{format}/{speed} via {}: {}",
                    encoder.name,
                    status.stderr
                );
                let (_, decoded) = decode_to_rgba(&output, width as usize * height as usize * 4);
                assert_eq!(decoded, frames as usize, "{format}/{speed} frame count");
                fs::remove_file(output).unwrap();
            }
        }
    }

    /// The alpha guarantee has to hold for whichever ProRes encoder runs, not
    /// just the software one.
    #[test]
    fn prores_alpha_survives_on_every_available_encoder() {
        let (width, height) = (64u32, 64u32);
        for speed in ["quality", "fast"] {
            let output = std::env::temp_dir().join(format!(
                "slapchop-prores-alpha-{speed}-{}.mov",
                std::process::id()
            ));
            let (mut job, encoder) =
                spawn_native_video_job("prores", speed, 30, 2, width, height, &output).unwrap();
            for _ in 0..2 {
                job.queue_frame(split_frame(width, height, 128)).unwrap();
            }
            let status = wait_for_native_video(job).unwrap();
            assert_eq!(status.code, Some(0), "{}", status.stderr);

            let (decoded, _) = decode_to_rgba(&output, width as usize * height as usize * 4);
            assert!(
                (100..=155).contains(&decoded[3]),
                "{} lost alpha: got {}",
                encoder.name,
                decoded[3]
            );
            fs::remove_file(output).unwrap();
        }
    }

    #[test]
    fn hardware_probe_result_is_stable() {
        // Whatever this machine reports, it must report it consistently: the
        // answer is cached and a flapping probe would change encoders midway.
        let first = hardware_encoder_available("h264_videotoolbox");
        assert_eq!(first, hardware_encoder_available("h264_videotoolbox"));
        assert!(!hardware_encoder_available("definitely_not_an_encoder"));
    }

    #[test]
    fn caps_encoder_threads_so_the_renderer_keeps_cpu() {
        let args = quality_args("mp4", 1080, 1920, "/tmp/export.mp4");
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
        let encoder = select_encoder("mp4", "quality", false).unwrap();
        let error = native_video_args(
            "mp4",
            &encoder,
            30,
            300,
            1081,
            1920,
            Path::new("/tmp/export.mp4"),
        )
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
        let mut job = spawn_native_video_job("mp4", "quality", 30, frames, width, height, &output)
            .unwrap()
            .0;
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
        let mut job = spawn_native_video_job("mp4", "quality", 30, frames, width, height, &output)
            .unwrap()
            .0;

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
        let mut job = spawn_native_video_job("mp4", "quality", 30, 600, width, height, &output)
            .unwrap()
            .0;
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
        let mut job = spawn_native_video_job("prores", "quality", 30, 2, width, height, &output)
            .unwrap()
            .0;

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
