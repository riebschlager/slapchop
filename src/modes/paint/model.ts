import type { GifData } from '../../types';

export type BrushPattern = 'round' | 'flat' | 'bristle' | 'dots' | 'stripes';
export interface PaintAsset { id: string; name: string; src: string; gifData: GifData; retired?: boolean }
export interface PaintPoint { x: number; y: number; time: number }
export interface PaintSettings {
  pattern: BrushPattern;
  size: number;
  spacing: number;
  opacity: number;
  rotation: number;
  scatter: number;
  imageZoom: number;
  imageRotation: number;
  gifSpeed: number;
  replay: boolean;
  speed: number;
  phase: number;
  direction: 'forward' | 'reverse' | 'ping-pong';
  constantSpeed: boolean;
  delay: number;
  lifetime: number;
}
export interface PaintStroke extends PaintSettings {
  id: string;
  name: string;
  assetId: string;
  points: PaintPoint[];
  sourceOffset: number;
  seed: number;
  hidden: boolean;
}
export interface PaintDocument { assets: PaintAsset[]; strokes: PaintStroke[] }
export const EMPTY_PAINT: PaintDocument = { assets: [], strokes: [] };
export const DEFAULT_PAINT_SETTINGS: PaintSettings = {
  pattern: 'round', size: 180, spacing: 0.2, opacity: 1, rotation: 0, scatter: 0,
  imageZoom: 1, imageRotation: 0, gifSpeed: 1, replay: false, speed: 1, phase: 0,
  direction: 'forward', constantSpeed: false, delay: 0, lifetime: 0
};
const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function normalizePaintSettings(input: Partial<PaintSettings> = {}): PaintSettings {
  const d = DEFAULT_PAINT_SETTINGS;
  return {
    pattern: ['round', 'flat', 'bristle', 'dots', 'stripes'].includes(input.pattern) ? input.pattern : d.pattern,
    size: finite(input.size, d.size, 24, 600), spacing: finite(input.spacing, d.spacing, 0.1, 1),
    opacity: finite(input.opacity, 1, 0, 1), rotation: finite(input.rotation, 0, -180, 180),
    scatter: finite(input.scatter, 0, 0, 1), imageZoom: finite(input.imageZoom, 1, 0.25, 4),
    imageRotation: finite(input.imageRotation, 0, -180, 180), gifSpeed: finite(input.gifSpeed, 1, 0, 4),
    replay: input.replay === true, speed: finite(input.speed, 1, 0.1, 4), phase: finite(input.phase, 0, 0, 1),
    direction: input.direction === 'reverse' || input.direction === 'ping-pong' ? input.direction : 'forward',
    constantSpeed: input.constantSpeed === true, delay: finite(input.delay, 0, 0, 10), lifetime: finite(input.lifetime, 0, 0, 60)
  };
}
export const MAX_PAINT_POINTS = 10000;
export const MAX_PAINT_DURATION = 120;
export const MAX_PAINT_DISTANCE = 50000;
export function pathDistance(points: PaintPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

export interface PaintDab extends PaintPoint { index: number }
/** Carry spacing across pointer samples; only stationary holds deposit on a time cadence. */
export function buildPaintDabs(stroke: PaintStroke): PaintDab[] {
  const points = stroke.points;
  if (!points.length) return [];
  const duration = Math.max(1 / 30, points.at(-1)!.time);
  const total = pathDistance(points);
  let travelled = 0;
  const spacing = stroke.size * stroke.spacing;
  let nextDistance = spacing;
  let holdStart: number | null = null;
  let holdFrame = 1;
  const result: PaintDab[] = [{ ...points[0], time: 0, index: 0 }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (stroke.constantSpeed && total > 0 && distance === 0) continue;
    if (distance === 0) {
      if (holdStart === null) { holdStart = a.time; holdFrame = 1; }
      while (holdStart + holdFrame / 30 <= b.time + 1e-9) {
        result.push({ x: b.x, y: b.y, time: Math.min(b.time, holdStart + holdFrame / 30), index: result.length });
        holdFrame++;
      }
      continue;
    }
    holdStart = null;
    const ta = stroke.constantSpeed && total > 0 ? travelled / total * duration : a.time;
    const endDistance = travelled + distance;
    const tb = stroke.constantSpeed && total > 0 ? endDistance / total * duration : b.time;
    while (nextDistance <= endDistance + 1e-9) {
      const k = Math.min(1, (nextDistance - travelled) / distance);
      result.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, time: ta + (tb - ta) * k, index: result.length });
      nextDistance += spacing;
    }
    travelled = endDistance;
  }
  return result;
}
export interface PaintStamp { stroke: PaintStroke; dab: PaintDab; birth: number; sourceTime: number }
/** Yield a bounded time interval; replay never allocates a history of prior loops. */
export function* replayStamps(stroke: PaintStroke, dabs: PaintDab[], from: number, to: number): Generator<PaintStamp> {
  if (!stroke.replay || !dabs.length || to < 0) return;
  const duration = Math.max(1 / 30, stroke.points.at(-1)!.time) / stroke.speed;
  const period = duration + stroke.delay;
  const phase = stroke.phase * period;
  const first = Math.max(0, Math.floor((from + phase) / period));
  const last = Math.floor((to + phase) / period);
  for (let pass = first; pass <= last; pass++) {
    const reverse = stroke.direction === 'reverse' || (stroke.direction === 'ping-pong' && pass % 2 === 1);
    const birthAt = (i: number) => {
      const dab = dabs[reverse ? dabs.length - 1 - i : i];
      return pass * period - phase + (reverse ? duration - dab.time / stroke.speed : dab.time / stroke.speed);
    };
    // A warm frame visits only new deposits, even for very long saved paths.
    let low = 0, high = dabs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (birthAt(mid) < 0 || birthAt(mid) <= from) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < dabs.length; i++) {
      const birth = birthAt(i);
      if (birth > to) break;
      const dab = dabs[reverse ? dabs.length - 1 - i : i];
      yield { stroke, dab, birth, sourceTime: stroke.sourceOffset + birth * stroke.gifSpeed };
    }
  }
}
export function originalStamps(stroke: PaintStroke, dabs: PaintDab[]): PaintStamp[] {
  const duration = stroke.points.at(-1)?.time ?? 0;
  return dabs.map(dab => ({ stroke, dab, birth: dab.time - duration, sourceTime: stroke.sourceOffset + dab.time * stroke.gifSpeed }));
}
export function stampAlpha(stamp: PaintStamp, time: number): number {
  return stamp.stroke.opacity * (stamp.stroke.lifetime > 0 ? Math.max(0, 1 - Math.max(0, time - stamp.birth) / stamp.stroke.lifetime) : 1);
}
export function stampPosition(stamp: PaintStamp): { x: number; y: number } {
  const random = (salt: number) => {
    const n = Math.sin(stamp.dab.index * 127.1 + stamp.stroke.seed * 311.7 + salt) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  return { x: stamp.dab.x + random(19) * stamp.stroke.scatter * stamp.stroke.size / 2,
    y: stamp.dab.y + random(71) * stamp.stroke.scatter * stamp.stroke.size / 2 };
}
