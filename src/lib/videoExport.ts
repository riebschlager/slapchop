import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { getExportProfiler } from './exportProfiler';
import type { VideoFormat } from './videoCapabilities';

export type { VideoFormat };

export interface FrameExportOptions {
  width: number;
  height: number;
  fps: number;
  duration: number;
  startTime?: number;
  /** Draw the frame for time t (seconds) into the given canvas. Must be a pure function of t. */
  renderFrame: (canvas: HTMLCanvasElement, t: number) => void;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export interface WebCodecsExportOptions extends FrameExportOptions {
  /**
   * A configuration that already passed `VideoEncoder.isConfigSupported`.
   * Capability selection lives in `videoCapabilities.ts` so the UI can warn
   * about a fallback before the export starts.
   */
  encoderConfig: VideoEncoderConfig;
}

/** Frames the encoder may have queued before the loop stops feeding it. */
const QUEUE_HIGH_WATER = 2;
/** Frames between UI yields when the encoder is keeping up. */
const UI_YIELD_INTERVAL = 8;

/**
 * Frame-exact video export: renders exactly fps × duration frames at
 * deterministic timestamps and encodes them with WebCodecs, faster than
 * real time. Returns null if cancelled.
 */
export async function exportVideo(
  format: VideoFormat,
  opts: WebCodecsExportOptions
): Promise<Blob | null> {
  const { width, height, fps, duration, startTime = 0, renderFrame, onProgress, isCancelled } = opts;
  const totalFrames = Math.round(fps * duration);
  const config = opts.encoderConfig;

  const target = format === 'mp4' ? new Mp4Target() : new WebmTarget();
  const muxer = format === 'mp4'
    ? new Mp4Muxer({
        target: target as Mp4Target,
        video: { codec: 'avc', width, height },
        fastStart: 'in-memory'
      })
    : new WebmMuxer({
        target: target as WebmTarget,
        video: { codec: 'V_VP9', width, height, frameRate: fps }
      });

  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; }
  });
  encoder.configure(config);

  const canvas = document.createElement('canvas');
  const profiler = getExportProfiler();
  try {
    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) return null;
      if (encodeError) throw encodeError;

      renderFrame(canvas, startTime + n / fps);
      // `encode` only queues; the encoder's real cost surfaces in the
      // backpressure wait below.
      profiler.time('webcodecs.submit', () => {
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((n * 1_000_000) / fps),
          duration: Math.round(1_000_000 / fps)
        });
        encoder.encode(frame, { keyFrame: n % 150 === 0 });
        frame.close();
      });
      profiler.countFrame();

      onProgress?.(n + 1, totalFrames);

      // Wait only while the encoder is actually behind. The previous version
      // scheduled a timeout every frame even with an empty queue, which cost a
      // macrotask per frame for nothing.
      await profiler.timeAsync('webcodecs.backpressure', async () => {
        while (encoder.encodeQueueSize > QUEUE_HIGH_WATER) {
          await new Promise((r) => setTimeout(r));
        }
        // Still yield periodically, or a fast encoder would starve the UI
        // thread for the whole export and make cancellation feel stuck.
        if (n % UI_YIELD_INTERVAL === 0) await new Promise((r) => setTimeout(r));
      });
    }

    await profiler.timeAsync('webcodecs.flush', () => encoder.flush());
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  profiler.time('mux.finalize', () => muxer.finalize());
  return new Blob([target.buffer!], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
}
