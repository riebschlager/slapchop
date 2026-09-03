//! Throwaway IPC transport probe for Phase 2 of
//! `docs/architecture/video-export-performance.md`.
//!
//! The Phase 0 baseline showed frame transport, not encoding, dominates native
//! video export. Tauri's injected IPC script serializes a `Uint8Array` nested
//! in a payload object via `Array.from` + `JSON.stringify`, so every frame
//! becomes a JSON array of integers; a payload that *is* a buffer is sent as
//! `application/octet-stream` untouched. These commands measure both shapes
//! with no encoder attached, so the raw path's ceiling can be compared against
//! the bandwidth a full-resolution export actually needs before the ffmpeg
//! input format is reworked.
//!
//! This module is a measurement tool, not a feature. It is inert in release
//! builds, and it should be deleted once Phase 2 lands.

use tauri::ipc::{InvokeBody, Request};

/// Matches the cap on `write_native_video_frame` so the probe cannot be used to
/// push a larger body than the real path accepts.
const MAX_PROBE_BYTES: usize = 64 * 1024 * 1024;

fn ensure_enabled() -> Result<(), String> {
    if cfg!(debug_assertions) {
        Ok(())
    } else {
        Err("The IPC transport probe is only available in development builds.".to_string())
    }
}

fn check_len(len: usize) -> Result<usize, String> {
    if len == 0 || len > MAX_PROBE_BYTES {
        return Err(format!(
            "The probe payload has an invalid size: {len} bytes."
        ));
    }
    Ok(len)
}

/// Raw `application/octet-stream` body — the transport Phase 2 would adopt.
/// Reads the length and discards the bytes, so the timing is transport only.
#[tauri::command]
pub fn probe_raw_frame(request: Request<'_>) -> Result<usize, String> {
    ensure_enabled()?;
    match request.body() {
        InvokeBody::Raw(bytes) => check_len(bytes.len()),
        InvokeBody::Json(_) => Err("The probe expected a raw body but received JSON.".to_string()),
    }
}

/// The shape `write_native_video_frame` uses today: the frame as a named
/// argument beside another field, which forces the JSON path.
#[tauri::command]
pub fn probe_json_frame(job_id: String, frame: Vec<u8>) -> Result<usize, String> {
    ensure_enabled()?;
    let _ = job_id;
    check_len(frame.len())
}

/// Print one probe result line to the process stdout. Release builds have no
/// devtools console, so this is how a probe run reports from a packaged app.
#[tauri::command]
pub fn probe_report(line: String) -> Result<(), String> {
    ensure_enabled()?;
    println!(
        "[ipc-probe] {}",
        line.chars().take(2000).collect::<String>()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{check_len, MAX_PROBE_BYTES};

    #[test]
    fn rejects_empty_and_oversized_payloads() {
        assert!(check_len(0).is_err());
        assert!(check_len(MAX_PROBE_BYTES + 1).is_err());
    }

    #[test]
    fn accepts_a_full_resolution_rgba_frame() {
        assert_eq!(check_len(1080 * 1920 * 4), Ok(1080 * 1920 * 4));
    }
}
