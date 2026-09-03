/**
 * Browser video-export capability selection.
 *
 * Kept out of `videoExport.ts` so the decision — which encoder path runs and
 * what file the user actually receives — can be probed by the export UI before
 * an export starts, and unit-tested without a real `VideoEncoder`. Probes are
 * injectable for exactly that reason; the defaults are read at call time, never
 * at module load, so the console overrides documented in
 * `docs/github-pages-deployment.md` keep working.
 */

export type VideoFormat = 'mp4' | 'webm';

/** Frame-exact WebCodecs encoding, or real-time canvas capture. */
export type VideoExportPath = 'webcodecs' | 'mediarecorder';

// High → Main → Baseline profile, all at level 5.1 (covers 1080p60 with room to spare).
export const AVC_CODECS = ['avc1.640033', 'avc1.4d0033', 'avc1.420033'];
// VP9 profile 0, 8-bit; level 4.1 covers 1080p60, 1.0 as a permissive fallback.
export const VP9_CODECS = ['vp09.00.41.08', 'vp09.00.10.08'];

/**
 * MediaRecorder preference order. Every entry is WebM: the real-time path can
 * never satisfy an MP4 request, which is why callers must relabel the output.
 */
export const RECORDER_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** ~0.15 bits per pixel per frame, clamped to a sane range. */
export function pickBitrate(width: number, height: number, fps: number): number {
  const raw = Math.round(width * height * fps * 0.15);
  return Math.min(24_000_000, Math.max(2_000_000, raw));
}

export interface VideoExportRequest {
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
}

export interface VideoCapabilityProbes {
  /** Null when the environment has no usable `VideoEncoder`. */
  isEncoderConfigSupported: ((config: VideoEncoderConfig) => Promise<boolean>) | null;
  /** Null when the environment cannot record a canvas stream at all. */
  isRecorderTypeSupported: ((mimeType: string) => boolean) | null;
}

interface VideoExportPlanBase {
  /** What the user asked for. */
  requestedFormat: VideoFormat;
  /** What the user will actually receive. */
  format: VideoFormat;
  extension: VideoFormat;
  mimeType: string;
  /** True when the delivered format or timing differs from the request. */
  degraded: boolean;
  /** User-facing description of what this export will produce, and why. */
  summary: string;
}

export interface WebCodecsVideoExportPlan extends VideoExportPlanBase {
  path: 'webcodecs';
  /** A configuration that already passed `isConfigSupported`. */
  encoderConfig: VideoEncoderConfig;
}

export interface MediaRecorderVideoExportPlan extends VideoExportPlanBase {
  path: 'mediarecorder';
  /** The mime type the recorder must be constructed with. */
  recorderMimeType: string;
  /** Real-time capture only ever produces WebM. */
  format: 'webm';
  extension: 'webm';
}

/** Discriminated on `path` so callers cannot read the wrong half of the plan. */
export type VideoExportPlan = WebCodecsVideoExportPlan | MediaRecorderVideoExportPlan;

export function browserVideoProbes(): VideoCapabilityProbes {
  const encoderAvailable = typeof VideoEncoder !== 'undefined'
    && typeof VideoEncoder.isConfigSupported === 'function';
  // MediaRecorder without captureStream cannot see the export canvas, so both
  // halves of the real-time path have to be present for it to count.
  const recorderAvailable = typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';

  return {
    isEncoderConfigSupported: encoderAvailable
      ? async (config) => (await VideoEncoder.isConfigSupported(config)).supported === true
      : null,
    isRecorderTypeSupported: recorderAvailable
      ? (mimeType) => MediaRecorder.isTypeSupported(mimeType)
      : null
  };
}

/** Candidate encoder configurations for a request, in preference order. */
export function buildEncoderConfigs(request: VideoExportRequest): VideoEncoderConfig[] {
  const { format, width, height, fps } = request;
  const codecs = format === 'mp4' ? AVC_CODECS : VP9_CODECS;
  return codecs.map((codec) => ({
    codec,
    width,
    height,
    bitrate: pickBitrate(width, height, fps),
    framerate: fps,
    // 'avc' packaging gives the muxer the out-of-band decoder config it needs.
    ...(format === 'mp4' ? { avc: { format: 'avc' as const } } : {})
  }));
}

const FORMAT_LABELS: Record<VideoFormat, string> = { mp4: 'MP4 (H.264)', webm: 'WebM (VP9)' };

function recorderLabel(mimeType: string): string {
  if (mimeType.includes('vp9')) return 'WebM (VP9)';
  if (mimeType.includes('vp8')) return 'WebM (VP8)';
  return 'WebM';
}

function describeRequest(request: VideoExportRequest): string {
  return `${request.width}x${request.height} at ${request.fps} fps`;
}

/**
 * Decide how a browser video export will run. Resolves to a frame-exact
 * WebCodecs plan when the requested format has a supported encoder
 * configuration, otherwise to the real-time WebM plan. Rejects — preserving the
 * specific WebCodecs reason — when neither path is available.
 */
export async function planVideoExport(
  request: VideoExportRequest,
  probes: VideoCapabilityProbes = browserVideoProbes()
): Promise<VideoExportPlan> {
  const { format } = request;
  let webCodecsReason: string;

  if (!probes.isEncoderConfigSupported) {
    webCodecsReason = 'WebCodecs is unavailable in this browser';
  } else {
    for (const config of buildEncoderConfigs(request)) {
      let supported = false;
      try {
        supported = await probes.isEncoderConfigSupported(config);
      } catch {
        // Malformed or unknown codec string on this browser — try the next one.
        continue;
      }
      if (supported) {
        return {
          path: 'webcodecs',
          requestedFormat: format,
          format,
          extension: format,
          mimeType: format === 'mp4' ? 'video/mp4' : 'video/webm',
          encoderConfig: config,
          degraded: false,
          summary: `Frame-exact WebCodecs encoding — this export will produce ${FORMAT_LABELS[format]}.`
        };
      }
    }
    webCodecsReason = `this browser has no supported ${format.toUpperCase()} encoder configuration for ${describeRequest(request)}`;
  }

  const recorderMimeType = probes.isRecorderTypeSupported
    ? RECORDER_MIME_TYPES.find(probes.isRecorderTypeSupported) ?? null
    : null;

  if (!recorderMimeType) {
    throw new Error(
      `Video export is unavailable: ${webCodecsReason}, and real-time WebM recording is not available either.`
    );
  }

  const delivered = recorderLabel(recorderMimeType);
  const summary = format === 'mp4'
    ? `MP4 is unavailable because ${webCodecsReason}. This export will be captured in real time and saved as ${delivered} instead.`
    : `Frame-exact encoding is unavailable because ${webCodecsReason}. This export will be captured in real time as ${delivered}, so timing follows the clock rather than the frame count.`;

  return {
    path: 'mediarecorder',
    requestedFormat: format,
    format: 'webm',
    extension: 'webm',
    mimeType: 'video/webm',
    recorderMimeType,
    degraded: true,
    summary
  };
}
