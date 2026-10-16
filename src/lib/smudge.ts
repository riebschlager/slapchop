import { MasterFxConfig } from '../types';
import { applyMotion } from './motion';

// Smudge displacement field. The Pixi filter (renderer/filters/smudgeFilter.ts)
// ports this logic line-for-line; the integer hash keeps per-cell vectors
// identical on CPU and GPU, which a sin()-based hash would not.

const DESIGN_WIDTH = 1080;
const MAX_TAPS = 8;

export interface SmudgeParams {
  amountPx: number;   // output pixels
  cellPx: number;     // output pixels
  steps: number;      // quantization steps per side of zero
  softness: number;
  dirX: number;
  dirY: number;
  flow: number;
  coverage: number;
  taps: number;
  step: number;       // integer field time step
  frac: number;       // smoothstepped blend toward step + 1
  seed: number;
}

export function pcgHash(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Uniform [0, 1) from integer lattice coordinates. Negative ints wrap as uint32. */
export function hashCell(x: number, y: number, z: number, w: number): number {
  const h = pcgHash((x + pcgHash((y + pcgHash((z + pcgHash(w >>> 0)) >>> 0)) >>> 0)) >>> 0);
  // 24 bits converts to float32 exactly, so the GPU port sees the same value.
  return (h >>> 8) / 16777216;
}

/** Quantizes a [-1, 1] component to 2^(bits-1) levels per side; zero stays representable. */
export function quantizeSmudge(v: number, steps: number): number {
  return Math.floor(v * steps + 0.5) / steps;
}

function smoothstep01(x: number): number {
  return x * x * (3 - 2 * x);
}

export function resolveSmudgeParams(fx: MasterFxConfig, t: number, width: number): SmudgeParams {
  const scale = width / DESIGN_WIDTH;
  const amount = Math.max(0, applyMotion(fx.smudgeAmount, fx.motionSmudgeAmount, t));
  const bits = Math.min(8, Math.max(1, Math.round(fx.smudgeBitDepth)));
  const angle = (fx.smudgeAngle * Math.PI) / 180;
  // Stutter holds the field on a coarse clock so it jumps rather than glides.
  const stutter = Math.max(0, fx.smudgeStutter);
  const clock = stutter > 0 ? Math.floor(t * stutter) / stutter : t;
  const tau = clock * Math.max(0, fx.smudgeSpeed);
  const step = Math.floor(tau);
  return {
    amountPx: amount * scale,
    cellPx: Math.max(1, fx.smudgeCellSize * scale),
    steps: 2 ** (bits - 1),
    softness: Math.min(1, Math.max(0, fx.smudgeSoftness)),
    dirX: Math.cos(angle),
    dirY: Math.sin(angle),
    flow: Math.min(1, Math.max(0, fx.smudgeFlow)),
    coverage: Math.min(1, Math.max(0, fx.smudgeCoverage)),
    taps: Math.min(MAX_TAPS, Math.max(1, Math.round(fx.smudgeSmear))),
    // Wrapping keeps the step exactly representable as a float32 uniform.
    step: step % 1000000,
    frac: smoothstep01(tau - step),
    seed: Math.max(0, Math.round(fx.smudgeSeed)),
  };
}

export function isSmudgeActive(p: SmudgeParams): boolean {
  return p.amountPx > 0 && p.coverage > 0;
}

/** Unquantized unit-bounded vector at lattice point (cx, cy) for one time step. */
function latticeVectorAt(cx: number, cy: number, step: number, p: SmudgeParams, out: [number, number]) {
  const seed = p.seed * 4;
  if (hashCell(cx, cy, step, seed + 2) >= p.coverage) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  const a = hashCell(cx, cy, step, seed) * Math.PI * 2;
  const mag = hashCell(cx, cy, step, seed + 1);
  out[0] = Math.cos(a) * mag * (1 - p.flow) + p.dirX * mag * p.flow;
  out[1] = Math.sin(a) * mag * (1 - p.flow) + p.dirY * mag * p.flow;
}

const scratchA: [number, number] = [0, 0];
const scratchB: [number, number] = [0, 0];
const scratchV: [number, number] = [0, 0];

type LatticeLookup = (cx: number, cy: number, out: [number, number]) => void;

/** Lattice vector blended between the current and next time step. */
export function smudgeLatticeVector(cx: number, cy: number, p: SmudgeParams, out: [number, number]) {
  latticeVectorAt(cx, cy, p.step, p, scratchA);
  latticeVectorAt(cx, cy, p.step + 1, p, scratchB);
  out[0] = scratchA[0] + (scratchB[0] - scratchA[0]) * p.frac;
  out[1] = scratchA[1] + (scratchB[1] - scratchA[1]) * p.frac;
}

/**
 * Displacement in output pixels at pixel center (px, py). Lattice point (i, j)
 * sits at the center of cell (i, j); blocky mode reads its own cell, soft mode
 * bilinearly interpolates the four surrounding centers.
 */
export function smudgeVector(
  px: number,
  py: number,
  p: SmudgeParams,
  out: [number, number],
  lattice: LatticeLookup = (cx, cy, o) => smudgeLatticeVector(cx, cy, p, o)
): void {
  let vx = 0;
  let vy = 0;
  const v = scratchV;
  if (p.softness < 1) {
    lattice(Math.floor(px / p.cellPx), Math.floor(py / p.cellPx), v);
    vx = v[0] * (1 - p.softness);
    vy = v[1] * (1 - p.softness);
  }
  if (p.softness > 0) {
    const gx = px / p.cellPx - 0.5;
    const gy = py / p.cellPx - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = smoothstep01(gx - ix);
    const fy = smoothstep01(gy - iy);
    lattice(ix, iy, v);
    let sx = v[0] * (1 - fx) * (1 - fy);
    let sy = v[1] * (1 - fx) * (1 - fy);
    lattice(ix + 1, iy, v);
    sx += v[0] * fx * (1 - fy);
    sy += v[1] * fx * (1 - fy);
    lattice(ix, iy + 1, v);
    sx += v[0] * (1 - fx) * fy;
    sy += v[1] * (1 - fx) * fy;
    lattice(ix + 1, iy + 1, v);
    sx += v[0] * fx * fy;
    sy += v[1] * fx * fy;
    vx += sx * p.softness;
    vy += sy * p.softness;
  }
  out[0] = quantizeSmudge(vx, p.steps) * p.amountPx;
  out[1] = quantizeSmudge(vy, p.steps) * p.amountPx;
}

/**
 * Applies the smudge in place to straight-alpha RGBA pixels. Samples snap to
 * whole pixels and clamp to the frame edge, matching the GPU filter.
 */
export function applySmudgePixels(data: Uint8ClampedArray, width: number, height: number, p: SmudgeParams) {
  if (!isSmudgeActive(p)) return;

  // Lattice vectors depend only on the cell, so evaluate each once per frame.
  // Soft mode reads one cell beyond each edge, hence the +1 offset and padding.
  const cols = Math.ceil(width / p.cellPx) + 2;
  const rows = Math.ceil(height / p.cellPx) + 2;
  const grid = new Float64Array(cols * rows * 2);
  const v: [number, number] = [0, 0];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      smudgeLatticeVector(i - 1, j - 1, p, v);
      const k = (j * cols + i) * 2;
      grid[k] = v[0];
      grid[k + 1] = v[1];
    }
  }
  const lattice: LatticeLookup = (cx, cy, out) => {
    const i = Math.min(cols - 1, Math.max(0, cx + 1));
    const j = Math.min(rows - 1, Math.max(0, cy + 1));
    const k = (j * cols + i) * 2;
    out[0] = grid[k];
    out[1] = grid[k + 1];
  };

  const copy = new Uint8ClampedArray(data);
  const taps = p.taps;
  const d: [number, number] = [0, 0];
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      smudgeVector(px, py, p, d, lattice);
      const dx = d[0];
      const dy = d[1];
      if (dx === 0 && dy === 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < taps; k++) {
        const s = (k + 1) / taps;
        const sx = Math.min(width - 1, Math.max(0, Math.floor(px + dx * s)));
        const sy = Math.min(height - 1, Math.max(0, Math.floor(py + dy * s)));
        const si = (sy * width + sx) * 4;
        r += copy[si];
        g += copy[si + 1];
        b += copy[si + 2];
        a += copy[si + 3];
      }
      const idx = (y * width + x) * 4;
      data[idx] = r / taps;
      data[idx + 1] = g / taps;
      data[idx + 2] = b / taps;
      data[idx + 3] = a / taps;
    }
  }
}
