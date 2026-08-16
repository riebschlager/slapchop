import { describe, expect, it } from 'vitest';
import { Layer } from '../types';
import { applyMotion, getInstances } from './motion';

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
});
