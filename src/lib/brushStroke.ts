import { BrushShapeSettings, PolygonBrush, PolygonLayer, PolygonPoint } from '../types';
import { applyMotion } from './motion';
import { isPointInPolygon } from './polygonUtils';

// Brush-painted Tiled GIF shapes. A stroke is stored as an open centerline
// plus per-sample pressure; the filled shape is rebuilt from it as a list of
// convex pieces, one per centerline segment (the convex hull of the two
// neighbouring nib dabs). Their union is the stroke. Renderers fill every
// piece in one nonzero pass (Canvas 2D) or one Graphics (Pixi), which unions
// overlaps without polygon boolean math and never hands a self-intersecting
// outline to a triangulator.

/** Spacing between stored centerline samples, in design px. */
export const BRUSH_SAMPLE_SPACING = 4;

/** Smallest dab radius drawn, so tapered tips stay a clean point. */
const MIN_RADIUS = 0.35;

/** Arc length (design px) of one roughness noise cell. */
const ROUGHNESS_WAVELENGTH = 28;

export interface RawBrushInput {
  x: number;
  y: number;
  /** Milliseconds; only differences matter. */
  time: number;
  /** Pen pressure 0..1 when the device reports it, otherwise undefined. */
  pressure?: number;
}

export interface RecordedBrushStroke {
  points: PolygonPoint[];
  pressures: number[];
}

interface BrushSample {
  x: number;
  y: number;
  r: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/**
 * Turns raw pointer input into a stored stroke: streamline smoothing, then
 * pressure (the pen's own, or simulated from speed so a mouse still tapers
 * on fast flicks), then resampling at a fixed spacing so geometry cost
 * depends on stroke length rather than pointer event rate.
 */
export function recordBrushStroke(input: RawBrushInput[], smoothing: number): RecordedBrushStroke {
  if (input.length === 0) return { points: [], pressures: [] };

  const follow = 1 - clamp(smoothing, 0, 1) * 0.85;
  const smoothed: { x: number; y: number; p: number }[] = [];
  let x = input[0].x;
  let y = input[0].y;
  let simulated = 0.6;
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const prevX = x;
    const prevY = y;
    if (i > 0) {
      x = lerp(x, raw.x, follow);
      y = lerp(y, raw.y, follow);
    }
    let p: number;
    if (raw.pressure !== undefined) {
      p = clamp(raw.pressure, 0, 1);
    } else {
      const dt = i > 0 ? Math.max(1, raw.time - input[i - 1].time) : 16;
      const speed = Math.hypot(x - prevX, y - prevY) / dt; // design px per ms
      const target = 1 - clamp(speed / 5, 0, 1) * 0.75;
      simulated = i === 0 ? target : lerp(simulated, target, 0.3);
      p = simulated;
    }
    smoothed.push({ x, y, p });
  }
  // Streamline lags behind the pointer; finish where the pen actually lifted.
  const last = input[input.length - 1];
  const tail = smoothed[smoothed.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 0.5) {
    smoothed.push({ x: last.x, y: last.y, p: last.pressure !== undefined ? clamp(last.pressure, 0, 1) : tail.p });
  }

  const points: PolygonPoint[] = [{ x: smoothed[0].x, y: smoothed[0].y }];
  const pressures: number[] = [smoothed[0].p];
  let carried = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const a = smoothed[i - 1];
    const b = smoothed[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment === 0) continue;
    let along = BRUSH_SAMPLE_SPACING - carried;
    while (along <= segment) {
      const k = along / segment;
      points.push({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
      pressures.push(lerp(a.p, b.p, k));
      along += BRUSH_SAMPLE_SPACING;
    }
    carried = segment - (along - BRUSH_SAMPLE_SPACING);
  }
  const end = smoothed[smoothed.length - 1];
  const lastPoint = points[points.length - 1];
  if (Math.hypot(end.x - lastPoint.x, end.y - lastPoint.y) > 0.5) {
    points.push({ x: end.x, y: end.y });
    pressures.push(end.p);
  }
  return { points, pressures };
}

/** 0..1 portion of the stroke drawn at time t. */
export function getBrushDrawOnProgress(brush: Pick<PolygonBrush, 'drawOnDuration' | 'drawOnHold'>, t: number): number {
  const duration = brush.drawOnDuration;
  if (!(duration > 0)) return 1;
  const period = duration + Math.max(0, brush.drawOnHold);
  const local = ((t % period) + period) % period;
  return clamp(local / duration, 0, 1);
}

function easeOutQuad(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

function hash(n: number, seed: number): number {
  const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1]. */
function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u);
}

/**
 * The stroke's centerline samples with their radii at time t: pressure,
 * taper, roughness, animated size, and draw-on truncation all resolve here.
 * Taper lengths come from the full stroke so they don't rescale while the
 * stroke draws on, but the end taper follows the drawn tip, which then reads
 * as a brush still being dragged.
 */
export function resolveBrushSamples(points: PolygonPoint[], brush: PolygonBrush, t: number): BrushSample[] {
  if (points.length === 0) return [];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = lengths[lengths.length - 1];
  const progress = getBrushDrawOnProgress(brush, t);
  if (progress <= 0) return [];
  const cutoff = total * progress;

  const size = Math.max(0, applyMotion(brush.size, brush.motionSize, t));
  const taperStart = clamp(brush.taperStart, 0, 1) * total;
  const taperEnd = clamp(brush.taperEnd, 0, 1) * total;
  const thinning = clamp(brush.thinning, 0, 1);
  const roughness = clamp(brush.roughness, 0, 1);

  const radiusAt = (s: number, pressure: number) => {
    let r = (size / 2) * (1 - thinning * (1 - clamp(pressure, 0, 1)));
    if (taperStart > 0) r *= easeOutQuad(clamp(s / taperStart, 0, 1));
    if (taperEnd > 0) r *= easeOutQuad(clamp((cutoff - s) / taperEnd, 0, 1));
    if (roughness > 0) r *= Math.max(0, 1 + roughness * 0.6 * valueNoise(s / ROUGHNESS_WAVELENGTH, brush.seed));
    return Math.max(MIN_RADIUS, r);
  };

  const samples: BrushSample[] = [];
  for (let i = 0; i < points.length; i++) {
    const s = lengths[i];
    const pressure = brush.pressures[i] ?? 1;
    if (s <= cutoff) {
      samples.push({ x: points[i].x, y: points[i].y, r: radiusAt(s, pressure) });
      continue;
    }
    // Interpolate the drawn tip between the last included sample and this one.
    const prev = i - 1;
    const span = s - lengths[prev];
    const k = span > 0 ? (cutoff - lengths[prev]) / span : 0;
    if (k > 0) {
      const p = lerp(brush.pressures[prev] ?? 1, pressure, k);
      samples.push({ x: lerp(points[prev].x, points[i].x, k), y: lerp(points[prev].y, points[i].y, k), r: radiusAt(cutoff, p) });
    }
    break;
  }
  return samples;
}

function dabPoints(sample: BrushSample, nib: Pick<BrushShapeSettings, 'nibRoundness' | 'nibAngle'>, outset: number): PolygonPoint[] {
  const roundness = clamp(nib.nibRoundness, 0.05, 1);
  const rx = sample.r + outset;
  const ry = sample.r * roundness + outset;
  // Tessellate by on-screen arc length so thin strokes stay cheap.
  const segments = clamp(Math.ceil((2 * Math.PI * rx) / 10), 8, 32);
  const angle = roundness < 1 ? (nib.nibAngle * Math.PI) / 180 : 0;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const out: PolygonPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    out.push({ x: sample.x + ex * cosA - ey * sinA, y: sample.y + ex * sinA + ey * cosA });
  }
  return out;
}

function cross(o: PolygonPoint, a: PolygonPoint, b: PolygonPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Andrew's monotone chain. Every hull comes out with the same winding, which
 * is what lets a nonzero fill union overlapping pieces instead of cancelling.
 */
export function convexHull(input: PolygonPoint[]): PolygonPoint[] {
  const pts = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: PolygonPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: PolygonPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Convex pieces whose union is the stroke at time t. `outset` grows every dab
 * by a fixed distance, which is how a brush shape's border is drawn: the
 * outset union sits behind the fill and shows as an outline around it.
 */
export function getBrushPieces(points: PolygonPoint[], brush: PolygonBrush, t: number, outset = 0): PolygonPoint[][] {
  const samples = resolveBrushSamples(points, brush, t);
  if (samples.length === 0) return [];
  const dabs = samples.map(sample => dabPoints(sample, brush, outset));
  if (dabs.length === 1) return [convexHull(dabs[0])];
  const pieces: PolygonPoint[][] = [];
  for (let i = 1; i < dabs.length; i++) {
    pieces.push(convexHull(dabs[i - 1].concat(dabs[i])));
  }
  return pieces;
}

export function getPiecesBounds(pieces: PolygonPoint[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const piece of pieces) {
    for (const p of piece) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export function isPointInBrushPieces(pt: PolygonPoint, pieces: PolygonPoint[][]): boolean {
  return pieces.some(piece => isPointInPolygon(pt, piece));
}

/** Brush shapes render from a single sample; outline polygons need three. */
export function isPolygonShapeRenderable(polygon: PolygonLayer): boolean {
  return polygon.brush ? polygon.points.length >= 1 : polygon.points.length >= 3;
}

/**
 * Whether the brush geometry varies with time, so cached GPU geometry must be
 * rebuilt every frame instead of only when the document changes.
 */
export function isBrushAnimated(brush: PolygonBrush): boolean {
  return brush.drawOnDuration > 0 || (!!brush.motionSize && brush.motionSize.type !== 'none');
}

/**
 * Fills gaps in a persisted brush from the current defaults and keeps
 * `pressures` parallel to the centerline, so a hand-edited or truncated file
 * cannot desynchronize them.
 */
export function normalizePolygonBrush(brush: Partial<PolygonBrush>, pointCount: number, defaults: BrushShapeSettings): PolygonBrush {
  const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const pressures = Array.from({ length: pointCount }, (_, i) => clamp(finite(brush.pressures?.[i], 1), 0, 1));
  return {
    size: Math.max(0, finite(brush.size, defaults.size)),
    thinning: clamp(finite(brush.thinning, defaults.thinning), 0, 1),
    taperStart: clamp(finite(brush.taperStart, defaults.taperStart), 0, 1),
    taperEnd: clamp(finite(brush.taperEnd, defaults.taperEnd), 0, 1),
    roughness: clamp(finite(brush.roughness, defaults.roughness), 0, 1),
    nibRoundness: clamp(finite(brush.nibRoundness, defaults.nibRoundness), 0.05, 1),
    nibAngle: finite(brush.nibAngle, defaults.nibAngle),
    pressures,
    seed: finite(brush.seed, 0),
    motionSize: brush.motionSize,
    drawOnDuration: Math.max(0, finite(brush.drawOnDuration, 0)),
    drawOnHold: Math.max(0, finite(brush.drawOnHold, 0))
  };
}
