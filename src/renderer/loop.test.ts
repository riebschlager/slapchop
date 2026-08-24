import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suspendLivePreviewRendering } from './livePreviewSuspension';

const pixi = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  render: vi.fn()
}));

vi.mock('./pixiRenderer', () => ({
  PixiSceneRenderer: {
    create: pixi.create
  }
}));

import { getPlaybackTime, startRenderLoop } from './loop';

describe('live render loop', () => {
  let now = 0;
  let nextFrameId = 1;
  let pendingFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    now = 0;
    nextFrameId = 1;
    pendingFrames = new Map();
    pixi.create.mockReset();
    pixi.destroy.mockReset();
    pixi.render.mockReset();
    pixi.create.mockResolvedValue({
      rendererType: 'webgl',
      destroy: pixi.destroy,
      render: pixi.render
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops scheduling frames and excludes the paused interval from playback time', async () => {
    const onFps = vi.fn();
    const stop = startRenderLoop({} as HTMLCanvasElement, onFps);
    await Promise.resolve();

    expect(pendingFrames.size).toBe(1);
    const firstFrame = [...pendingFrames.values()][0];
    pendingFrames.clear();
    firstFrame(100);
    expect(pixi.render).toHaveBeenCalledTimes(1);
    expect(getPlaybackTime()).toBeCloseTo(0.1);

    const resume = suspendLivePreviewRendering();
    expect(pendingFrames.size).toBe(0);
    expect(onFps).toHaveBeenLastCalledWith(0);

    now = 5_000;
    resume();
    expect(pendingFrames.size).toBe(1);

    const resumedFrame = [...pendingFrames.values()][0];
    pendingFrames.clear();
    resumedFrame(5_100);
    expect(pixi.render).toHaveBeenCalledTimes(2);
    expect(getPlaybackTime()).toBeCloseTo(0.2);

    stop();
    expect(pendingFrames.size).toBe(0);
    expect(pixi.destroy).toHaveBeenCalledTimes(1);
  });
});
