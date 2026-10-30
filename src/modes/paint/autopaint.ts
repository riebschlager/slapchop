import { buildPaintDabs, DEFAULT_PAINT_SETTINGS, normalizePaintSettings, type PaintDab, type PaintAsset, type PaintSettings, type PaintStamp, type PaintStroke } from './model';

export type AutoGesture = 'mixed' | 'arcs' | 'flicks' | 'lines' | 'angles';
export interface AutopaintSettings {
  enabled: boolean;
  seed: number;
  gesture: AutoGesture;
  duration: number;
  pause: number;
  reach: number;
  variation: number;
  brush: PaintSettings;
}
export const DEFAULT_AUTOPAINT: AutopaintSettings = {
  enabled: false, seed: 1, gesture: 'mixed', duration: 1.6, pause: 0.6, reach: 650, variation: 0.65,
  brush: { ...DEFAULT_PAINT_SETTINGS, opacity: 0.8 }
};
const number = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function normalizeAutopaint(input: Partial<AutopaintSettings> = {}): AutopaintSettings {
  return {
    enabled: input.enabled === true,
    seed: Math.floor(number(input.seed, 1, 0, 2147483647)),
    gesture: ['arcs', 'flicks', 'lines', 'angles'].includes(input.gesture) ? input.gesture : 'mixed',
    duration: number(input.duration, 1.6, 0.15, 8), pause: number(input.pause, 0.6, 0, 10),
    reach: number(input.reach, 650, 60, 1800), variation: number(input.variation, 0.65, 0, 1),
    brush: normalizePaintSettings(input.brush ?? DEFAULT_AUTOPAINT.brush)
  };
}
function random(seed: number, index: number, salt: number): number {
  let n = (seed ^ Math.imul(index + 1, 374761393) ^ Math.imul(salt, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
/** Slots have fixed boundaries, allowing an arbitrary export timestamp to locate
 * its gestures without replaying the clock. Variation lives inside each slot. */
export function autoStroke(config: AutopaintSettings, assets: PaintAsset[], index: number): PaintStroke | null {
  return gestureStroke(config, seededPalette(config, assets), index);
}
function seededPalette(config: AutopaintSettings, assets: PaintAsset[]): PaintAsset[] {
  return assets.filter(a => !a.retired).map((asset, i) => ({ asset, rank: random(config.seed, i, 91) }))
    .sort((a, b) => a.rank - b.rank).map(entry => entry.asset);
}
function gestureStroke(config: AutopaintSettings, ordered: PaintAsset[], index: number): PaintStroke | null {
  if (!ordered.length) return null;
  const r = (salt: number) => random(config.seed, index, salt);
  const asset = ordered[index % ordered.length];
  const gesture = config.gesture === 'mixed' ? (['arcs', 'flicks', 'lines', 'angles'] as const)[Math.floor(r(1) * 4)] : config.gesture;
  const duration = config.duration * (1 - config.variation * r(2) * 0.65) * (gesture === 'flicks' ? 0.45 : 1);
  const reach = config.reach * (1 - config.variation * r(3) * 0.65) * (gesture === 'flicks' ? 0.65 : 1);
  const angle = r(4) * Math.PI * 2;
  const cx = (r(5) - 0.5) * 920, cy = (r(6) - 0.5) * 1700;
  const bend = (r(7) < 0.5 ? -1 : 1) * reach * (0.2 + r(8) * 0.45);
  const points = Array.from({ length: 65 }, (_, i) => {
    const t = i / 64;
    // Ease at the ends, with faster release for a flick and a pause at corners.
    const u = gesture === 'flicks' ? t * t : t * t * (3 - 2 * t);
    const x = (u - 0.5) * reach;
    let y = 0;
    if (gesture === 'arcs') y = Math.sin(u * Math.PI) * bend + Math.sin(u * Math.PI * 3) * reach * config.variation * 0.07;
    if (gesture === 'flicks') y = u * u * bend * 0.4;
    if (gesture === 'angles') y = (u < 0.5 ? u * 2 : (1 - u) * 2) * bend;
    if (gesture === 'lines') y = Math.sin(u * Math.PI * 2) * reach * config.variation * 0.025;
    return { x: Math.max(-530, Math.min(530, cx + x * Math.cos(angle) - y * Math.sin(angle))),
      y: Math.max(-950, Math.min(950, cy + x * Math.sin(angle) + y * Math.cos(angle))), time: t * duration };
  });
  return { ...config.brush, replay: false, constantSpeed: false, id: `auto-${index}`, name: `Autopaint ${index + 1}`,
    assetId: asset.id, hidden: false, seed: Math.floor(r(9) * 2147483647), points,
    sourceOffset: r(10) * asset.gifData.totalDurationMs / 1000 };
}
export function* autopaintStamps(config: AutopaintSettings, assets: PaintAsset[], from: number, to: number): Generator<PaintStamp> {
  yield* new AutopaintSequence(config, assets).stamps(from, to);
}

/** Palette sorting is configuration work; keep only two sampled gestures so
 * long accumulation never retains its entire generated path history. */
export class AutopaintSequence {
  private palette: PaintAsset[];
  private gestures = new Map<number, { stroke: PaintStroke; dabs: PaintDab[] }>();
  readonly stats = { gestureBuilds: 0 };
  constructor(private config: AutopaintSettings, assets: PaintAsset[]) {
    this.palette = seededPalette(config, assets);
  }
  *stamps(from: number, to: number): Generator<PaintStamp> {
    const config = this.config;
    if (!config.enabled || to < 0 || to <= from) return;
    const period = config.duration + config.pause;
    const first = Math.max(0, Math.floor(Math.max(0, from - config.duration) / period));
    const last = Math.floor(to / period);
    for (let index = first; index <= last; index++) {
      let gesture = this.gestures.get(index);
      if (!gesture) {
        const stroke = gestureStroke(config, this.palette, index);
        if (!stroke) return;
        gesture = { stroke, dabs: buildPaintDabs(stroke) };
        this.stats.gestureBuilds++;
        this.gestures.set(index, gesture);
        if (this.gestures.size > 2) this.gestures.delete(this.gestures.keys().next().value!);
      }
      const { stroke, dabs } = gesture;
      for (const dab of dabs) {
        const birth = index * period + dab.time;
        const flick = config.gesture === 'flicks' || (config.gesture === 'mixed' && Math.floor(random(config.seed, index, 1) * 4) === 1);
        const progress = dab.time / stroke.points.at(-1)!.time;
        const pressure = flick ? 0.9 - 0.75 * progress : 0.65 + 0.35 * Math.sin(Math.PI * progress);
        if (birth > from && birth <= to) yield { stroke, dab, birth, pressure, sourceTime: stroke.sourceOffset + dab.time * stroke.gifSpeed };
      }
    }
  }
}
