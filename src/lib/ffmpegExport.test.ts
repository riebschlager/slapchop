import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportNativeVideo, getPartialVideoPath } from './ffmpegExport';

const invoke = vi.fn();
const rename = vi.fn();
const remove = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  rename: (...args: unknown[]) => rename(...args),
  remove: (...args: unknown[]) => remove(...args)
}));

const WIDTH = 4;
const HEIGHT = 2;
const START_OK = { jobId: 'job-7', encoder: 'libx264', fellBack: false };

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    width: WIDTH,
    height: HEIGHT,
    fps: 2,
    duration: 1.5,
    savePath: '/exports/show.mp4',
    speed: 'quality' as const,
    renderRgbaFrame: () => new Uint8Array(WIDTH * HEIGHT * 4),
    ...overrides
  };
}

beforeEach(() => {
  invoke.mockReset();
  rename.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'start_native_video_export') return START_OK;
    if (cmd === 'finish_native_video_export') return { code: 0, stderr: '' };
    return undefined;
  });
});

const writeCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === 'write_native_video_frame');

describe('getPartialVideoPath', () => {
  it('keeps a partial output beside the requested file with the same extension', () => {
    expect(getPartialVideoPath('/exports/show.mov', 'abc'))
      .toBe('/exports/show.slapchop-partial-abc.mov');
  });
});

describe('exportNativeVideo raw frame transport', () => {
  it('declares the raw input geometry when starting the job', async () => {
    await exportNativeVideo('mp4', baseOptions());

    const [, args] = invoke.mock.calls.find(([cmd]) => cmd === 'start_native_video_export')!;
    expect(args).toMatchObject({ format: 'mp4', fps: 2, totalFrames: 3, width: WIDTH, height: HEIGHT });
  });

  it('sends each frame as the whole payload, never nested in an object', async () => {
    await exportNativeVideo('mp4', baseOptions());

    expect(writeCalls()).toHaveLength(3);
    for (const [, payload] of writeCalls()) {
      // Nesting the frame under a key is what makes Tauri JSON-serialize it.
      expect(payload).toBeInstanceOf(Uint8Array);
      expect((payload as Uint8Array).byteLength).toBe(WIDTH * HEIGHT * 4);
    }
  });

  it('carries the job identifier in a header rather than the body', async () => {
    await exportNativeVideo('mp4', baseOptions());

    for (const [, , options] of writeCalls()) {
      expect(options).toEqual({ headers: { 'x-slapchop-video-job': 'job-7' } });
    }
  });

  it('renders frame-exact timestamps in order from the requested start time', async () => {
    const times: number[] = [];
    await exportNativeVideo('mp4', baseOptions({
      startTime: 2,
      renderRgbaFrame: (t: number) => {
        times.push(t);
        return new Uint8Array(WIDTH * HEIGHT * 4);
      }
    }));

    expect(times).toEqual([2, 2.5, 3]);
  });

  it('draws the next frame while the previous write is still in flight', async () => {
    const events: string[] = [];
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_native_video_export') return START_OK;
      if (cmd === 'finish_native_video_export') return { code: 0, stderr: '' };
      if (cmd === 'write_native_video_frame') {
        events.push('write-start');
        // Two macrotasks, so the write outlives the loop's own single-turn UI
        // yield. A real write is ~70ms against a ~0.5ms yield.
        await new Promise((r) => setTimeout(r));
        await new Promise((r) => setTimeout(r));
        events.push('write-end');
      }
      return undefined;
    });

    await exportNativeVideo('mp4', baseOptions({
      renderRgbaFrame: () => {
        events.push('render');
        return new Uint8Array(WIDTH * HEIGHT * 4);
      }
    }));

    // Serial execution draws exactly one frame before the first write
    // completes. Overlapping draws the next one too.
    const untilFirstWriteEnd = events.slice(0, events.indexOf('write-end'));
    expect(untilFirstWriteEnd.filter((e) => e === 'render').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps exactly one write in flight so frames reach ffmpeg in order', async () => {
    let concurrent = 0;
    let peak = 0;
    const order: number[] = [];
    let issued = 0;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_native_video_export') return START_OK;
      if (cmd === 'finish_native_video_export') return { code: 0, stderr: '' };
      if (cmd === 'write_native_video_frame') {
        const seq = issued++;
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r));
        order.push(seq);
        concurrent--;
      }
      return undefined;
    });

    await exportNativeVideo('mp4', baseOptions({ duration: 3 }));

    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('lets the in-flight write settle before cancelling the job', async () => {
    const events: string[] = [];
    let rendered = 0;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_native_video_export') return START_OK;
      if (cmd === 'finish_native_video_export') return { code: 0, stderr: '' };
      if (cmd === 'write_native_video_frame') {
        await new Promise((r) => setTimeout(r));
        events.push('write-end');
      }
      if (cmd === 'cancel_native_video_export') events.push('cancel');
      return undefined;
    });

    const ok = await exportNativeVideo('mp4', baseOptions({
      renderRgbaFrame: () => {
        rendered++;
        return new Uint8Array(WIDTH * HEIGHT * 4);
      },
      isCancelled: () => rendered >= 2
    }));

    expect(ok).toBe(false);
    // Cancelling underneath an in-flight write would race Rust reading bytes
    // the frame still owns.
    expect(events).toEqual(['write-end', 'write-end', 'cancel']);
  });

  it('passes the requested encoder speed to the native job', async () => {
    await exportNativeVideo('webm', baseOptions({ speed: 'balanced', savePath: '/x/a.webm' }));

    const [, args] = invoke.mock.calls.find(([cmd]) => cmd === 'start_native_video_export')!;
    expect(args).toMatchObject({ format: 'webm', speed: 'balanced' });
  });

  it('discloses a hardware encoder fallback exactly once', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_native_video_export') {
        return { jobId: 'job-7', encoder: 'libx264', fellBack: true };
      }
      if (cmd === 'finish_native_video_export') return { code: 0, stderr: '' };
      return undefined;
    });
    const fallbacks: string[] = [];

    await exportNativeVideo('mp4', baseOptions({
      speed: 'fast',
      onEncoderFallback: (encoder: string) => fallbacks.push(encoder)
    }));

    expect(fallbacks).toEqual(['libx264']);
  });

  it('stays quiet when the requested encoder was used', async () => {
    const fallbacks: string[] = [];
    await exportNativeVideo('mp4', baseOptions({
      speed: 'fast',
      onEncoderFallback: (encoder: string) => fallbacks.push(encoder)
    }));

    expect(fallbacks).toEqual([]);
  });

  it('installs the finished file atomically from the partial path', async () => {
    await expect(exportNativeVideo('mp4', baseOptions())).resolves.toBe(true);

    const [partial, final] = rename.mock.calls[0];
    expect(partial).toMatch(/^\/exports\/show\.slapchop-partial-.+\.mp4$/);
    expect(final).toBe('/exports/show.mp4');
  });

  it('cancels the job and writes no further frames once cancelled', async () => {
    let rendered = 0;
    const ok = await exportNativeVideo('mp4', baseOptions({
      renderRgbaFrame: () => {
        rendered++;
        return new Uint8Array(WIDTH * HEIGHT * 4);
      },
      isCancelled: () => rendered >= 2
    }));

    expect(ok).toBe(false);
    expect(rendered).toBe(2);
    expect(writeCalls()).toHaveLength(2);
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'cancel_native_video_export')).toBe(true);
    expect(rename).not.toHaveBeenCalled();
    // A cancelled export must not leave the partial file behind.
    expect(remove).toHaveBeenCalled();
  });

  it('surfaces ffmpeg failure detail and removes the partial file', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_native_video_export') return START_OK;
      if (cmd === 'finish_native_video_export') return { code: 1, stderr: 'bad geometry' };
      return undefined;
    });

    await expect(exportNativeVideo('mp4', baseOptions())).rejects.toThrow(/bad geometry/);
    expect(rename).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});
