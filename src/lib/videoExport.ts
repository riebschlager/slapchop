import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export type VideoFormat = 'mp4' | 'webm';

export interface FrameExportOptions {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Draw the frame for time t (seconds) into the given canvas. Must be a pure function of t. */
  renderFrame: (canvas: HTMLCanvasElement, t: number) => void;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

// High → Main → Baseline profile, all at level 5.1 (covers 1080p60 with room to spare).
const AVC_CODECS = ['avc1.640033', 'avc1.4d0033', 'avc1.420033'];
// VP9 profile 0, 8-bit; level 4.1 covers 1080p60, 1.0 as a permissive fallback.
const VP9_CODECS = ['vp09.00.41.08', 'vp09.00.10.08'];

/** ~0.15 bits per pixel per frame, clamped to a sane range. */
export function pickBitrate(width: number, height: number, fps: number): number {
  const raw = Math.round(width * height * fps * 0.15);
  return Math.min(24_000_000, Math.max(2_000_000, raw));
}

async function pickEncoderConfig(
  format: VideoFormat,
  width: number,
  height: number,
  fps: number
): Promise<VideoEncoderConfig | null> {
  const candidates = format === 'mp4' ? AVC_CODECS : VP9_CODECS;
  for (const codec of candidates) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: pickBitrate(width, height, fps),
      framerate: fps,
      // 'avc' packaging gives the muxer the out-of-band decoder config it needs.
      ...(format === 'mp4' ? { avc: { format: 'avc' as const } } : {})
    };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch {
      // malformed/unknown codec string on this browser — try the next one
    }
  }
  return null;
}

/**
 * Frame-exact video export: renders exactly fps × duration frames at
 * deterministic timestamps and encodes them with WebCodecs, faster than
 * real time. Returns null if cancelled.
 */
export async function exportVideo(
  format: VideoFormat,
  opts: FrameExportOptions
): Promise<Blob | null> {
  const { width, height, fps, duration, renderFrame, onProgress, isCancelled } = opts;
  const totalFrames = Math.round(fps * duration);

  const config = await pickEncoderConfig(format, width, height, fps);
  if (!config) {
    throw new Error(`No supported ${format.toUpperCase()} encoder configuration for ${width}x${height}@${fps}`);
  }

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
  try {
    for (let n = 0; n < totalFrames; n++) {
      if (isCancelled?.()) return null;
      if (encodeError) throw encodeError;

      renderFrame(canvas, n / fps);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((n * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps)
      });
      encoder.encode(frame, { keyFrame: n % 150 === 0 });
      frame.close();

      onProgress?.(n + 1, totalFrames);

      // Backpressure, and a yield per frame so the UI thread keeps painting.
      do {
        await new Promise((r) => setTimeout(r));
      } while (encoder.encodeQueueSize > 2);
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  muxer.finalize();
  return new Blob([target.buffer!], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
}
