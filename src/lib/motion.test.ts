import { describe, expect, it } from 'vitest';
import { DEFAULT_SYMMETRY_PARAMS, Layer, PolygonLayer } from '../types';
import { applyMotion, getDeformedPoints, getInstances, getPolygonSymmetryTransforms, getSymmetryTransforms } from './motion';
import { createNewPolygonLayer, createPresetPolygonPoints } from './polygonUtils';

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'test-layer',
    name: 'Test',
    src: '',
    x: 100,
    y: 50,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    symmetry: 'none',
    radialSegments: 6,
    blendMode: 'normal',
    opacity: 1,
    ...overrides
  };
}

describe('applyMotion', () => {
  it('returns the base value when no config is set', () => {
    expect(applyMotion(42, undefined, 1.5)).toBe(42);
    expect(applyMotion(42, { type: 'none', speed: 1, amplitude: 100, phase: 0 }, 1.5)).toBe(42);
  });

  it('sine motion starts at base value and stays within amplitude', () => {
    const config = { type: 'sine' as const, speed: 1, amplitude: 30, phase: 0 };
    expect(applyMotion(10, config, 0)).toBeCloseTo(10);
    for (let t = 0; t < 2; t += 0.1) {
      const v = applyMotion(10, config, t);
      expect(v).toBeGreaterThanOrEqual(10 - 30 - 1e-9);
      expect(v).toBeLessThanOrEqual(10 + 30 + 1e-9);
    }
  });

  it('noise motion stays within amplitude', () => {
    const config = { type: 'noise' as const, speed: 2, amplitude: 20, phase: 1 };
    for (let t = 0; t < 3; t += 0.05) {
      const v = applyMotion(0, config, t);
      expect(Math.abs(v)).toBeLessThanOrEqual(20 + 1e-9);
    }
  });
});

describe('getInstances', () => {
  it('produces the expected instance counts per symmetry type', () => {
    expect(getInstances(makeLayer({ symmetry: 'none' }), 0)).toHaveLength(1);
    expect(getInstances(makeLayer({ symmetry: 'mirror-x' }), 0)).toHaveLength(2);
    expect(getInstances(makeLayer({ symmetry: 'mirror-y' }), 0)).toHaveLength(2);
    expect(getInstances(makeLayer({ symmetry: 'quad' }), 0)).toHaveLength(4);
    expect(getInstances(makeLayer({ symmetry: 'radial', radialSegments: 8 }), 0)).toHaveLength(8);
  });

  it('clamps radial segments to a minimum of 2 and defaults falsy values to 6', () => {
    expect(getInstances(makeLayer({ symmetry: 'radial', radialSegments: 1 }), 0)).toHaveLength(2);
    expect(getInstances(makeLayer({ symmetry: 'radial', radialSegments: 0 }), 0)).toHaveLength(6);
  });

  it('marks exactly one instance as primary', () => {
    const instances = getInstances(makeLayer({ symmetry: 'quad' }), 0);
    expect(instances.filter(i => i.isPrimary)).toHaveLength(1);
    expect(instances[0].isPrimary).toBe(true);
  });

  it('mirror-x flips position and horizontal scale', () => {
    const [primary, mirrored] = getInstances(makeLayer({ symmetry: 'mirror-x', rotation: 15 }), 0);
    expect(mirrored.x).toBeCloseTo(-primary.x);
    expect(mirrored.y).toBeCloseTo(primary.y);
    expect(mirrored.scaleX).toBeCloseTo(-primary.scaleX);
    expect(mirrored.rotation).toBeCloseTo(-primary.rotation);
  });

  it('radial instances sit at equal angles around the center', () => {
    const layer = makeLayer({ symmetry: 'radial', radialSegments: 4, x: 100, y: 0 });
    const instances = getInstances(layer, 0);
    const radius = Math.hypot(layer.x, layer.y);
    instances.forEach(inst => {
      expect(Math.hypot(inst.x, inst.y)).toBeCloseTo(radius);
    });
    expect(instances[1].x).toBeCloseTo(0);
    expect(instances[1].y).toBeCloseTo(100);
  });

  it('re-centers mirror-x on a custom origin instead of the canvas center', () => {
    const layer = makeLayer({
      symmetry: 'mirror-x', x: 120, y: 0,
      symmetryParams: { ...DEFAULT_SYMMETRY_PARAMS, originX: 50, originY: 0 }
    });
    const [, mirrored] = getInstances(layer, 0);
    // Reflect 120 across the line x=50 -> 2*50 - 120 = -20.
    expect(mirrored.x).toBeCloseTo(-20);
  });

  it('spiral produces the configured instance count, shrinking and rotating each step', () => {
    const layer = makeLayer({
      symmetry: 'spiral', x: 100, y: 0,
      symmetryParams: { ...DEFAULT_SYMMETRY_PARAMS, spiralInstances: 5, spiralAngleStep: 30, spiralGrowth: 0.8 }
    });
    const instances = getInstances(layer, 0);
    expect(instances).toHaveLength(5);
    expect(instances[0].isPrimary).toBe(true);
    // Each successive copy sits farther around and closer to the origin.
    const radii = instances.map(inst => Math.hypot(inst.x, inst.y));
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeLessThan(radii[i - 1]);
    }
  });
});

describe('getSymmetryTransforms', () => {
  it('falls back to a single identity transform for an unimplemented type', () => {
    const transforms = getSymmetryTransforms('voronoi', 6, undefined, 10, 20);
    expect(transforms).toEqual([{ x: 10, y: 20, rotationDeg: 0, mirrorX: false, mirrorY: false, scaleMult: 1, isPrimary: true }]);
  });
});

describe('getPolygonSymmetryTransforms', () => {
  function makePolygon(overrides: Partial<PolygonLayer> = {}): PolygonLayer {
    return createNewPolygonLayer('Test Polygon', createPresetPolygonPoints('hexagon', 100), overrides);
  }

  it('defaults to a single identity transform when symmetry is unset', () => {
    const transforms = getPolygonSymmetryTransforms(makePolygon());
    expect(transforms).toHaveLength(1);
    expect(transforms[0]).toMatchObject({ rotationDeg: 0, mirrorX: false, mirrorY: false, scaleMult: 1, isPrimary: true });
  });

  it('produces one transform per radial segment, independent of any base position', () => {
    const transforms = getPolygonSymmetryTransforms(makePolygon({ symmetry: 'radial', radialSegments: 5 }));
    expect(transforms).toHaveLength(5);
    expect(transforms.map(tr => tr.rotationDeg)).toEqual([0, 72, 144, 216, 288]);
  });

  it('voronoi bypasses the instancing engine entirely', () => {
    const transforms = getPolygonSymmetryTransforms(makePolygon({
      symmetry: 'voronoi',
      symmetryParams: { ...DEFAULT_SYMMETRY_PARAMS, originX: 40, originY: -40 }
    }));
    expect(transforms).toHaveLength(1);
    expect(transforms[0].isPrimary).toBe(true);
  });
});

describe('getDeformedPoints', () => {
  function makePolygon(overrides: Partial<PolygonLayer> = {}): PolygonLayer {
    return createNewPolygonLayer('Test Polygon', createPresetPolygonPoints('hexagon', 100), overrides);
  }

  it('returns the same array reference when no vertex noise is configured', () => {
    const polygon = makePolygon();
    expect(getDeformedPoints(polygon, 1)).toBe(polygon.points);
  });

  it('returns the same array reference when vertex noise is explicitly off', () => {
    const polygon = makePolygon({ vertexNoise: { type: 'none', speed: 1, amplitude: 20, phase: 0, incoherence: 0.5 } });
    expect(getDeformedPoints(polygon, 1)).toBe(polygon.points);
  });

  it('displaces every vertex along its own radius from the centroid', () => {
    const polygon = makePolygon({ vertexNoise: { type: 'sine', speed: 1, amplitude: 20, phase: 0, incoherence: 0 } });
    const deformed = getDeformedPoints(polygon, 0.25);
    expect(deformed).toHaveLength(polygon.points.length);
    deformed.forEach((pt, i) => {
      const src = polygon.points[i];
      const dist = Math.hypot(pt.x, pt.y) - Math.hypot(src.x, src.y);
      expect(Math.abs(dist)).toBeGreaterThan(0);
      expect(Math.abs(dist)).toBeLessThanOrEqual(20 + 1e-9);
    });
  });

  it('desyncs vertex phase when incoherence is nonzero, so vertices move differently', () => {
    const polygon = makePolygon({ vertexNoise: { type: 'sine', speed: 1, amplitude: 20, phase: 0, incoherence: 1 } });
    const deformed = getDeformedPoints(polygon, 0.25);
    const offsets = deformed.map((pt, i) => Math.hypot(pt.x, pt.y) - Math.hypot(polygon.points[i].x, polygon.points[i].y));
    const distinct = new Set(offsets.map(o => o.toFixed(6)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
