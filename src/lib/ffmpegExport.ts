import type { FrameExportOptions, VideoFormat } from './videoExport';
import { getExportProfiler } from './exportProfiler';

export type NativeVideoFormat = VideoFormat | 'prores';

/**
 * The native path takes pixels rather than a canvas: ffmpeg reads rawvideo, so
 * a PNG in between would only be encoded here to be decoded there.
 */
export interface NativeVideoExportOptions
  extends Omit<FrameExportOptions, 'renderFrame'> {
  savePath: string;
  /** RGBA bytes for time t, exactly `width * height * 4`. */
  renderRgbaFrame: (t: number) => Uint8Array;
  onFinalizing?: () => void;
}

/**
 * Tauri sends a payload that *is* a buffer view as an octet-stream body, but
 * expands one nested in an object into a JSON array of integers. So the frame
 * has to be the entire payload, and the job identifier travels in a header.
 */
const VIDEO_JOB_HEADER = 'x-slapchop-video-job';

export function getPartialVideoPath(savePath: string, id: string): string {
  const slash = Math.max(savePath.lastIndexOf('/'), savePath.lastIndexOf('\\'));
  const dot = savePath.lastIndexOf('.');
  const hasExtension = dot > slash;
  return hasExtension
    ? `${savePath.slice(0, dot)}.slapchop-partial-${id}${savePath.slice(dot)}`
    : `${savePath}.slapchop-partial-${id}`;
}

/**
 * Stream PNG frames into the narrow Rust-owned ffmpeg process. Rust owns the
 * stdin handle so it can send EOF after the final frame and let ffmpeg flush
 * the encoder and container trailer before the completed file is installed.
 */
export async function exportNativeVideo(
  format: NativeVideoFormat,
  opts: NativeVideoExportOptions
): Promise<boolean> {
  const {
    width, height, fps, duration, startTime = 0, renderRgbaFrame, savePath,
    onProgress, onFinalizing, isCancelled
  } = opts;
  const totalFrames = Math.round(fps * duration);
  const startFrame = Math.round(Math.max(0, startTime) * fps);
  const partialPath = getPartialVideoPath(savePath, crypto.randomUUID());
  const { invoke } = await import('@tauri-apps/api/core');
  const { remove, rename } = await import('@tauri-apps/plugin-fs');
  let jobId: string | null = null;
  const profiler = getExportProfiler();

  try {
    jobId = await profiler.timeAsync('ffmpeg.start', () =>
      invoke<string>('start_native_video_export', {
        format,
        fps,
        totalFrames,
        width,
        height,
        outputPath: partialPath
      }));
    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) {
        await invoke('cancel_native_video_export', { jobId }).catch(() => {});
        jobId = null;
        return false;
      }

      const frame = renderRgbaFrame((startFrame + n) / fps);
      // Covers Tauri IPC plus the Rust-side pipe write, so it absorbs ffmpeg's
      // backpressure once the OS pipe buffer fills. Pairing it with the payload
      // size is what separates a per-byte transport cost from encoder stalls.
      profiler.recordBytes('ipc.writeFrame', frame.byteLength);
      await profiler.timeAsync('ipc.writeFrame', () =>
        invoke('write_native_video_frame', frame, {
          headers: { [VIDEO_JOB_HEADER]: jobId as string }
        }));
      profiler.countFrame();
      onProgress?.(n + 1, totalFrames);
      await profiler.timeAsync('loop.yield', () =>
        new Promise<void>((resolve) => setTimeout(resolve)));
    }

    onFinalizing?.();
    const status = await profiler.timeAsync('ffmpeg.finalize', () =>
      invoke<{ code: number | null; stderr: string }>(
        'finish_native_video_export',
        { jobId }
      ));
    jobId = null;
    if (status.code !== 0) {
      const detail = status.stderr.trim() || 'ffmpeg did not provide an error message.';
      throw new Error(`ffmpeg exited with code ${status.code}: ${detail.slice(-1000)}`);
    }
    await rename(partialPath, savePath);
    return true;
  } catch (error) {
    if (jobId) await invoke('cancel_native_video_export', { jobId }).catch(() => {});
    throw error;
  } finally {
    await remove(partialPath).catch(() => {});
  }
}
