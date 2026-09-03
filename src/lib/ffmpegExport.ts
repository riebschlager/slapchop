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
 * Stream raw RGBA frames into the narrow Rust-owned ffmpeg process. Rust owns
 * the stdin handle so it can send EOF after the final frame and let ffmpeg
 * flush the encoder and container trailer before the completed file is
 * installed.
 *
 * Frame n+1 is drawn while frame n is still crossing the IPC bridge, so the
 * draw and the write overlap. Ordering is preserved by awaiting the previous
 * write before issuing the next, and at most two frames are alive here.
 *
 * This depends on each frame arriving in its own buffer: an in-flight write
 * still refers to the previous frame's bytes while the next frame is drawn.
 * The renderer allocates per readback, so that holds — a reusable readback
 * buffer would need double buffering to stay correct here.
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
    // The write for the previous frame, still in flight while this one draws.
    let inFlight: Promise<unknown> | null = null;
    const settleInFlight = async () => {
      if (!inFlight) return;
      const pending = inFlight;
      inFlight = null;
      await profiler.timeAsync('ipc.writeFrame', () => pending);
    };

    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) {
        // Await rather than abandon: the frame owns bytes Rust is still
        // reading, and cancelling underneath an in-flight write would race it.
        await settleInFlight().catch(() => {});
        await invoke('cancel_native_video_export', { jobId }).catch(() => {});
        jobId = null;
        return false;
      }

      const frame = renderRgbaFrame((startFrame + n) / fps);

      // Ordering: the previous write must complete before the next is issued.
      // Its cost lands in ipc.writeFrame, which now also absorbs whatever
      // ffmpeg could not overlap.
      await settleInFlight();
      profiler.recordBytes('ipc.writeFrame', frame.byteLength);
      inFlight = invoke('write_native_video_frame', frame, {
        headers: { [VIDEO_JOB_HEADER]: jobId as string }
      });

      profiler.countFrame();
      onProgress?.(n + 1, totalFrames);
      // A macrotask turn so the window keeps painting and stays cancellable.
      // Overlapped with the write above rather than serialized after it.
      await profiler.timeAsync('loop.yield', () =>
        new Promise<void>((resolve) => setTimeout(resolve)));
    }
    await settleInFlight();

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
