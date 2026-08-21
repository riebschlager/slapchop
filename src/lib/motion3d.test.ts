import { describe, expect, it } from 'vitest';
import { Camera3dConfig, DEFAULT_CAMERA3D, Mesh3dLayer } from '../types';
import { createMesh3dLayer } from './mesh3dUtils';
import { getMesh3dInstances, getModulatedCamera3d, getModulatedMesh3dLayer, resolveCameraPose } from './motion3d';

function withMotion(layer: Mesh3dLayer, overrides: Partial<Mesh3dLayer>): Mesh3dLayer {
  return { ...layer, ...overrides };
}

describe('getModulatedMesh3dLayer', () => {
  it('is a no-op with no motion configured', () => {
    const layer = createMesh3dLayer('Plane', 'plane');
    expect(getModulatedMesh3dLayer(layer, 5)).toEqual(layer);
  });

  it('applies sine motion to position and preserves scale sign', () => {
    const layer = withMotion(createMesh3dLayer('Plane', 'plane'), {
      x: 100,
      scaleX: -2,
      motionX: { type: 'sine', speed: 1, amplitude: 10, phase: 0 },
      motionScaleX: { type: 'sine', speed: 1, amplitude: 0.5, phase: 0 }
    });
    const t = 0.25; // quarter period -> sin peaks at 1
    const m = getModulatedMesh3dLayer(layer, t);
    expect(m.x).toBeCloseTo(100 + Math.sin(t * Math.PI * 2) * 10, 6);
    expect(Math.sign(m.scaleX)).toBe(-1);
    expect(Math.abs(m.scaleX)).toBeCloseTo(2 + Math.sin(t * Math.PI * 2) * 0.5, 6);
  });
});

describe('getModulatedCamera3d', () => {
  it('modulates distance/pitch/yaw only', () => {
    const camera: Camera3dConfig = { ...DEFAULT_CAMERA3D, motionYaw: { type: 'sine', speed: 1, amplitude: 30, phase: 0 } };
    const m = getModulatedCamera3d(camera, 0.25);
    expect(m.yaw).toBeCloseTo(Math.sin(0.25 * Math.PI * 2) * 30, 6);
    expect(m.distance).toBe(camera.distance);
    expect(m.fov).toBe(camera.fov);
  });
});

describe('getMesh3dInstances', () => {
  it('returns a single primary instance for symmetry "none"', () => {
    const layer = withMotion(createMesh3dLayer('Plane', 'plane'), { x: 10, y: 20, z: 30 });
    const instances = getMesh3dInstances(layer, 0);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ x: 10, y: 20, z: 30, isPrimary: true });
  });

  it('mirror-x produces a second instance with negated scaleX', () => {
    const layer = withMotion(createMesh3dLayer('Plane', 'plane'), {
      x: 50, y: 0, z: 0, symmetry3d: 'mirror-x'
    });
    const instances = getMesh3dInstances(layer, 0);
    expect(instances).toHaveLength(2);
    expect(instances[0].scaleX).toBe(1);
    expect(instances[1].scaleX).toBe(-1);
    expect(instances[1].x).toBe(-50); // mirrored around default origin (0,0,0)
  });

  it('radial-y produces radialSegments3d copies rotated around Y', () => {
    const layer = withMotion(createMesh3dLayer('Plane', 'plane'), {
      x: 100, y: 0, z: 0, symmetry3d: 'radial-y', radialSegments3d: 4
    });
    const instances = getMesh3dInstances(layer, 0);
    expect(instances).toHaveLength(4);
    const yRotations = instances.map((i) => i.rotationYDeg).sort((a, b) => a - b);
    expect(yRotations).toEqual([0, 90, 180, 270]);
  });
});

describe('resolveCameraPose', () => {
  it('at rest (pitch=0, yaw=0), the eye sits on +Z looking at the target', () => {
    const pose = resolveCameraPose(DEFAULT_CAMERA3D, 0);
    expect(pose.eyeX).toBeCloseTo(0, 6);
    expect(pose.eyeY).toBeCloseTo(0, 6);
    expect(pose.eyeZ).toBeCloseTo(DEFAULT_CAMERA3D.distance, 6);
  });

  it('yaw orbits the eye around the target in the XZ plane at constant distance', () => {
    const camera: Camera3dConfig = { ...DEFAULT_CAMERA3D, yaw: 90 };
    const pose = resolveCameraPose(camera, 0);
    expect(pose.eyeX).toBeCloseTo(DEFAULT_CAMERA3D.distance, 4);
    expect(pose.eyeZ).toBeCloseTo(0, 4);
    const radius = Math.hypot(pose.eyeX - pose.targetX, pose.eyeY - pose.targetY, pose.eyeZ - pose.targetZ);
    expect(radius).toBeCloseTo(DEFAULT_CAMERA3D.distance, 4);
  });
});
