import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, GridAsset, normalizeGrid, resolveAxis, resolveDriftAxis, resolveGrid } from './model';

const assets: GridAsset[] = ['a', 'b', 'c'].map(id => ({ id, name: `${id}.gif`, src: id,
  gifData: { width: 80, height: 40, totalDurationMs: 1000, frames: [] } }));
describe('elastic grid geometry', () => {
  it('tiles the entire centered stage with equal cells when modulation is off', () => {
    const c = normalizeGrid({ rows: 2, columns: 3, x: { ...DEFAULT_GRID.x, amount: 0 }, y: { ...DEFAULT_GRID.y, amount: 0 } });
    const cells = resolveGrid(assets, c, 17);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toMatchObject({ x: -360, y: -480, width: 360, height: 960 });
    expect(cells[5]).toMatchObject({ x: 360, y: 480, width: 360, height: 960 });
    expect(cells.map(cell => cell.asset.id)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
  it('keeps all boundaries ordered and outer edges fixed at extreme settings', () => {
    const axis = { ...DEFAULT_GRID.x, amount: 2.5, harmonic: 1, weights: [0.2, 5] };
    for (const t of [-100, 0, 0.5, 30, 21600]) {
      const edges = resolveAxis(24, 1080, axis, t);
      expect(edges[0]).toBe(0);
      expect(edges[24]).toBe(1080);
      expect(edges.slice(1).every((edge, i) => edge > edges[i])).toBe(true);
    }
  });
  it('is seekable and deterministic with independent axis timing', () => {
    const c = normalizeGrid({ x: { ...DEFAULT_GRID.x, speed: 0 }, shuffle: true });
    const first = resolveGrid(assets, c, 0);
    const later = resolveGrid(assets, c, 2);
    expect(later).toEqual(resolveGrid(assets, c, 2));
    expect(first.map(cell => cell.width)).toEqual(later.map(cell => cell.width));
    expect(first.map(cell => cell.height)).not.toEqual(later.map(cell => cell.height));
    expect(first.map(cell => cell.asset.id)).toEqual(later.map(cell => cell.asset.id));
  });
  it('honors individual base sizes, margin, gutters, and GIF phase', () => {
    const c = normalizeGrid({ rows: 1, columns: 2, margin: 40, gutter: 10, gifSpeed: 0, cellPhase: 0.25,
      x: { ...DEFAULT_GRID.x, amount: 0, weights: [1, 3] } });
    const cells = resolveGrid(assets, c, 200);
    expect(cells[0]).toMatchObject({ width: 240, height: 1830, sourceTime: 0 });
    expect(cells[1]).toMatchObject({ width: 740, sourceTime: 0.25 });
  });
  it('bounds persisted allocations and repairs invalid numbers', () => {
    const c = normalizeGrid({ rows: Infinity, columns: 100000, gutter: -1, backgroundColor: 'url(evil)',
      x: { ...DEFAULT_GRID.x, speed: NaN, weights: [-2, NaN, 999] } });
    expect(normalizeGrid(null)).toEqual(normalizeGrid());
    expect(c.rows).toBe(6);
    expect(c.columns).toBe(24);
    expect(c.gutter).toBe(0);
    expect(c.x.weights).toEqual([0.2, 1, 5]);
    expect(c.x.speed).toBe(DEFAULT_GRID.x.speed);
    expect(c.backgroundColor).toBe(DEFAULT_GRID.backgroundColor);
    expect(resolveGrid([], c, 0)).toEqual([]);
  });
});


describe('organic grid drift', () => {
  const config = normalizeGrid({ motionPattern: 'organic' });
  const geometry = (t: number, c = config) => resolveGrid(assets, c, t).map(({ x, y, width, height }) => ({ x, y, width, height }));
  it('is seekable, seeded, and evolves on both axes', () => {
    const later = geometry(7);
    geometry(50);
    expect(geometry(7)).toEqual(later);
    expect(later.map(c => c.width)).not.toEqual(geometry(0).map(c => c.width));
    expect(later.map(c => c.height)).not.toEqual(geometry(0).map(c => c.height));
    expect(geometry(7, normalizeGrid({ ...config, drift: { ...config.drift, seed: 93 } }))).not.toEqual(later);
    expect(geometry(7, normalizeGrid({ ...config, drift: { ...config.drift, scale: 7 } }))).not.toEqual(later);
  });
  it('freezes only layout at zero drift speed and keeps GIF playback independent', () => {
    const frozen = normalizeGrid({ ...config, drift: { ...config.drift, speed: 0 } });
    expect(geometry(100, frozen)).toEqual(geometry(0, frozen));
    expect(resolveGrid(assets, frozen, 100)[0].sourceTime).toBe(100);
  });
  it('honors base sizes at zero strength and ignores inactive wave settings', () => {
    const c = normalizeGrid({ ...config, rows: 1, columns: 2, margin: 40, gutter: 10,
      drift: { ...config.drift, amount: 0 }, x: { ...DEFAULT_GRID.x, weights: [1, 3] } });
    expect(resolveGrid(assets, c, 200)[0]).toMatchObject({ width: 240, height: 1830 });
    expect(geometry(7, normalizeGrid({ ...config, x: { ...config.x, amount: 0, speed: 2 } }))).toEqual(geometry(7));
  });
  it('keeps extreme layouts positive and tiled for negative and long export times', () => {
    for (const count of [1, 2, 24]) for (const t of [-100, 0, 0.5, 30, 21600]) {
      const edges = resolveDriftAxis(count, 1080, { ...DEFAULT_GRID.x, weights: [0.2, 5] },
        { amount: 2.5, speed: 2, scale: 8, seed: 100000 }, t, 'x');
      expect(edges[0]).toBe(0);
      expect(edges[count]).toBe(1080);
      expect(edges.slice(1).every((edge, i) => edge > edges[i])).toBe(true);
    }
  });
  it('changes continuously across temporal noise boundaries', () => {
    const drift = { ...config.drift, speed: 1 };
    const before = resolveDriftAxis(8, 1080, DEFAULT_GRID.x, drift, 0.39 - 0.00001, 'x');
    const after = resolveDriftAxis(8, 1080, DEFAULT_GRID.x, drift, 0.39 + 0.00001, 'x');
    expect(after.every((edge, i) => Math.abs(edge - before[i]) < 0.05)).toBe(true);
  });
  it('normalizes malformed persisted drift controls and preserves legacy waves', () => {
    expect(normalizeGrid({}).motionPattern).toBe('waves');
    expect(normalizeGrid({ drift: { amount: NaN, speed: -2, scale: 999, seed: Infinity } }).drift)
      .toEqual({ amount: 1.2, speed: 0, scale: 8, seed: 1 });
  });
});
