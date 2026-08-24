use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
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

struct NativeVideoJob {
    child: Child,
    stderr_thread: JoinHandle<String>,
}

struct NativeVideoExports(Mutex<HashMap<String, NativeVideoJob>>);

impl Drop for NativeVideoExports {
    fn drop(&mut self) {
        if let Ok(jobs) = self.0.get_mut() {
            for (_, mut job) in jobs.drain() {
                let _ = job.child.kill();
                let _ = job.child.wait();
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
    output_path: &Path,
) -> Result<NativeVideoJob, String> {
    let args = native_video_args(format, fps, total_frames, output_path)?;
    let mut child = Command::new(ffmpeg_path()?)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the bundled ffmpeg sidecar: {error}"))?;
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
    Ok(NativeVideoJob {
        child,
        stderr_thread,
    })
}

fn native_video_args(
    format: &str,
    fps: u32,
    total_frames: u32,
    output_path: &Path,
) -> Result<Vec<String>, String> {
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

    let mut args = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-f".into(),
        "image2pipe".into(),
        "-framerate".into(),
        fps.to_string(),
        "-vcodec".into(),
        "png".into(),
        "-i".into(),
        "pipe:0".into(),
        "-frames:v".into(),
        total_frames.to_string(),
        "-an".into(),
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
fn start_native_video_export(
    format: String,
    fps: u32,
    total_frames: u32,
    output_path: String,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<String, String> {
    let output_path = PathBuf::from(output_path);
    let job = spawn_native_video_job(&format, fps, total_frames, &output_path)?;
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

#[tauri::command]
fn write_native_video_frame(
    job_id: String,
    frame: Vec<u8>,
    state: tauri::State<'_, NativeVideoExports>,
) -> Result<(), String> {
    if frame.is_empty() || frame.len() > 64 * 1024 * 1024 {
        return Err("The encoded export frame has an invalid size.".to_string());
    }
    let mut jobs = state
        .0
        .lock()
        .map_err(|_| "The native video export manager is unavailable.".to_string())?;
    let job = jobs
        .get_mut(&job_id)
        .ok_or_else(|| "The native video export job is no longer running.".to_string())?;
    job.child
        .stdin
        .as_mut()
        .ok_or_else(|| "ffmpeg is no longer accepting export frames.".to_string())?
        .write_all(&frame)
        .map_err(|error| format!("Could not send an export frame to ffmpeg: {error}"))
}

fn wait_for_native_video(mut job: NativeVideoJob) -> Result<NativeVideoStatus, String> {
    // Taking and dropping stdin sends EOF, which tells ffmpeg to flush its
    // encoder and write the container trailer before wait() returns.
    drop(job.child.stdin.take());
    let status = job
        .child
        .wait()
        .map_err(|error| format!("Could not wait for ffmpeg to finish: {error}"))?;
    let stderr = job
        .stderr_thread
        .join()
        .map_err(|_| "The ffmpeg error reader stopped unexpectedly.".to_string())?;
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
        job.child
            .kill()
            .map_err(|error| format!("Could not stop ffmpeg: {error}"))?;
        let _ = job.child.wait();
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
    use super::{ffmpeg_path, native_video_args, spawn_native_video_job, wait_for_native_video};
    use std::{fs, io::Write, path::Path, process::Command};

    #[test]
    fn builds_h264_args_for_an_absolute_mp4_path() {
        let args = native_video_args("mp4", 30, 300, Path::new("/tmp/export.mp4")).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    }

    #[test]
    fn rejects_a_mismatched_container_extension() {
        let error = native_video_args("prores", 30, 300, Path::new("/tmp/export.mp4")).unwrap_err();
        assert!(error.contains(".mov"));
    }

    #[test]
    fn closing_stdin_finalizes_a_streamed_mp4() {
        let ffmpeg = ffmpeg_path().unwrap();
        let png = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=32x48:r=30",
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "png",
                "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(png.status.success());

        let output = std::env::temp_dir().join(format!(
            "slapchop-native-video-test-{}.mp4",
            std::process::id()
        ));
        let mut job = spawn_native_video_job("mp4", 30, 3, &output).unwrap();
        for _ in 0..3 {
            job.child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(&png.stdout)
                .unwrap();
        }
        let status = wait_for_native_video(job).unwrap();
        assert_eq!(status.code, Some(0), "{}", status.stderr);
        assert!(fs::metadata(&output).unwrap().len() > 0);
        fs::remove_file(output).unwrap();
    }
}
