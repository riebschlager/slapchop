import { describe, expect, it } from 'vitest';
import {
  createNewPolygonLayer,
  createPresetPolygonPoints,
  getPolygonCentroid,
  isPointInPolygon
} from './polygonUtils';

describe('createPresetPolygonPoints', () => {
  it('produces the expected vertex counts', () => {
    expect(createPresetPolygonPoints('triangle')).toHaveLength(3);
    expect(createPresetPolygonPoints('rectangle')).toHaveLength(4);
    expect(createPresetPolygonPoints('hexagon')).toHaveLength(6);
    expect(createPresetPolygonPoints('star')).toHaveLength(10);
  });

  it('scales with the radius argument', () => {
    const small = createPresetPolygonPoints('hexagon', 100);
    const large = createPresetPolygonPoints('hexagon', 200);
    expect(Math.hypot(large[0].x, large[0].y)).toBeCloseTo(2 * Math.hypot(small[0].x, small[0].y));
  });
});

describe('isPointInPolygon', () => {
  const square = [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 }
  ];

  it('detects interior points', () => {
    expect(isPointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 9.9, y: -9.9 }, square)).toBe(true);
  });

  it('rejects exterior points', () => {
    expect(isPointInPolygon({ x: 11, y: 0 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 0, y: -20 }, square)).toBe(false);
  });

  it('works for concave polygons', () => {
    // An L-shape: the notch at the top-right is outside
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 }
    ];
    expect(isPointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    expect(isPointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false);
  });

  it('returns false for degenerate polygons', () => {
    expect(isPointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(isPointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('getPolygonCentroid', () => {
  it('averages the vertices', () => {
    const centroid = getPolygonCentroid([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    expect(centroid).toEqual({ x: 5, y: 5 });
  });

  it('handles an empty point list', () => {
    expect(getPolygonCentroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe('createNewPolygonLayer', () => {
  it('assigns unique ids and applies overrides over defaults', () => {
    const pts = createPresetPolygonPoints('triangle');
    const a = createNewPolygonLayer('A', pts);
    const b = createNewPolygonLayer('B', pts, { strokeWidth: 7, opacity: 0.5 });
    expect(a.id).not.toEqual(b.id);
    expect(a.strokeWidth).toBe(2);
    expect(b.strokeWidth).toBe(7);
    expect(b.opacity).toBe(0.5);
    expect(b.blendMode).toBe('normal');
  });
});
