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
export interface GridConfig {
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
export function resolveGrid(assets: GridAsset[], input: GridConfig, t: number) {
  if (!assets.length) return [];
  const c = normalizeGrid(input);
  const xs = resolveAxis(c.columns, 1080 - c.margin * 2, c.x, t);
  const ys = resolveAxis(c.rows, 1920 - c.margin * 2, c.y, t);
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
