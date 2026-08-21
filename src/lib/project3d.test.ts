import { describe, expect, it } from 'vitest';
import {
  createScreen3dProjector,
  getMesh3dPrimaryOrigin,
  pickMesh3dAt
} from './project3d';
import { createMesh3dLayer } from './mesh3dUtils';
import { DEFAULT_CAMERA3D } from '../types';
import { Vec3 } from './mat4';

const WIDTH = 1080;
const HEIGHT = 1920;

const projector = (overrides = {}) =>
  createScreen3dProjector({ ...DEFAULT_CAMERA3D, ...overrides }, 0, WIDTH, HEIGHT);

describe('createScreen3dProjector', () => {
  it('projects the world origin to the center of the canvas', () => {
    const p = projector().project([0, 0, 0]);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(WIDTH / 2, 6);
    expect(p!.y).toBeCloseTo(HEIGHT / 2, 6);
  });

  it('honors the 1:1 coordinate invariant: a 1080x1920 plane at Z=0 fills the frame', () => {
    const p = projector();
    // Down-right corner. +Y landing at the *bottom* is the Y-down convention
    // the whole app shares; a flipped projection would put it at y=0.
    const corner = p.project([WIDTH / 2, HEIGHT / 2, 0]);
    expect(corner).not.toBeNull();
    expect(corner!.x).toBeCloseTo(WIDTH, 2);
    expect(corner!.y).toBeCloseTo(HEIGHT, 2);

    const opposite = p.project([-WIDTH / 2, -HEIGHT / 2, 0]);
    expect(opposite!.x).toBeCloseTo(0, 2);
    expect(opposite!.y).toBeCloseTo(0, 2);
  });

  it('drops points at or behind the eye under perspective projection', () => {
    const p = projector();
    expect(p.project([0, 0, DEFAULT_CAMERA3D.distance + 10])).toBeNull();
    expect(p.project([0, 0, DEFAULT_CAMERA3D.distance])).toBeNull();
    expect(p.project([0, 0, DEFAULT_CAMERA3D.distance - 100])).not.toBeNull();
  });

  it('ignores depth under orthographic projection', () => {
    const p = projector({ projection: 'orthographic' });
    const near = p.project([200, 100, 500])!;
    const far = p.project([200, 100, -500])!;
    expect(near.x).toBeCloseTo(far.x, 6);
    expect(near.y).toBeCloseTo(far.y, 6);
  });

  it('reports the camera basis in world space, with screenDown pointing at +Y', () => {
    const p = projector();
    expect(p.right[0]).toBeCloseTo(1, 6);
    expect(p.screenDown[1]).toBeCloseTo(1, 6);

    // Yawed a quarter turn, the eye sits on +X looking toward -X, so screen
    // right runs along -Z. Pan and axis-drag math both lean on this.
    const yawed = projector({ yaw: 90 });
    expect(yawed.right[0]).toBeCloseTo(0, 6);
    expect(yawed.right[2]).toBeCloseTo(-1, 6);
  });

  it('scales one canvas pixel to one world unit at the target plane, by construction', () => {
    // The default distance is derived so 1920 canvas pixels span 1920 world
    // units at Z=0; anything else would break drag-to-cursor tracking.
    const p = projector();
    expect(p.worldPerPixel(-DEFAULT_CAMERA3D.distance)).toBeCloseTo(1, 6);
    // Twice as far from the eye, a pixel covers twice as much world.
    expect(p.worldPerPixel(-DEFAULT_CAMERA3D.distance * 2)).toBeCloseTo(2, 6);
  });
});

describe('getMesh3dPrimaryOrigin', () => {
  it('is the layer position when no pivot is set', () => {
    const mesh = createMesh3dLayer('plane', 'plane', { x: 50, y: -20, z: 10, rotationY: 40 });
    const origin = getMesh3dPrimaryOrigin(mesh, 0)!;
    expect(origin[0]).toBeCloseTo(50, 6);
    expect(origin[1]).toBeCloseTo(-20, 6);
    expect(origin[2]).toBeCloseTo(10, 6);
  });

  it('swings the mesh origin around an offset pivot as the mesh rotates', () => {
    const mesh = createMesh3dLayer('plane', 'plane', { pivotX: 100, rotationZ: 90 });
    const origin = getMesh3dPrimaryOrigin(mesh, 0)!;
    // The layer position places the *pivot*, so the mesh's own origin orbits
    // that point at the pivot's length — which is why the gizmo has to read the
    // instance matrix instead of the layer's x/y/z.
    const pivotWorld = [mesh.x + mesh.pivotX, mesh.y + mesh.pivotY, mesh.z + mesh.pivotZ];
    expect(Math.hypot(
      origin[0] - pivotWorld[0],
      origin[1] - pivotWorld[1],
      origin[2] - pivotWorld[2]
    )).toBeCloseTo(100, 4);
    // A quarter turn about Z carries it entirely onto the Y axis.
    expect(origin[0]).toBeCloseTo(100, 4);
    expect(Math.abs(origin[1])).toBeCloseTo(100, 4);
  });
});

describe('pickMesh3dAt', () => {
  const center = { x: WIDTH / 2, y: HEIGHT / 2 };
  const pick = (point: { x: number; y: number }, meshes: Parameters<typeof pickMesh3dAt>[1]) =>
    pickMesh3dAt(point, meshes, DEFAULT_CAMERA3D, 0, WIDTH, HEIGHT);

  it('hits a mesh under the point and misses empty space', () => {
    const plane = createMesh3dLayer('plane', 'plane');
    expect(pick(center, [plane])?.meshId).toBe(plane.id);
    // The default plane is 400x400 at the origin, so a canvas corner is well
    // outside its silhouette.
    expect(pick({ x: 5, y: 5 }, [plane])).toBeNull();
  });

  it('skips hidden meshes', () => {
    const plane = createMesh3dLayer('plane', 'plane', { hidden: true });
    expect(pick(center, [plane])).toBeNull();
  });

  it('picks the mesh nearest the camera when meshes overlap on screen', () => {
    const near = createMesh3dLayer('near', 'plane', { z: 200 });
    const far = createMesh3dLayer('far', 'plane', { z: -200 });
    // Stack order must not decide this — depth does, in both orderings.
    expect(pick(center, [near, far])?.meshId).toBe(near.id);
    expect(pick(center, [far, near])?.meshId).toBe(near.id);
  });

  it('respects backface culling for single-sided meshes', () => {
    const away = createMesh3dLayer('away', 'plane', { rotationY: 180, doubleSided: false });
    expect(pick(center, [away])).toBeNull();
    expect(pick(center, [{ ...away, doubleSided: true }])?.meshId).toBe(away.id);
  });

  it('picks a mesh that has been moved off center only where it now appears', () => {
    // 300 world units right of the origin is 300 canvas px right of center at
    // the default camera (see the 1:1 invariant above).
    const moved = createMesh3dLayer('moved', 'plane', { x: 300 });
    expect(pick(center, [moved])).toBeNull();
    expect(pick({ x: center.x + 300, y: center.y }, [moved])?.meshId).toBe(moved.id);
  });

  it('follows motion modulation, so picking matches the animated frame', () => {
    const drifting = createMesh3dLayer('drifting', 'plane', {
      motionX: { type: 'sine', amplitude: 300, speed: 0.25, phase: 0 }
    });
    // A quarter-period in, sine motion has carried the mesh to +amplitude.
    const t = 1;
    const atRest = pickMesh3dAt({ x: center.x, y: center.y }, [drifting], DEFAULT_CAMERA3D, 0, WIDTH, HEIGHT);
    const moved = pickMesh3dAt({ x: center.x + 300, y: center.y }, [drifting], DEFAULT_CAMERA3D, t, WIDTH, HEIGHT);
    expect(atRest?.meshId).toBe(drifting.id);
    expect(moved?.meshId).toBe(drifting.id);
    expect(pickMesh3dAt({ x: center.x, y: center.y }, [drifting], DEFAULT_CAMERA3D, t, WIDTH, HEIGHT)).toBeNull();
  });

  it('agrees with the projector about where a mesh origin is', () => {
    const mesh = createMesh3dLayer('mesh', 'plane', { x: -120, y: 240 });
    const origin = getMesh3dPrimaryOrigin(mesh, 0) as Vec3;
    const screen = projector().project(origin)!;
    expect(pick({ x: screen.x, y: screen.y }, [mesh])?.meshId).toBe(mesh.id);
  });
});
