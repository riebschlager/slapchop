import { describe, expect, it, vi } from 'vitest';
import {
  AVC_CODECS,
  buildEncoderConfigs,
  pickBitrate,
  planVideoExport,
  RECORDER_MIME_TYPES,
  VP9_CODECS,
  type MediaRecorderVideoExportPlan,
  type VideoCapabilityProbes,
  type VideoExportPlan,
  type WebCodecsVideoExportPlan
} from './videoCapabilities';

const HD = { width: 720, height: 1280, fps: 30 } as const;

function probes(options: {
  supportedCodecs?: string[] | null;
  throwOnCodecs?: string[];
  supportedRecorderTypes?: string[] | null;
}): VideoCapabilityProbes {
  const { supportedCodecs, throwOnCodecs = [], supportedRecorderTypes } = options;
  return {
    isEncoderConfigSupported: supportedCodecs === null || supportedCodecs === undefined
      ? null
      : async (config) => {
          if (throwOnCodecs.includes(config.codec)) throw new TypeError('unrecognized codec');
          return supportedCodecs.includes(config.codec);
        },
    isRecorderTypeSupported: supportedRecorderTypes === null || supportedRecorderTypes === undefined
      ? null
      : (mimeType) => supportedRecorderTypes.includes(mimeType)
  };
}

// The plan is discriminated on `path`; these narrow it so a test can only read
// the half that path actually populates.
function asWebCodecs(plan: VideoExportPlan): WebCodecsVideoExportPlan {
  if (plan.path !== 'webcodecs') throw new Error(`expected a WebCodecs plan, got ${plan.path}`);
  return plan;
}

function asRecorder(plan: VideoExportPlan): MediaRecorderVideoExportPlan {
  if (plan.path !== 'mediarecorder') throw new Error(`expected a recorder plan, got ${plan.path}`);
  return plan;
}

describe('pickBitrate', () => {
  it('scales with pixels and fps', () => {
    expect(pickBitrate(1080, 1920, 30)).toBe(Math.round(1080 * 1920 * 30 * 0.15));
  });

  it('clamps tiny exports to the 2 Mbps floor', () => {
    expect(pickBitrate(100, 100, 15)).toBe(2_000_000);
  });

  it('clamps huge exports to the 24 Mbps ceiling', () => {
    expect(pickBitrate(3840, 2160, 60)).toBe(24_000_000);
  });
});

describe('buildEncoderConfigs', () => {
  it('offers the AVC profiles in preference order with avc packaging for MP4', () => {
    const configs = buildEncoderConfigs({ format: 'mp4', ...HD });
    expect(configs.map((c) => c.codec)).toEqual(AVC_CODECS);
    for (const config of configs) {
      expect(config).toMatchObject({
        width: 720,
        height: 1280,
        framerate: 30,
        bitrate: pickBitrate(720, 1280, 30),
        avc: { format: 'avc' }
      });
    }
  });

  it('offers the VP9 profiles without avc packaging for WebM', () => {
    const configs = buildEncoderConfigs({ format: 'webm', ...HD });
    expect(configs.map((c) => c.codec)).toEqual(VP9_CODECS);
    expect(configs.every((c) => !('avc' in c))).toBe(true);
  });
});

describe('planVideoExport', () => {
  it('takes the first supported WebCodecs configuration', async () => {
    const plan = asWebCodecs(await planVideoExport(
      { format: 'mp4', ...HD },
      probes({ supportedCodecs: AVC_CODECS })
    ));
    expect(plan.format).toBe('mp4');
    expect(plan.extension).toBe('mp4');
    expect(plan.mimeType).toBe('video/mp4');
    expect(plan.encoderConfig.codec).toBe(AVC_CODECS[0]);
    expect(plan.degraded).toBe(false);
    expect(plan.summary).toContain('Frame-exact');
  });

  it('falls back through the profile list before giving up on WebCodecs', async () => {
    const plan = asWebCodecs(await planVideoExport(
      { format: 'mp4', ...HD },
      probes({ supportedCodecs: [AVC_CODECS[2]] })
    ));
    expect(plan.encoderConfig.codec).toBe(AVC_CODECS[2]);
  });

  it('skips a configuration whose probe throws and keeps looking', async () => {
    const plan = asWebCodecs(await planVideoExport(
      { format: 'webm', ...HD },
      probes({ supportedCodecs: [VP9_CODECS[1]], throwOnCodecs: [VP9_CODECS[0]] })
    ));
    expect(plan.encoderConfig.codec).toBe(VP9_CODECS[1]);
  });

  it('probes with the requested resolution and frame rate', async () => {
    const isEncoderConfigSupported = vi.fn(async () => true);
    await planVideoExport(
      { format: 'webm', width: 1080, height: 1920, fps: 60 },
      { isEncoderConfigSupported, isRecorderTypeSupported: null }
    );
    expect(isEncoderConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1080, height: 1920, framerate: 60 })
    );
  });

  it('degrades to real-time WebM when the browser has no VideoEncoder', async () => {
    const plan = asRecorder(await planVideoExport(
      { format: 'mp4', ...HD },
      probes({ supportedCodecs: null, supportedRecorderTypes: RECORDER_MIME_TYPES })
    ));
    expect(plan.degraded).toBe(true);
    expect(plan.summary).toContain('WebCodecs is unavailable in this browser');
  });

  // The MP4-becomes-WebM case: the delivered file must never be labelled MP4.
  it('relabels a degraded MP4 request as WebM and says so', async () => {
    const plan = asRecorder(await planVideoExport(
      { format: 'mp4', ...HD },
      probes({ supportedCodecs: [], supportedRecorderTypes: RECORDER_MIME_TYPES })
    ));
    expect(plan.requestedFormat).toBe('mp4');
    expect(plan.format).toBe('webm');
    expect(plan.extension).toBe('webm');
    expect(plan.mimeType).toBe('video/webm');
    expect(plan.recorderMimeType).toBe(RECORDER_MIME_TYPES[0]);
    expect(plan.degraded).toBe(true);
    expect(plan.summary).toContain('MP4 is unavailable');
    expect(plan.summary).toContain('WebM (VP9)');
    expect(plan.summary).toContain('720x1280 at 30 fps');
  });

  it('reports a degraded WebM request as a timing change, not a format change', async () => {
    const plan = await planVideoExport(
      { format: 'webm', ...HD },
      probes({ supportedCodecs: [], supportedRecorderTypes: RECORDER_MIME_TYPES })
    );
    expect(plan.format).toBe('webm');
    expect(plan.degraded).toBe(true);
    expect(plan.summary).not.toContain('MP4');
    expect(plan.summary).toContain('real time');
  });

  it('prefers VP9 for the recorder and accepts a bare WebM container', async () => {
    const vp8 = asRecorder(await planVideoExport(
      { format: 'webm', ...HD },
      probes({ supportedCodecs: [], supportedRecorderTypes: ['video/webm;codecs=vp8', 'video/webm'] })
    ));
    expect(vp8.recorderMimeType).toBe('video/webm;codecs=vp8');
    expect(vp8.summary).toContain('WebM (VP8)');

    const bare = asRecorder(await planVideoExport(
      { format: 'webm', ...HD },
      probes({ supportedCodecs: [], supportedRecorderTypes: ['video/webm'] })
    ));
    expect(bare.recorderMimeType).toBe('video/webm');
  });

  it('preserves the specific WebCodecs reason when there is no fallback either', async () => {
    await expect(planVideoExport(
      { format: 'mp4', width: 1080, height: 1920, fps: 60 },
      probes({ supportedCodecs: [], supportedRecorderTypes: null })
    )).rejects.toThrow(/no supported MP4 encoder configuration for 1080x1920 at 60 fps/);
  });

  it('reports a missing VideoEncoder when there is no fallback either', async () => {
    await expect(planVideoExport(
      { format: 'webm', ...HD },
      probes({ supportedCodecs: null, supportedRecorderTypes: [] })
    )).rejects.toThrow(/WebCodecs is unavailable in this browser/);
  });
});
