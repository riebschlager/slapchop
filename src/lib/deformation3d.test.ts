import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_DEFORMER,
  DEFAULT_SINE_WAVE_DEFORMER,
  DEFAULT_TWIST_DEFORMER,
  DEFAULT_VERTEX_JELLY,
  Mesh3dLayer
} from '../types';
import {
  applyNoiseDeformer,
  applySineWaveDeformer,
  applyTwistDeformer,
  applyVertexJelly,
  deformGeometry,
  fbm3D
} from './deformation3d';
import { generatePlaneGeometry } from './geometry3d';
import { createMesh3dLayer } from './mesh3dUtils';

describe('applySineWaveDeformer', () => {
  it('returns zero displacement when disabled', () => {
    const [dx, dy, dz] = applySineWaveDeformer(10, 20, 30, 0, 1, 0, 0.5, 1, DEFAULT_SINE_WAVE_DEFORMER);
    expect([dx, dy, dz]).toEqual([0, 0, 0]);
  });

  it('is deterministic for identical inputs', () => {
    const config = { ...DEFAULT_SINE_WAVE_DEFORMER, enabled: true };
    const a = applySineWaveDeformer(10, 20, 30, 0, 1, 0, 0.5, 1.25, config);
    const b = applySineWaveDeformer(10, 20, 30, 0, 1, 0, 0.5, 1.25, config);
    expect(a).toEqual(b);
  });

  it('stays within the configured amplitude along the normal direction', () => {
    const config = { ...DEFAULT_SINE_WAVE_DEFORMER, enabled: true, amplitude: 25, decay: 0 };
    for (let t = 0; t < 2; t += 0.1) {
      const [, dy] = applySineWaveDeformer(0, 100, 0, 0, 1, 0, 0, t, config);
      expect(Math.abs(dy)).toBeLessThanOrEqual(25 + 1e-9);
    }
  });

  it('decay attenuates displacement further from the axis origin', () => {
    const config = { ...DEFAULT_SINE_WAVE_DEFORMER, enabled: true, decay: 2, frequency: 0.0001, speed: 0, phase: 90 };
    const near = applySineWaveDeformer(0, 10, 0, 0, 1, 0, 0, 0, config);
    const far = applySineWaveDeformer(0, 1000, 0, 0, 1, 0, 0, 0, config);
    expect(Math.abs(far[1])).toBeLessThan(Math.abs(near[1]));
  });
});

describe('applyNoiseDeformer', () => {
  it('returns zero displacement when disabled', () => {
    const result = applyNoiseDeformer(1, 2, 3, 0, 1, 0, 0.5, DEFAULT_NOISE_DEFORMER);
    expect(result).toEqual([0, 0, 0]);
  });

  it('is deterministic for a given seed', () => {
    const config = { ...DEFAULT_NOISE_DEFORMER, enabled: true };
    const a = applyNoiseDeformer(5, 10, 15, 0, 1, 0, 0.75, config);
    const b = applyNoiseDeformer(5, 10, 15, 0, 1, 0, 0.75, config);
    expect(a).toEqual(b);
  });

  it('produces a different result for a different seed', () => {
    const base = { ...DEFAULT_NOISE_DEFORMER, enabled: true };
    const a = applyNoiseDeformer(5, 10, 15, 0, 1, 0, 0.75, base);
    const b = applyNoiseDeformer(5, 10, 15, 0, 1, 0, 0.75, { ...base, seed: 99 });
    expect(a).not.toEqual(b);
  });

  it('spherical mode displaces along the direction from the origin', () => {
    const config = { ...DEFAULT_NOISE_DEFORMER, enabled: true, displacementMode: 'spherical' as const };
    const [dx, dy, dz] = applyNoiseDeformer(0, 100, 0, 0, 1, 0, 0, config);
    // Displacement should be purely along Y (the vertex's direction from origin).
    expect(dx).toBeCloseTo(0, 6);
    expect(dz).toBeCloseTo(0, 6);
    expect(Math.abs(dy)).toBeGreaterThan(0);
  });
});

describe('fbm3D', () => {
  it('stays within a roughly normalized range', () => {
    for (let i = 0; i < 50; i++) {
      const v = fbm3D(i * 0.37, i * 1.1, i * 0.5, 1, 4, 0.5);
      expect(v).toBeGreaterThanOrEqual(-1.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });

  it('more octaves changes the output relative to a single octave', () => {
    const one = fbm3D(1.234, 5.678, 9.1, 1, 1, 0.5);
    const many = fbm3D(1.234, 5.678, 9.1, 1, 6, 0.5);
    expect(one).not.toBeCloseTo(many, 6);
  });
});

describe('applyTwistDeformer', () => {
  it('is a no-op when disabled', () => {
    expect(applyTwistDeformer(10, 20, 30, 0, DEFAULT_TWIST_DEFORMER, 100)).toEqual([10, 20, 30]);
  });

  it('preserves distance from the twist axis', () => {
    const config = { ...DEFAULT_TWIST_DEFORMER, enabled: true, axis: 'y' as const, angle: 180, speed: 0 };
    const [x, , z] = applyTwistDeformer(50, 100, 0, 0, config, 200);
    expect(Math.hypot(x, z)).toBeCloseTo(50, 4);
  });

  it('leaves the axis coordinate itself unchanged', () => {
    const config = { ...DEFAULT_TWIST_DEFORMER, enabled: true, axis: 'y' as const, angle: 90, speed: 0 };
    const [, y] = applyTwistDeformer(50, 123, 10, 0, config, 200);
    expect(y).toBe(123);
  });
});

describe('applyVertexJelly', () => {
  it('is a no-op when disabled', () => {
    expect(applyVertexJelly(0, 1, 0, 3, 0.5, DEFAULT_VERTEX_JELLY)).toEqual([0, 0, 0]);
  });

  it('desyncs phase between vertices via incoherence', () => {
    const config = { ...DEFAULT_VERTEX_JELLY, enabled: true, incoherence: 1 };
    const a = applyVertexJelly(0, 1, 0, 0, 0.5, config);
    const b = applyVertexJelly(0, 1, 0, 7, 0.5, config);
    expect(a).not.toEqual(b);
  });

  it('produces identical output for identical vertex index and time', () => {
    const config = { ...DEFAULT_VERTEX_JELLY, enabled: true };
    expect(applyVertexJelly(0, 1, 0, 4, 0.25, config)).toEqual(applyVertexJelly(0, 1, 0, 4, 0.25, config));
  });
});

describe('deformGeometry', () => {
  function makeLayer(overrides: Partial<Mesh3dLayer> = {}): Mesh3dLayer {
    return createMesh3dLayer('Test Plane', 'plane', { width: 200, height: 200, subdivisionX: 4, subdivisionY: 4, ...overrides });
  }

  it('returns the same geometry reference when no deformer is enabled', () => {
    const geo = generatePlaneGeometry(200, 200, 4, 4);
    const layer = makeLayer();
    expect(deformGeometry(geo, layer, 1)).toBe(geo);
  });

  it('returns a new geometry with displaced positions when a deformer is enabled', () => {
    const geo = generatePlaneGeometry(200, 200, 4, 4);
    const layer = makeLayer({ sineWaveDeformer: { ...DEFAULT_SINE_WAVE_DEFORMER, enabled: true, amplitude: 50 } });
    const deformed = deformGeometry(geo, layer, 0.5);
    expect(deformed).not.toBe(geo);
    expect(deformed.positions).not.toEqual(geo.positions);
    expect(deformed.uvs).toBe(geo.uvs);
    expect(deformed.indices).toBe(geo.indices);
  });

  it('is deterministic for a given time', () => {
    const geo = generatePlaneGeometry(200, 200, 4, 4);
    const layer = makeLayer({
      noiseDeformer: { ...DEFAULT_NOISE_DEFORMER, enabled: true },
      vertexJelly: { ...DEFAULT_VERTEX_JELLY, enabled: true }
    });
    const a = deformGeometry(geo, layer, 1.5);
    const b = deformGeometry(geo, layer, 1.5);
    expect(a.positions).toEqual(b.positions);
    expect(a.normals).toEqual(b.normals);
  });

  it('produces finite, unit-length recomputed normals', () => {
    const geo = generatePlaneGeometry(200, 200, 6, 6);
    const layer = makeLayer({ noiseDeformer: { ...DEFAULT_NOISE_DEFORMER, enabled: true, amplitude: 40 } });
    const deformed = deformGeometry(geo, layer, 2);
    for (let i = 0; i < deformed.normals.length; i += 3) {
      const len = Math.hypot(deformed.normals[i], deformed.normals[i + 1], deformed.normals[i + 2]);
      expect(Number.isFinite(len)).toBe(true);
      expect(len).toBeCloseTo(1, 3);
    }
  });
});
