import { expect, it } from 'vitest';
import { autoStroke, autopaintStamps, DEFAULT_AUTOPAINT, normalizeAutopaint } from './autopaint';
import { pathDistance, stampAlpha, type PaintAsset } from './model';
const assets: PaintAsset[] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `${i}.gif`, src: '',
  gifData: { width: 100, height: 100, totalDurationMs: 800, frames: [] } }));
const config = { ...DEFAULT_AUTOPAINT, enabled: true };
it('generates deterministic bounded paths, with a new source per gesture and no retired sources', () => {
  const palette = [...assets, { ...assets[0], id: 'retired', retired: true }];
  const strokes = Array.from({ length: 40 }, (_, i) => autoStroke(config, palette, i)!);
  expect(strokes).toEqual(Array.from({ length: 40 }, (_, i) => autoStroke(config, palette, i)));
  expect(new Set(strokes.slice(0, 4).map(s => s.assetId)).size).toBe(4);
  for (const [i, stroke] of strokes.entries()) {
    expect(stroke.assetId).not.toBe('retired');
    if (i) expect(stroke.assetId).not.toBe(strokes[i - 1].assetId);
    expect(stroke.points[0].time).toBe(0);
    expect(pathDistance(stroke.points)).toBeGreaterThan(0);
    expect(pathDistance(stroke.points)).toBeLessThan(50000);
    for (const p of stroke.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(540);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(960);
    }
  }
  expect(autoStroke({ ...config, seed: 2 }, assets, 0)).not.toEqual(strokes[0]);
});
it.each(['arcs', 'flicks', 'lines', 'angles'] as const)('preserves %s geometry and source timing across frame cadences and direct seeks', gesture => {
  const settings = { ...config, gesture };
  const direct = [...autopaintStamps(settings, assets, -1e-9, 12)];
  let from = -1e-9;
  const incremental = [0, 0.13, 0.5, 1, 2.7, 8.1, 12].flatMap(to => {
    const stamps = [...autopaintStamps(settings, assets, from, to)]; from = to; return stamps;
  });
  expect(incremental).toEqual(direct);
  expect(direct.length).toBeGreaterThan(10);
  expect(direct.every(s => s.pressure! > 0 && s.pressure! <= 1)).toBe(true);
  const late = [...autopaintStamps(settings, assets, 3600, 3600.1)];
  expect(late.length).toBeLessThan(100);
});
it('respects pauses, fading, single-source libraries and disabled or empty palettes', () => {
  const settings = { ...config, variation: 0, gesture: 'lines' as const, duration: 1, pause: 2 };
  expect([...autopaintStamps(settings, assets, 1.01, 2.99)]).toEqual([]);
  expect([...autopaintStamps({ ...settings, enabled: false }, assets, -1, 10)]).toEqual([]);
  expect([...autopaintStamps(settings, [], -1, 10)]).toEqual([]);
  expect(autoStroke(config, assets.slice(0, 1), 20)?.assetId).toBe('0');
  const stamp = [...autopaintStamps({ ...settings, brush: { ...settings.brush, lifetime: 2 } }, assets, -1e-9, 0)][0];
  expect(stampAlpha(stamp, 2)).toBe(0);
  expect(stampAlpha(stamp, 1)).toBeCloseTo(stampAlpha(stamp, 0) / 2);
});
it('normalizes untrusted numeric controls and defaults', () => {
  expect(normalizeAutopaint()).toEqual(DEFAULT_AUTOPAINT);
  const normalized = normalizeAutopaint({ duration: NaN, pause: -1, reach: Infinity, seed: -100, variation: 5 });
  expect(normalized).toMatchObject({ duration: 1.6, pause: 0, reach: 650, seed: 0, variation: 1 });
});

it('retains the seeded palette and sampled current gesture across display updates', async () => {
  const { AutopaintSequence } = await import('./autopaint');
  const sequence = new AutopaintSequence(config, assets);
  const stamps = [0, 0.1, 0.2, 0.3, 0.4].flatMap((time, i, times) => [...sequence.stamps(i ? times[i - 1] : -1e-9, time)]);
  expect(stamps).toEqual([...autopaintStamps(config, assets, -1e-9, 0.4)]);
  expect(sequence.stats.gestureBuilds).toBe(1);
});
