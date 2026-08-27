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

/** Settle renderer creation and let the deferred teardown task run. */
async function flushTeardown() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

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
    // Teardown is deferred by one task so a StrictMode remount can reclaim the
    // renderer; let that task run before asserting the GPU was released.
    await flushTeardown();
    expect(pixi.destroy).toHaveBeenCalledTimes(1);
  });
});

// Pixi's WebGL teardown calls loseContext(), and getContext() keeps handing
// back that dead context, so a canvas element can only ever host one renderer.
// React StrictMode mounts effects twice in development — a create → destroy →
// create sequence on one canvas — which silently kills the desktop app's GPU
// path while the browser's WebGPU path survives it.
describe('renderer lifecycle per canvas', () => {
  beforeEach(() => {
    pixi.create.mockReset();
    pixi.destroy.mockReset();
    pixi.render.mockReset();
    pixi.create.mockResolvedValue({
      rendererType: 'webgl',
      destroy: pixi.destroy,
      render: pixi.render
    });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reuses one live renderer across a StrictMode remount of the same canvas', async () => {
    const canvas = {} as HTMLCanvasElement;

    const stopFirst = startRenderLoop(canvas);
    stopFirst();
    const stopSecond = startRenderLoop(canvas);
    await flushTeardown();

    expect(pixi.create).toHaveBeenCalledTimes(1);
    expect(pixi.destroy).not.toHaveBeenCalled();

    stopSecond();
    await flushTeardown();
    expect(pixi.destroy).toHaveBeenCalledTimes(1);
  });

  it('releases the renderer on a real unmount', async () => {
    const stop = startRenderLoop({} as HTMLCanvasElement);
    await flushTeardown();
    expect(pixi.create).toHaveBeenCalledTimes(1);

    stop();
    await flushTeardown();
    expect(pixi.destroy).toHaveBeenCalledTimes(1);
  });

  it('gives a separate canvas its own renderer', async () => {
    const stopA = startRenderLoop({} as HTMLCanvasElement);
    const stopB = startRenderLoop({} as HTMLCanvasElement);
    await flushTeardown();

    expect(pixi.create).toHaveBeenCalledTimes(2);

    stopA();
    stopB();
    await flushTeardown();
    expect(pixi.destroy).toHaveBeenCalledTimes(2);
  });
});
