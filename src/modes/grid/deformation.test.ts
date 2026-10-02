import { describe, expect, it } from 'vitest';
import { insetGridQuad, resolveGridVertices, type GridQuad } from './deformation';
import { DEFAULT_GRID, normalizeGrid, resolveAxis, resolveGrid } from './model';

const assets = [{ id: 'a', name: 'a.gif', src: 'a', gifData: { width: 80, height: 40, totalDurationMs: 1000, frames: [] } }];
const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const area = (q: GridQuad) => q.reduce((sum, p, i) => sum + p.x * q[(i + 1) % 4].y - p.y * q[(i + 1) % 4].x, 0) / 2;

for (const pattern of ['directional', 'ripple'] as const) describe(`${pattern} grid deformation`, () => {
  const config = normalizeGrid({ motionPattern: pattern });
  const corners = (t: number, c = config) => resolveGrid(assets, c, t).map(cell => cell.corners);
  it('is deterministic and seekable, evolves, and does not change GIF assignment', () => {
    const later = resolveGrid(assets, config, 2);
    resolveGrid(assets, config, 100);
    expect(resolveGrid(assets, config, 2)).toEqual(later);
    expect(corners(2)).not.toEqual(corners(0));
    expect(later.map(cell => cell.asset.id)).toEqual(resolveGrid(assets, config, 0).map(cell => cell.asset.id));
    expect(later[0].sourceTime).toBe(2);
  });
  it('freezes with zero speed and removes displacement at zero strength', () => {
    const frozen = normalizeGrid({ ...config, [pattern]: { ...config[pattern], speed: 0 } });
    expect(corners(100, frozen)).toEqual(corners(0, frozen));
    const flat = normalizeGrid({ ...config, [pattern]: { ...config[pattern], amount: 0 },
      columns: 2, rows: 2, margin: 40, gutter: 10, x: { ...DEFAULT_GRID.x, weights: [1, 3] } });
    expect(corners(100, flat)[0]).toEqual([{ x: -495, y: -915 }, { x: -255, y: -915 }, { x: -255, y: -5 }, { x: -495, y: -5 }]);
  });
  it('shares adjacent edges exactly and pins the perimeter to the stage with margins', () => {
    const c = normalizeGrid({ ...config, margin: 40 });
    const cells = resolveGrid(assets, c, 4);
    for (let row = 0; row < c.rows; row++) for (let col = 0; col < c.columns; col++) {
      const q = cells[row * c.columns + col].corners!;
      if (col < c.columns - 1) {
        const next = cells[row * c.columns + col + 1].corners!;
        expect(q[1]).toEqual(next[0]); expect(q[2]).toEqual(next[3]);
      }
      if (row < c.rows - 1) {
        const next = cells[(row + 1) * c.columns + col].corners!;
        expect(q[3]).toEqual(next[0]); expect(q[2]).toEqual(next[1]);
      }
      if (col === 0) expect(q[0].x).toBe(-500);
      if (col === c.columns - 1) expect(q[1].x).toBe(500);
      if (row === 0) expect(q[0].y).toBe(-920);
      if (row === c.rows - 1) expect(q[3].y).toBe(920);
    }
    expect(cells.reduce((sum, cell) => sum + area(cell.corners!), 0)).toBeCloseTo(1000 * 1840, 5);
  });
  it('keeps every cell convex at extreme sizes, wavelengths, angles, and long timestamps', () => {
    for (const count of [1, 2, 24]) for (const angle of [-180, 0, 45, 90]) for (const t of [-100, 0, 0.5, 30, 21600]) {
      const c = normalizeGrid({ ...config, rows: count, columns: count, margin: 200,
        directional: { ...config.directional, amount: 5, wavelength: 100, speed: 2, angle, rotationSpeed: 90 },
        ripple: { ...config.ripple, amount: 5, wavelength: 100, speed: 2, centerX: 0, centerY: 1 },
        x: { ...DEFAULT_GRID.x, weights: Array.from({ length: count }, (_, i) => i % 2 ? 5 : 0.2) },
        y: { ...DEFAULT_GRID.y, weights: Array.from({ length: count }, (_, i) => i % 2 ? 0.2 : 5) } });
      for (const cell of resolveGrid(assets, c, t)) {
        const q = cell.corners!;
        expect(q.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        expect(q.every((p, i) => cross(p, q[(i + 1) % 4], q[(i + 2) % 4]) > 0)).toBe(true);
      }
    }
  });
  it('keeps undersized gutter cells hidden without inverted corners', () => {
    const c = normalizeGrid({ ...config, rows: 24, columns: 24, gutter: 40, margin: 200,
      x: { ...DEFAULT_GRID.x, weights: [0.2, 5] } });
    for (const cell of resolveGrid(assets, c, 3)) {
      const q = cell.corners!;
      expect(q.every((p, i) => cross(p, q[(i + 1) % 4], q[(i + 2) % 4]) >= -1e-7)).toBe(true);
    }
  });
});

it('rotates the wave field and respects separate rotation timing', () => {
  const c = normalizeGrid({ motionPattern: 'directional', directional: { ...DEFAULT_GRID.directional, speed: 0, rotationSpeed: 20 } });
  expect(resolveGrid(assets, c, 1)).not.toEqual(resolveGrid(assets, c, 3));
  const changed = normalizeGrid({ ...c, directional: { ...c.directional, angle: -45, rotationSpeed: 0 } });
  expect(resolveGrid(assets, changed, 0)).not.toEqual(resolveGrid(assets, c, 0));
});

it('moves the ripple origin smoothly through vertices without a singularity', () => {
  const c = normalizeGrid({ motionPattern: 'ripple', rows: 4, columns: 4 });
  const xs = resolveAxis(4, 1080, { ...c.x, amount: 0 }, 0);
  const ys = resolveAxis(4, 1920, { ...c.y, amount: 0 }, 0);
  const middle = resolveGridVertices(xs, ys, c, 0)[12];
  expect(middle).toEqual({ x: 540, y: 960 });
  const left = resolveGridVertices(xs, ys, normalizeGrid({ ...c, ripple: { ...c.ripple, centerX: 0.5 - 1e-7 } }), 0)[12];
  const right = resolveGridVertices(xs, ys, normalizeGrid({ ...c, ripple: { ...c.ripple, centerX: 0.5 + 1e-7 } }), 0)[12];
  expect(Math.abs(left.x - right.x)).toBeLessThan(0.001);
  expect(resolveGrid(assets, normalizeGrid({ ...c, ripple: { ...c.ripple, centerX: 0.1 } }), 0)).not.toEqual(resolveGrid(assets, c, 0));
});

it('reverses travel and normalizes invalid persisted field settings', () => {
  const c = normalizeGrid({ motionPattern: 'ripple' });
  const reversed = normalizeGrid({ ...c, ripple: { ...c.ripple, reverse: true } });
  expect(resolveGrid(assets, c, -2).map(cell => cell.corners)).toEqual(resolveGrid(assets, reversed, 2).map(cell => cell.corners));
  const invalid = normalizeGrid({ directional: { ...c.directional, amount: Infinity, speed: -2, wavelength: 0, rotationSpeed: 1000 },
    ripple: { ...c.ripple, centerX: NaN, centerY: 4 } });
  expect(invalid.directional).toMatchObject({ amount: 0.8, speed: 0, wavelength: 100, rotationSpeed: 90 });
  expect(invalid.ripple).toMatchObject({ centerX: 0.5, centerY: 1 });
});

it('offsets gutters by the requested physical distance on slanted edges', () => {
  const q: GridQuad = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 90, y: 100 }, { x: 10, y: 90 }];
  const inset = insetGridQuad(q, 10);
  for (let i = 0; i < 4; i++) {
    const a = q[i]; const b = q[(i + 1) % 4]; const p = inset[i];
    expect(((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(5);
  }
});

it.each(['directional', 'ripple'] as const)('uses strength above 1 for larger %s deformation and persists its full range', motionPattern => {
  const normal = normalizeGrid({ motionPattern, directional: { ...DEFAULT_GRID.directional, amount: 1 }, ripple: { ...DEFAULT_GRID.ripple, amount: 1 } });
  const strong = normalizeGrid({ ...normal, [motionPattern]: { ...normal[motionPattern], amount: 5 } });
  expect(strong[motionPattern].amount).toBe(5);
  const flat = normalizeGrid({ ...normal, [motionPattern]: { ...normal[motionPattern], amount: 0 } });
  const displacement = (c: typeof normal) => {
    const base = resolveGrid(assets, flat, 0);
    return resolveGrid(assets, c, 0).reduce((sum, cell, i) => sum + cell.corners!.reduce((s, p, j) =>
      s + Math.hypot(p.x - base[i].corners![j].x, p.y - base[i].corners![j].y), 0), 0);
  };
  expect(displacement(strong)).toBeGreaterThan(displacement(normal));
  expect(normalizeGrid({ ...strong, [motionPattern]: { ...strong[motionPattern], amount: 20 } })[motionPattern].amount).toBe(5);
});
