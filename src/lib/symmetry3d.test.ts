import { describe, expect, it } from 'vitest';
import { DEFAULT_SYMMETRY3D_PARAMS } from '../types';
import { getSymmetry3dTransforms } from './symmetry3d';

describe('getSymmetry3dTransforms', () => {
  it('none returns a single primary instance at the base position', () => {
    const result = getSymmetry3dTransforms('none', 6, DEFAULT_SYMMETRY3D_PARAMS, 10, 20, 30);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ x: 10, y: 20, z: 30, isPrimary: true });
  });

  it('mirror-x reflects across the origin plane', () => {
    const params = { ...DEFAULT_SYMMETRY3D_PARAMS, originX: 0 };
    const result = getSymmetry3dTransforms('mirror-x', 6, params, 50, 0, 0);
    expect(result).toHaveLength(2);
    expect(result[1].x).toBeCloseTo(-50);
    expect(result[1].mirrorX).toBe(true);
  });

  it('mirror-y and mirror-z mirror only their own axis', () => {
    const my = getSymmetry3dTransforms('mirror-y', 6, DEFAULT_SYMMETRY3D_PARAMS, 0, 40, 0);
    expect(my[1].y).toBeCloseTo(-40);
    expect(my[1].mirrorY).toBe(true);

    const mz = getSymmetry3dTransforms('mirror-z', 6, DEFAULT_SYMMETRY3D_PARAMS, 0, 0, 40);
    expect(mz[1].z).toBeCloseTo(-40);
    expect(mz[1].mirrorZ).toBe(true);
  });

  it('radial-y distributes N instances evenly around the Y axis at constant radius and height', () => {
    const N = 8;
    const result = getSymmetry3dTransforms('radial-y', N, DEFAULT_SYMMETRY3D_PARAMS, 100, 0, 0);
    expect(result).toHaveLength(N);
    for (const inst of result) {
      expect(Math.hypot(inst.x, inst.z)).toBeCloseTo(100, 4);
      expect(inst.y).toBeCloseTo(0, 6);
    }
    // Instances should be spread across distinct angles.
    const angles = new Set(result.map(r => Math.round(Math.atan2(r.z, r.x) * 1000)));
    expect(angles.size).toBe(N);
  });

  it('radial-z distributes N instances evenly around the Z axis at constant radius and depth', () => {
    const N = 6;
    const result = getSymmetry3dTransforms('radial-z', N, DEFAULT_SYMMETRY3D_PARAMS, 100, 0, 50);
    expect(result).toHaveLength(N);
    for (const inst of result) {
      expect(Math.hypot(inst.x, inst.y)).toBeCloseTo(100, 4);
      expect(inst.z).toBeCloseTo(50, 6);
    }
  });

  it('helix rises along Y across its instances and respects the configured instance count', () => {
    const params = { ...DEFAULT_SYMMETRY3D_PARAMS, helixInstances: 10, helixRise: 100, helixTurns: 2 };
    const result = getSymmetry3dTransforms('helix', 6, params, 50, 0, 0);
    expect(result).toHaveLength(10);
    expect(result[0].y).toBeCloseTo(0);
    expect(result[result.length - 1].y).toBeGreaterThan(result[0].y);
    // Total rise across all instances should approach helixRise.
    expect(result[result.length - 1].y).toBeCloseTo(90, 0);
  });

  it('cubic-grid produces countX * countY * countZ instances centered on the base position', () => {
    const params = { ...DEFAULT_SYMMETRY3D_PARAMS, cubicGridCountX: 2, cubicGridCountY: 2, cubicGridCountZ: 2, cubicGridSpacing: 100 };
    const result = getSymmetry3dTransforms('cubic-grid', 6, params, 0, 0, 0);
    expect(result).toHaveLength(8);
    const avgX = result.reduce((s, r) => s + r.x, 0) / result.length;
    const avgY = result.reduce((s, r) => s + r.y, 0) / result.length;
    const avgZ = result.reduce((s, r) => s + r.z, 0) / result.length;
    expect(avgX).toBeCloseTo(0);
    expect(avgY).toBeCloseTo(0);
    expect(avgZ).toBeCloseTo(0);
  });

  it('cubic-grid caps the total instance count for a very dense request', () => {
    const params = { ...DEFAULT_SYMMETRY3D_PARAMS, cubicGridCountX: 20, cubicGridCountY: 20, cubicGridCountZ: 20 };
    const result = getSymmetry3dTransforms('cubic-grid', 6, params, 0, 0, 0);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('spherical-shell places every instance at the configured radius from the origin', () => {
    const params = { ...DEFAULT_SYMMETRY3D_PARAMS, sphericalShellCount: 20, sphericalShellRadius: 300 };
    const result = getSymmetry3dTransforms('spherical-shell', 6, params, 0, 0, 0);
    expect(result).toHaveLength(20);
    for (const inst of result) {
      const dist = Math.hypot(inst.x - params.originX, inst.y - params.originY, inst.z - params.originZ);
      expect(dist).toBeCloseTo(300, 3);
    }
  });

  it('spherical-shell caps the instance count for a very large request', () => {
    const params = { ...DEFAULT_SYMMETRY3D_PARAMS, sphericalShellCount: 5000 };
    const result = getSymmetry3dTransforms('spherical-shell', 6, params, 0, 0, 0);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('is deterministic across repeated calls', () => {
    const a = getSymmetry3dTransforms('helix', 6, DEFAULT_SYMMETRY3D_PARAMS, 10, 20, 30);
    const b = getSymmetry3dTransforms('helix', 6, DEFAULT_SYMMETRY3D_PARAMS, 10, 20, 30);
    expect(a).toEqual(b);
  });
});
