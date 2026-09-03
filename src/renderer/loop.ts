import { useStore } from '../store';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState, renderFrame } from './render2d';
import { PixiSceneRenderer } from './pixiRenderer';
import {
  isLivePreviewRenderingSuspended,
  subscribeToLivePreviewSuspension
} from './livePreviewSuspension';
import { getExportProfiler } from '../lib/exportProfiler';

// The playback clock lives here, outside React. Components that need the
// current time (hit testing, selection overlays) read it imperatively.
let playbackTime = 0;

export function getPlaybackTime(): number {
  return playbackTime;
}

// Dev flag: ?renderer=2d keeps the Canvas 2D path for pixel comparison.
function is2dRendererForced(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('renderer') === '2d';
}

// The live GPU renderer, once initialized. Exports read it so offline frames
// match what's on screen (blend modes differ slightly between the two paths).
let activeGpu: PixiSceneRenderer | null = null;

export function getActiveRendererName(): string {
  return activeGpu ? activeGpu.rendererType : 'canvas2d';
}

// Exposed for headless smoke tests only.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window as object, {
    __getActiveGpu: () => activeGpu,
    __renderExportFrame: renderExportFrame
  });
}

/**
 * Render one frame at time t into `target` at the given resolution, using the
 * same renderer as the live canvas. Pure function of (t, state) — the export
 * paths (and later the Phase 3 encoder) call this per frame.
 */
export function renderExportFrame(
  target: HTMLCanvasElement,
  t: number,
  state: RenderState,
  width: number,
  height: number
) {
  const profiler = getExportProfiler();
  profiler.time('frame.render', () => {
    if (activeGpu) {
      activeGpu.extract(t, state, width, height, target);
    } else {
      renderFrame(target, t, state, width, height);
    }
  });
}

/**
 * One Pixi renderer per canvas element, for the lifetime of that element.
 *
 * Pixi's WebGL teardown calls `loseContext()`, and `getContext()` keeps
 * returning that same dead context, so a canvas can never host a second
 * renderer — every draw on it fails with a null shader. React StrictMode
 * mounts effects twice in development, which is exactly that sequence, and it
 * only bites the WebGL path (the desktop app), not WebGPU. So teardown is
 * deferred by a task: a StrictMode remount re-acquires the live renderer
 * before it runs, while a real unmount lets it through and frees the GPU.
 */
interface CanvasRendererEntry {
  ready: Promise<PixiSceneRenderer>;
  pendingTeardown: ReturnType<typeof setTimeout> | null;
}

const canvasRenderers = new Map<HTMLCanvasElement, CanvasRendererEntry>();

function acquireRenderer(canvas: HTMLCanvasElement): Promise<PixiSceneRenderer> {
  const existing = canvasRenderers.get(canvas);
  if (existing) {
    if (existing.pendingTeardown !== null) {
      clearTimeout(existing.pendingTeardown);
      existing.pendingTeardown = null;
    }
    return existing.ready;
  }
  // Kept as the raw create() promise so callers see the renderer on the same
  // microtask they would without the cache; failure handling hangs off a
  // separate branch of the chain.
  const ready = PixiSceneRenderer.create(canvas);
  void ready.catch(() => canvasRenderers.delete(canvas));
  canvasRenderers.set(canvas, { ready, pendingTeardown: null });
  return ready;
}

function releaseRenderer(canvas: HTMLCanvasElement) {
  const entry = canvasRenderers.get(canvas);
  if (!entry || entry.pendingTeardown !== null) return;
  entry.pendingTeardown = setTimeout(() => {
    canvasRenderers.delete(canvas);
    void entry.ready.then((renderer) => renderer.destroy(), () => undefined);
  }, 0);
}

/** Drop a renderer that has failed beyond recovery so it is never handed out again. */
function discardRenderer(canvas: HTMLCanvasElement, renderer: PixiSceneRenderer) {
  const entry = canvasRenderers.get(canvas);
  if (entry?.pendingTeardown) clearTimeout(entry.pendingTeardown);
  canvasRenderers.delete(canvas);
  try {
    renderer.destroy();
  } catch {
    // Ignore cleanup failure on a lost context
  }
}

export function startRenderLoop(
  canvas: HTMLCanvasElement,
  onFps?: (fps: number) => void
): () => void {
  let raf = 0;
  let disposed = false;
  let gpu: PixiSceneRenderer | null = null;
  let stopTicking: (() => void) | null = null;

  let consecutiveErrors = 0;

  const startTicking = (drawFn: (t: number, state: RenderState) => void) => {
    let draw = drawFn;
    let lastFrameAt = performance.now();
    let frames = 0;
    let lastFpsAt = lastFrameAt;

    playbackTime = 0;

    const scheduleFrame = () => {
      if (!disposed && !isLivePreviewRenderingSuspended() && raf === 0) {
        raf = requestAnimationFrame(tick);
      }
    };

    const tick = (now: number) => {
      raf = 0;
      if (disposed) return;
      playbackTime += (now - lastFrameAt) / 1000;
      lastFrameAt = now;

      try {
        draw(playbackTime, useStore.getState());
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        console.warn('Render loop frame error:', err);
        // If the GPU renderer encounters repeated failures (e.g. lost context / driver crash),
        // gracefully fall back to the Canvas 2D path so the studio never freezes.
        if (gpu && consecutiveErrors > 5) {
          console.warn('GPU renderer failed repeatedly; falling back to Canvas 2D.');
          if (activeGpu === gpu) activeGpu = null;
          discardRenderer(canvas, gpu);
          gpu = null;
          draw = (t, state) => renderFrame(canvas, t, state, CANVAS_WIDTH, CANVAS_HEIGHT);
          consecutiveErrors = 0;
        }
      }

      frames++;
      if (onFps && now - lastFpsAt >= 1000) {
        onFps(Math.round((frames * 1000) / (now - lastFpsAt)));
        frames = 0;
        lastFpsAt = now;
      }
      scheduleFrame();
    };

    const unsubscribe = subscribeToLivePreviewSuspension((suspended) => {
      if (disposed) return;
      if (suspended) {
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        frames = 0;
        onFps?.(0);
        return;
      }

      // Exclude the paused interval from playback time and FPS accounting so
      // the preview resumes on the same frame without a clock jump.
      lastFrameAt = performance.now();
      lastFpsAt = lastFrameAt;
      frames = 0;
      scheduleFrame();
    });

    scheduleFrame();
    return () => {
      unsubscribe();
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
    };
  };

  const start2d = () => {
    // A canvas keeps whichever context type it was first given. Once Pixi has
    // claimed a GPU context there is no 2D context to fall back to, and a
    // silent no-op here is what makes a dead GPU path look like a rendering
    // bug rather than a renderer failure.
    if (!canvas.getContext('2d')) {
      console.error(
        'Canvas 2D fallback is unavailable: this canvas is already bound to a GPU context. '
        + 'The preview cannot recover without a fresh canvas element.'
      );
      return;
    }
    stopTicking = startTicking((t, state) => renderFrame(canvas, t, state, CANVAS_WIDTH, CANVAS_HEIGHT));
  };

  if (is2dRendererForced()) {
    start2d();
  } else {
    acquireRenderer(canvas).then(
      (renderer) => {
        if (disposed) return; // releaseRenderer owns teardown; destroying here would race a remount
        gpu = renderer;
        activeGpu = renderer;
        stopTicking = startTicking((t, state) => renderer.render(t, state));
      },
      (err) => {
        console.warn('GPU renderer init failed, falling back to Canvas 2D:', err);
        if (!disposed) start2d();
      }
    );
  }

  return () => {
    disposed = true;
    stopTicking?.();
    stopTicking = null;
    if (gpu) {
      if (activeGpu === gpu) activeGpu = null;
      gpu = null;
    }
    if (!is2dRendererForced()) releaseRenderer(canvas);
  };
}
