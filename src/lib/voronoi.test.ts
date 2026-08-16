import { describe, expect, it } from 'vitest';
import { getVoronoiCells } from './voronoi';

describe('getVoronoiCells', () => {
  const bounds = { minX: -200, minY: -200, maxX: 200, maxY: 200 };

  it('is deterministic for a given seed', () => {
    const a = getVoronoiCells(bounds, 12, 42);
    const b = getVoronoiCells(bounds, 12, 42);
    expect(a).toEqual(b);
  });

  it('produces a different layout for a different seed', () => {
    const a = getVoronoiCells(bounds, 12, 1);
    const b = getVoronoiCells(bounds, 12, 2);
    expect(a).not.toEqual(b);
  });

  it('clamps cell count into a sane range', () => {
    const tooFew = getVoronoiCells(bounds, 1, 1);
    const tooMany = getVoronoiCells(bounds, 500, 1);
    expect(tooFew.length).toBeGreaterThanOrEqual(1);
    expect(tooMany.length).toBeLessThanOrEqual(60);
  });

  it('every cell polygon is a valid shape with at least 3 points, clipped to bounds', () => {
    const cells = getVoronoiCells(bounds, 16, 7);
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach(cell => {
      expect(cell.points.length).toBeGreaterThanOrEqual(3);
      cell.points.forEach(pt => {
        expect(pt.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
        expect(pt.x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(bounds.minY - 1e-6);
        expect(pt.y).toBeLessThanOrEqual(bounds.maxY + 1e-6);
      });
    });
  });

  it('returns nothing for degenerate (zero-area) bounds', () => {
    expect(getVoronoiCells({ minX: 0, minY: 0, maxX: 0, maxY: 100 }, 10, 1)).toEqual([]);
  });
});
