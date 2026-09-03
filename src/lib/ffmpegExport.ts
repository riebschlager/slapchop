import type { FrameExportOptions, VideoFormat } from './videoExport';
import { getExportProfiler } from './exportProfiler';

export type NativeVideoFormat = VideoFormat | 'prores';

/**
 * Codec speed, meant per format rather than as a shared set of flags: the
 * formats expose unlike controls and their bottlenecks differ. `quality` is
 * the settings that shipped before speeds existed, so it is the reference for
 * any comparison. Only encoder settings change — never resolution, frame rate,
 * effects, or frame-exact timing.
 */
export type ExportSpeed = 'fast' | 'balanced' | 'quality';

export const EXPORT_SPEEDS: ExportSpeed[] = ['fast', 'balanced', 'quality'];

interface NativeVideoStart {
  jobId: string;
  encoder: string;
  /** True when a hardware encoder was unavailable and software ran instead. */
  fellBack: boolean;
}

/**
 * The native path takes pixels rather than a canvas: ffmpeg reads rawvideo, so
 * a PNG in between would only be encoded here to be decoded there.
 */
export interface NativeVideoExportOptions
  extends Omit<FrameExportOptions, 'renderFrame'> {
  savePath: string;
  speed: ExportSpeed;
  /** RGBA bytes for time t, exactly `width * height * 4`. */
  renderRgbaFrame: (t: number) => Uint8Array;
  onFinalizing?: () => void;
  /** Called only when the requested hardware encoder was unavailable. */
  onEncoderFallback?: (encoder: string) => void;
}

/**
 * Tauri sends a payload that *is* a buffer view as an octet-stream body, but
 * expands one nested in an object into a JSON array of integers. So the frame
 * has to be the entire payload, and the job identifier travels in a header.
 */
const VIDEO_JOB_HEADER = 'x-slapchop-video-job';

/** Frames between UI yields. At ~42ms a frame this keeps cancel latency ~0.3s. */
const UI_YIELD_INTERVAL = 8;

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
    width, height, fps, duration, startTime = 0, renderRgbaFrame, savePath, speed,
    onProgress, onFinalizing, onEncoderFallback, isCancelled
  } = opts;
  const totalFrames = Math.round(fps * duration);
  const startFrame = Math.round(Math.max(0, startTime) * fps);
  const partialPath = getPartialVideoPath(savePath, crypto.randomUUID());
  const { invoke } = await import('@tauri-apps/api/core');
  const { remove, rename } = await import('@tauri-apps/plugin-fs');
  let jobId: string | null = null;
  const profiler = getExportProfiler();

  try {
    const started = await profiler.timeAsync('ffmpeg.start', () =>
      invoke<NativeVideoStart>('start_native_video_export', {
        format,
        speed,
        fps,
        totalFrames,
        width,
        height,
        outputPath: partialPath
      }));
    jobId = started.jobId;
    // Hardware availability varies by device and system load, so a fallback is
    // disclosed rather than silently changing the output.
    if (started.fellBack) onEncoderFallback?.(started.encoder);
    // The write for the previous frame, still in flight while this one draws.
    let inFlight: Promise<unknown> | null = null;
    const settleInFlight = async () => {
      if (!inFlight) return;
      const pending = inFlight;
      inFlight = null;
      await profiler.timeAsync('ipc.drain', () => pending);
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

      // `loop.frame` brackets the whole iteration, so anything the individual
      // stages do not account for stays visible instead of vanishing into the
      // gap between them.
      await profiler.timeAsync('loop.frame', async () => {
        const frame = renderRgbaFrame((startFrame + n) / fps);

        // Ordering: the previous write must complete before the next is
        // issued. `ipc.drain` is therefore the backpressure the queue could
        // not absorb.
        await settleInFlight();

        // Issuing the invoke is not free: the request is built and the frame
        // handed to fetch. Timed separately from the wait so overlap cannot
        // hide it.
        profiler.recordBytes('ipc.submit', frame.byteLength);
        inFlight = profiler.time('ipc.submit', () =>
          invoke('write_native_video_frame', frame, {
            headers: { [VIDEO_JOB_HEADER]: jobId as string }
          }));

        profiler.countFrame();
        onProgress?.(n + 1, totalFrames);
        // Awaiting the previous write already turns the event loop, so this
        // only needs to guarantee a macrotask often enough that the window
        // keeps painting and the cancel button still lands. Every frame cost
        // ~3ms of a ~42ms frame once encoding began competing for CPU.
        if (n % UI_YIELD_INTERVAL === 0) {
          await profiler.timeAsync('loop.yield', () =>
            new Promise<void>((resolve) => setTimeout(resolve)));
        }
      });
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
