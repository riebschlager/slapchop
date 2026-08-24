import { useStore } from '../store';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState, renderFrame } from './render2d';
import { PixiSceneRenderer } from './pixiRenderer';
import {
  isLivePreviewRenderingSuspended,
  subscribeToLivePreviewSuspension
} from './livePreviewSuspension';

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
  if (activeGpu) {
    activeGpu.extract(t, state, width, height, target);
  } else {
    renderFrame(target, t, state, width, height);
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
          try {
            gpu.destroy();
          } catch {
            // Ignore cleanup failure on a lost context
          }
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
    stopTicking = startTicking((t, state) => renderFrame(canvas, t, state, CANVAS_WIDTH, CANVAS_HEIGHT));
  };

  if (is2dRendererForced()) {
    start2d();
  } else {
    PixiSceneRenderer.create(canvas).then(
      (renderer) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
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
      gpu.destroy();
      gpu = null;
    }
  };
}
