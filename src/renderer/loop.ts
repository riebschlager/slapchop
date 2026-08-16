import { useStore } from '../store';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState, renderFrame } from './render2d';
import { PixiSceneRenderer } from './pixiRenderer';

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
    const frame = activeGpu.extract(t, state, width, height);
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frame, 0, 0);
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

  let consecutiveErrors = 0;

  const startTicking = (drawFn: (t: number, state: RenderState) => void) => {
    let draw = drawFn;
    const t0 = performance.now();
    let frames = 0;
    let lastFpsAt = t0;

    const tick = (now: number) => {
      if (disposed) return;
      playbackTime = (now - t0) / 1000;

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
      if (!disposed) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
  };

  const start2d = () => {
    startTicking((t, state) => renderFrame(canvas, t, state, CANVAS_WIDTH, CANVAS_HEIGHT));
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
        startTicking((t, state) => renderer.render(t, state));
      },
      (err) => {
        console.warn('GPU renderer init failed, falling back to Canvas 2D:', err);
        if (!disposed) start2d();
      }
    );
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    if (gpu) {
      if (activeGpu === gpu) activeGpu = null;
      gpu.destroy();
      gpu = null;
    }
  };
}
