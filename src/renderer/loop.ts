import { useStore } from '../store';
import { CANVAS_HEIGHT, CANVAS_WIDTH, renderFrame } from './render2d';

// The playback clock lives here, outside React. Components that need the
// current time (hit testing, selection overlays) read it imperatively.
let playbackTime = 0;

export function getPlaybackTime(): number {
  return playbackTime;
}

export function startRenderLoop(
  canvas: HTMLCanvasElement,
  onFps?: (fps: number) => void
): () => void {
  let raf = 0;
  const t0 = performance.now();
  let frames = 0;
  let lastFpsAt = t0;

  const tick = (now: number) => {
    playbackTime = (now - t0) / 1000;
    const state = useStore.getState();
    renderFrame(canvas, playbackTime, state, CANVAS_WIDTH, CANVAS_HEIGHT);

    frames++;
    if (onFps && now - lastFpsAt >= 1000) {
      onFps(Math.round((frames * 1000) / (now - lastFpsAt)));
      frames = 0;
      lastFpsAt = now;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
