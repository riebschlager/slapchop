import { describe, expect, it } from 'vitest';
import { buildPaintDabs, DEFAULT_PAINT_SETTINGS, normalizePaintSettings, originalStamps, replayStamps, stampAlpha, stampPosition, type PaintStroke } from './model';

const strokeFixture = (patch: Partial<PaintStroke> = {}): PaintStroke => ({
  ...DEFAULT_PAINT_SETTINGS, size: 100, spacing: 1, id: 'stroke', name: 'Stroke', assetId: 'gif', sourceOffset: 0.25, seed: 9, hidden: false,
  points: [{ x: -100, y: 0, time: 0 }, { x: 0, y: 0, time: 0.3 }, { x: 100, y: 0, time: 1 }], ...patch
});
describe('frozen paint timing', () => {
  it('preserves drawing timing and freezes every original stamp at its own GIF time', () => {
    const stroke = strokeFixture({ gifSpeed: 2 });
    const dabs = buildPaintDabs(stroke);
    const stamps = originalStamps(stroke, dabs);
    expect(dabs.find(d => d.x === 0)!.time).toBe(0.3);
    expect(stamps[0].sourceTime).toBe(0.25);
    expect(stamps.at(-1)!.sourceTime).toBe(2.25);
    expect(stamps.map(s => s.sourceTime)).toEqual(originalStamps(stroke, dabs).map(s => s.sourceTime));
  });
  it.each([0.1, 0.5, 1])('honors spacing %s regardless of pointer sample density or drawing speed', spacing => {
    const sparse = [{ x: 0, y: 0, time: 0 }, { x: 250, y: 0, time: 1 }];
    const dense = Array.from({ length: 251 }, (_, i) => ({ x: i, y: 0, time: i / 250 }));
    const build = (points: PaintStroke['points']) => buildPaintDabs(strokeFixture({ size: 100, spacing, points }));
    const expected = build(sparse);
    expect(build(dense)).toEqual(expected);
    expect(build(dense.map(p => ({ ...p, time: p.time * 10 }))).map(p => p.x)).toEqual(expected.map(p => p.x));
    expect(expected.map(p => p.x)).toEqual(Array.from({ length: Math.floor(250 / (100 * spacing)) + 1 }, (_, i) => i * 100 * spacing));
  });
  it('carries spacing around corners and interpolates capture time without forcing an endpoint', () => {
    const dabs = buildPaintDabs(strokeFixture({ points: [
      { x: 0, y: 0, time: 0 }, { x: 60, y: 0, time: 1 }, { x: 60, y: 60, time: 4 }
    ] }));
    expect(dabs).toEqual([{ x: 0, y: 0, time: 0, index: 0 }, { x: 60, y: 40, time: 3, index: 1 }]);
  });
  it('resamples holds independently of pointer event frequency and resumes distance spacing', () => {
    const points = [{ x: 0, y: 0, time: 0 }, { x: 40, y: 0, time: 1 },
      { x: 40, y: 0, time: 1.01 }, { x: 40, y: 0, time: 1.04 }, { x: 40, y: 0, time: 1.1 },
      { x: 100, y: 0, time: 2 }];
    const dabs = buildPaintDabs(strokeFixture({ points }));
    expect(dabs.map(p => p.x)).toEqual([0, 40, 40, 40, 100]);
    expect(dabs).toEqual(buildPaintDabs(strokeFixture({ points: points.filter((_, i) => i !== 2 && i !== 3) })));
    expect(dabs.at(-1)!.time).toBe(2);
  });
  it('records stationary holds as changing frozen frames', () => {
    const s = strokeFixture({ points: [{ x: 0, y: 0, time: 0 }, { x: 0, y: 0, time: 1 }] });
    const dabs = buildPaintDabs(s);
    expect(dabs).toHaveLength(31);
    expect(new Set(originalStamps(s, dabs).map(stamp => stamp.sourceTime)).size).toBe(31);
  });
  it('constant speed redistributes time by distance while retaining duration', () => {
    const dabs = buildPaintDabs(strokeFixture({ constantSpeed: true }));
    expect(dabs.find(d => d.x === 0)!.time).toBe(0.5);
    expect(dabs.at(-1)!.time).toBe(1);
  });
  it('removes stationary dwell stamps when converting a moving path to constant speed', () => {
    const moving = strokeFixture({ constantSpeed: true });
    const paused = { ...moving, points: [moving.points[0], { ...moving.points[0], time: 0.2 }, ...moving.points.slice(1)] };
    expect(buildPaintDabs(paused)).toEqual(buildPaintDabs(moving));
  });
  it('reconstructs exactly the same replay through incremental intervals or a direct seek', () => {
    const s = strokeFixture({ replay: true, phase: 0.3, speed: 1.7, delay: 0.2, direction: 'ping-pong' });
    const dabs = buildPaintDabs(s);
    const all = [...replayStamps(s, dabs, -1e-9, 4)];
    const split = [...replayStamps(s, dabs, -1e-9, 0.45), ...replayStamps(s, dabs, 0.45, 2), ...replayStamps(s, dabs, 2, 4)];
    expect(split).toEqual(all);
    expect(all.every(stamp => stamp.sourceTime === s.sourceOffset + stamp.birth * s.gifSpeed)).toBe(true);
  });
  it('lifts between forward passes, reverses and ping-pongs without connecting the endpoints', () => {
    const s = strokeFixture({ replay: true, delay: 1 });
    const dabs = buildPaintDabs(s);
    expect([...replayStamps(s, dabs, 1.01, 1.99)]).toEqual([]);
    expect([...replayStamps({ ...s, direction: 'reverse' }, dabs, -1e-9, 0)][0].dab.x).toBe(100);
    expect([...replayStamps({ ...s, direction: 'ping-pong' }, dabs, 1.99, 2)][0].dab.x).toBe(100);
    expect([...replayStamps(s, dabs, 1.99, 2)][0].dab.x).toBe(-100);
  });
  it('has stable seeded scatter and independently fading stamps', () => {
    const stroke = strokeFixture({ scatter: 1, lifetime: 2, opacity: 0.8 });
    const stamp = originalStamps(stroke, buildPaintDabs(stroke)).at(-1)!;
    expect(stampAlpha(stamp, 0)).toBe(0.8);
    expect(stampAlpha(stamp, 1)).toBe(0.4);
    expect(stampAlpha(stamp, 2)).toBe(0);
    expect(stampPosition(stamp)).toEqual(stampPosition(stamp));
    expect(stampPosition(stamp)).not.toEqual(stamp.dab);
    expect(stampAlpha({ ...stamp, stroke: { ...stroke, lifetime: 0 } }, 21600)).toBe(0.8);
  });
  it('normalizes nonfinite settings and bounds expensive controls', () => {
    expect(normalizePaintSettings({ size: Infinity, spacing: -1, opacity: NaN, lifetime: 999 })).toMatchObject({ size: 180, spacing: 0.1, opacity: 1, lifetime: 60 });
  });
});
it('visits only newly deposited dabs on a long active path', () => {
  let reads = 0;
  const dabs = Array.from({ length: 10001 }, (_, index) => ({
    x: index / 100, y: 0, index, get time() { reads++; return index / 100; }
  }));
  const stroke = strokeFixture({ replay: true, points: [{ x: 0, y: 0, time: 0 }, { x: 100, y: 0, time: 100 }] });
  expect([...replayStamps(stroke, dabs, 99, 99.01)]).toHaveLength(1);
  expect(reads).toBeLessThan(40);
});

it('samples appended points once with stable indices, spacing carry and hold timing', async () => {
  const { PaintDabCursor } = await import('./model');
  const stroke = strokeFixture({ size: 24, spacing: 0.1, points: [] });
  const cursor = new PaintDabCursor(stroke.size * stroke.spacing);
  const actual = [];
  const points = [{ x: 0, y: 0, time: 0 }, { x: 11, y: 7, time: 0.17 },
    { x: 11, y: 7, time: 0.18 }, { x: 11, y: 7, time: 0.6 },
    { x: -19, y: 23, time: 0.9 }, { x: -19, y: 23, time: 1.2 }];
  for (const point of points) {
    stroke.points.push(point);
    actual.push(...cursor.append(stroke.points));
    expect(actual).toEqual(buildPaintDabs(stroke));
    expect(cursor.append(stroke.points)).toEqual([]);
  }
  let reads = 0;
  for (const point of stroke.points.slice(0, -1)) {
    const x = point.x;
    Object.defineProperty(point, 'x', { get: () => { reads++; return x; } });
  }
  stroke.points.push({ x: 20, y: 10, time: 1.5 });
  cursor.append(stroke.points);
  expect(reads).toBe(0);
  expect(cursor.processedPoints).toBe(points.length + 1);
});

it('samples bounded prefixes without copying or retiming the saved path', async () => {
  const { PaintDabCursor, pathDistance } = await import('./model');
  for (const constantSpeed of [false, true]) {
    const stroke = strokeFixture({ constantSpeed, spacing: 0.1, points: [
      { x: 0, y: 0, time: 0 }, { x: 100, y: 0, time: 0.1 },
      { x: 100, y: 0, time: 1.1 }, { x: -50, y: 50, time: 1.7 }
    ] });
    const total = pathDistance(stroke.points);
    const timing = constantSpeed ? { total, duration: 1.7 } : undefined;
    const cursor = new PaintDabCursor(stroke.size * stroke.spacing);
    const dabs = stroke.points.flatMap((_, i) => cursor.append(stroke.points, timing, i + 1));
    expect(dabs).toEqual(buildPaintDabs(stroke));
  }
});
