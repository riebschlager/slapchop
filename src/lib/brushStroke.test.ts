import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH_TOOL, PolygonBrush, PolygonPoint } from '../types';
import {
  BRUSH_SAMPLE_SPACING,
  convexHull,
  getBrushDrawOnProgress,
  getBrushPieces,
  getPiecesBounds,
  isPointInBrushPieces,
  normalizePolygonBrush,
  recordBrushStroke,
  resolveBrushSamples
} from './brushStroke';

function line(length: number): PolygonPoint[] {
  const points: PolygonPoint[] = [];
  for (let x = 0; x <= length; x += BRUSH_SAMPLE_SPACING) points.push({ x, y: 0 });
  return points;
}

function brush(overrides: Partial<PolygonBrush> = {}, count = 0): PolygonBrush {
  return {
    ...DEFAULT_BRUSH_TOOL,
    pressures: Array(count).fill(1),
    seed: 7,
    drawOnDuration: 0,
    drawOnHold: 0,
    ...overrides
  };
}

function signedArea(poly: PolygonPoint[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

describe('recordBrushStroke', () => {
  it('resamples input at a fixed spacing regardless of event rate', () => {
    const input = [
      { x: 0, y: 0, time: 0, pressure: 0.5 },
      { x: 100, y: 0, time: 16, pressure: 0.5 }
    ];
    const { points, pressures } = recordBrushStroke(input, 0);
    expect(points.length).toBe(100 / BRUSH_SAMPLE_SPACING + 1);
    expect(pressures.length).toBe(points.length);
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x - points[i - 1].x).toBeCloseTo(BRUSH_SAMPLE_SPACING);
    }
  });

  it('keeps pen pressure and simulates pressure from speed for a mouse', () => {
    const pen = recordBrushStroke([
      { x: 0, y: 0, time: 0, pressure: 0.2 },
      { x: 40, y: 0, time: 100, pressure: 0.2 }
    ], 0);
    expect(pen.pressures.every(p => Math.abs(p - 0.2) < 1e-9)).toBe(true);

    const slow = recordBrushStroke([{ x: 0, y: 0, time: 0 }, { x: 40, y: 0, time: 400 }], 0);
    const fast = recordBrushStroke([{ x: 0, y: 0, time: 0 }, { x: 40, y: 0, time: 2 }], 0);
    expect(fast.pressures[fast.pressures.length - 1]).toBeLessThan(slow.pressures[slow.pressures.length - 1]);
  });

  it('ends where the pointer lifted even with heavy smoothing', () => {
    const input = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0, time: i * 16 }));
    const { points } = recordBrushStroke(input, 1);
    expect(points[points.length - 1]).toEqual({ x: 90, y: 0 });
  });

  it('records a tap as a single sample', () => {
    expect(recordBrushStroke([{ x: 5, y: 5, time: 0 }], 0.5).points).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('resolveBrushSamples', () => {
  it('tapers both ends to a point and keeps full width in the middle', () => {
    const points = line(400);
    const samples = resolveBrushSamples(points, brush({ taperStart: 0.25, taperEnd: 0.25, thinning: 0 }, points.length), 0);
    expect(samples[0].r).toBeLessThan(1);
    expect(samples[samples.length - 1].r).toBeLessThan(1);
    expect(samples[Math.floor(samples.length / 2)].r).toBeCloseTo(DEFAULT_BRUSH_TOOL.size / 2);
  });

  it('narrows low-pressure samples by the thinning amount', () => {
    const points = line(40);
    const pressures = points.map(() => 0);
    const none = resolveBrushSamples(points, brush({ taperStart: 0, taperEnd: 0, thinning: 0, pressures }), 0);
    const full = resolveBrushSamples(points, brush({ taperStart: 0, taperEnd: 0, thinning: 1, pressures }), 0);
    expect(none[3].r).toBeCloseTo(30);
    expect(full[3].r).toBeLessThan(1);
  });

  it('draws on deterministically from time and truncates at the tip', () => {
    const points = line(400);
    const b = brush({ drawOnDuration: 2, drawOnHold: 1 }, points.length);
    expect(getBrushDrawOnProgress(b, 1)).toBeCloseTo(0.5);
    expect(getBrushDrawOnProgress(b, 2.5)).toBe(1);
    expect(getBrushDrawOnProgress(b, 4)).toBeCloseTo(0.5);
    const half = resolveBrushSamples(points, b, 1);
    expect(half[half.length - 1].x).toBeCloseTo(200);
    expect(resolveBrushSamples(points, b, 0)).toEqual([]);
  });

  it('is a pure function of time and document state', () => {
    const points = line(300);
    const b = brush({ roughness: 0.8, motionSize: { type: 'sine', speed: 1, amplitude: 20, phase: 0 } }, points.length);
    expect(resolveBrushSamples(points, b, 0.37)).toEqual(resolveBrushSamples(points, b, 0.37));
  });
});

describe('getBrushPieces', () => {
  it('returns convex pieces that all share one winding', () => {
    const points = [...line(200), ...line(200).map(p => ({ x: 200 - p.x, y: 40 }))];
    const pieces = getBrushPieces(points, brush({}, points.length), 0);
    expect(pieces.length).toBe(points.length - 1);
    const signs = new Set(pieces.map(piece => Math.sign(signedArea(piece))));
    expect(signs.size).toBe(1);
  });

  it('covers the stroke body and misses points beyond its width', () => {
    const points = line(400);
    const pieces = getBrushPieces(points, brush({ taperStart: 0, taperEnd: 0, thinning: 0 }, points.length), 0);
    expect(isPointInBrushPieces({ x: 200, y: 25 }, pieces)).toBe(true);
    expect(isPointInBrushPieces({ x: 200, y: 40 }, pieces)).toBe(false);
  });

  it('grows every piece by the outset for the border outline', () => {
    const points = line(100);
    const b = brush({ taperStart: 0, taperEnd: 0, thinning: 0 }, points.length);
    const inner = getPiecesBounds(getBrushPieces(points, b, 0));
    const outer = getPiecesBounds(getBrushPieces(points, b, 0, 10));
    expect(outer.maxY - inner.maxY).toBeCloseTo(10, 0);
  });

  it('flattens a calligraphy nib along its angle', () => {
    const points = [{ x: 0, y: 0 }];
    const flat = getPiecesBounds(getBrushPieces(points, brush({ nibRoundness: 0.2, nibAngle: 0 }, 1), 0));
    expect(flat.maxX - flat.minX).toBeCloseTo(60, 0);
    expect(flat.maxY - flat.minY).toBeLessThan(15);
  });
});

describe('convexHull', () => {
  it('drops interior points', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]);
    expect(hull).toHaveLength(4);
  });
});

describe('normalizePolygonBrush', () => {
  it('keeps pressures parallel to the centerline and clamps ranges', () => {
    const b = normalizePolygonBrush({ pressures: [0.5, 2], thinning: 4, size: -3 }, 3, DEFAULT_BRUSH_TOOL);
    expect(b.pressures).toEqual([0.5, 1, 1]);
    expect(b.thinning).toBe(1);
    expect(b.size).toBe(0);
    expect(b.drawOnDuration).toBe(0);
  });
});
