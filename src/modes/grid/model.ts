import type { GifData } from '../../types';

export interface GridAsset {
  id: string;
  name: string;
  src: string;
  gifData: GifData;
}
export interface GridAxis {
  amount: number;
  speed: number;
  frequency: number;
  phase: number;
  harmonic: number;
  reverse: boolean;
  weights: number[];
}
export interface GridDrift {
  amount: number;
  speed: number;
  scale: number;
  seed: number;
}
export interface GridConfig {
  motionPattern: 'waves' | 'organic';
  drift: GridDrift;
  rows: number;
  columns: number;
  gutter: number;
  margin: number;
  x: GridAxis;
  y: GridAxis;
  gifSpeed: number;
  cellPhase: number;
  shuffle: boolean;
  seed: number;
  backgroundColor: string;
}
const axis = (phase: number): GridAxis => ({
  amount: 0.7, speed: 0.12, frequency: 1, phase, harmonic: 0, reverse: false, weights: []
});
export const DEFAULT_GRID: GridConfig = {
  motionPattern: 'waves', drift: { amount: 1.2, speed: 0.12, scale: 2, seed: 1 },
  rows: 6, columns: 4, gutter: 0, margin: 0, x: axis(0), y: axis(0.25),
  gifSpeed: 1, cellPhase: 0, shuffle: false, seed: 1, backgroundColor: '#09090b'
};
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
function normalizeAxis(input: Partial<GridAxis> | undefined, fallback: GridAxis): GridAxis {
  const a = input ?? {};
  return {
    amount: clamp(a.amount, fallback.amount, 0, 2.5), speed: clamp(a.speed, fallback.speed, 0, 2),
    frequency: clamp(a.frequency, fallback.frequency, 0, 4), phase: clamp(a.phase, fallback.phase, 0, 1),
    harmonic: clamp(a.harmonic, 0, 0, 1), reverse: typeof a.reverse === 'boolean' ? a.reverse : false,
    weights: Array.isArray(a.weights) ? a.weights.slice(0, 24).map(w => clamp(w, 1, 0.2, 5)) : []
  };
}
export function normalizeGrid(input: Partial<GridConfig> | null = {}): GridConfig {
  input = input ?? {};
  return {
    motionPattern: input.motionPattern === 'organic' ? 'organic' : 'waves',
    drift: {
      amount: clamp(input.drift?.amount, DEFAULT_GRID.drift.amount, 0, 2.5),
      speed: clamp(input.drift?.speed, DEFAULT_GRID.drift.speed, 0, 2),
      scale: clamp(input.drift?.scale, DEFAULT_GRID.drift.scale, 0.25, 8),
      seed: Math.round(clamp(input.drift?.seed, DEFAULT_GRID.drift.seed, 0, 100000))
    },
    rows: Math.round(clamp(input.rows, 6, 1, 24)), columns: Math.round(clamp(input.columns, 4, 1, 24)),
    gutter: clamp(input.gutter, 0, 0, 40), margin: clamp(input.margin, 0, 0, 200),
    x: normalizeAxis(input.x, DEFAULT_GRID.x), y: normalizeAxis(input.y, DEFAULT_GRID.y),
    gifSpeed: clamp(input.gifSpeed, 1, 0, 4), cellPhase: clamp(input.cellPhase, 0, 0, 1),
    shuffle: typeof input.shuffle === 'boolean' ? input.shuffle : false,
    seed: Math.round(clamp(input.seed, 1, 0, 100000)),
    backgroundColor: typeof input.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.backgroundColor)
      ? input.backgroundColor : DEFAULT_GRID.backgroundColor
  };
}

/** Positive normalized widths keep edges fixed and prevent cells crossing at any time. */
export function resolveAxis(count: number, span: number, a: GridAxis, t: number): number[] {
  const weights = Array.from({ length: count }, (_, i) => {
    const phase = Math.PI * 2 * (i / count * a.frequency + a.phase + t * a.speed * (a.reverse ? -1 : 1));
    return (a.weights[i] ?? 1) * Math.exp(a.amount * (Math.sin(phase) + a.harmonic * Math.sin(2 * phase) * 0.5));
  });
  const sum = weights.reduce((total, w) => total + w, 0);
  const edges = [0];
  weights.forEach(w => edges.push(edges[edges.length - 1] + span * w / sum));
  edges[count] = span;
  return edges;
}
// Quintic interpolation keeps velocity and acceleration continuous at noise boundaries.
function driftNoise(x: number, y: number, seed: number): number {
  const hash = (ix: number, iy: number) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  };
  const smooth = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = smooth(x - ix);
  const v = smooth(y - iy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function resolveDriftAxis(count: number, span: number, base: GridAxis, drift: GridDrift, t: number, axis: 'x' | 'y'): number[] {
  const weights = Array.from({ length: count }, (_, i) => {
    const position = (i + 0.5) / count * drift.scale;
    const time = t * drift.speed;
    const seed = drift.seed + (axis === 'y' ? 7919 : 0);
    const broad = driftNoise(position + 0.37, time + 0.61, seed);
    const detail = driftNoise(position * 2 + 7.13, time * 1.7 + 11.29, seed + 101);
    return (base.weights[i] ?? 1) * Math.exp(drift.amount * (broad + 0.25 * detail) / 1.25);
  });
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const edges = [0];
  weights.forEach(weight => edges.push(edges[edges.length - 1] + span * weight / sum));
  edges[count] = span;
  return edges;
}

export function resolveGrid(assets: GridAsset[], input: GridConfig, t: number) {
  if (!assets.length) return [];
  const c = normalizeGrid(input);
  const xs = c.motionPattern === 'organic'
    ? resolveDriftAxis(c.columns, 1080 - c.margin * 2, c.x, c.drift, t, 'x')
    : resolveAxis(c.columns, 1080 - c.margin * 2, c.x, t);
  const ys = c.motionPattern === 'organic'
    ? resolveDriftAxis(c.rows, 1920 - c.margin * 2, c.y, c.drift, t, 'y')
    : resolveAxis(c.rows, 1920 - c.margin * 2, c.y, t);
  return Array.from({ length: c.rows * c.columns }, (_, i) => {
    const col = i % c.columns;
    const row = Math.floor(i / c.columns);
    const random = Math.sin(i * 12.9898 + c.seed * 78.233) * 43758.5453;
    const asset = assets[c.shuffle ? Math.floor((random - Math.floor(random)) * assets.length) : i % assets.length];
    const w = xs[col + 1] - xs[col];
    const h = ys[row + 1] - ys[row];
    return {
      asset, x: -540 + c.margin + xs[col] + w / 2, y: -960 + c.margin + ys[row] + h / 2,
      width: Math.max(0, w - c.gutter), height: Math.max(0, h - c.gutter),
      sourceTime: t * c.gifSpeed + (i * c.cellPhase % 1) * asset.gifData.totalDurationMs / 1000
    };
  });
}
