import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, GridAsset, normalizeGrid, resolveAxis, resolveGrid } from './model';

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
