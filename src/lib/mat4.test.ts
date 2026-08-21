import { describe, expect, it } from 'vitest';
import {
  buildMeshWorldMatrix,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4RotationY,
  mat4TransformPoint,
  vecCross,
  vecDot,
  vecNormalize
} from './mat4';

describe('mat4Multiply', () => {
  it('identity is a no-op', () => {
    const m = mat4RotationY(0.7);
    expect(mat4Multiply(mat4Identity(), m)).toEqual(m);
    expect(mat4Multiply(m, mat4Identity())).toEqual(m);
  });
});

describe('mat4TransformPoint', () => {
  it('translates, rotates, and scales as expected in isolation', () => {
    const world = buildMeshWorldMatrix([10, 0, 0], [0, 0, 0], 0, 0, 0, [1, 1, 1]).world;
    expect(mat4TransformPoint(world, [0, 0, 0])).toEqual([10, 0, 0]);
  });

  it('rotationY of 90deg maps +X to -Z (standard right-handed rotation about Y)', () => {
    const world = buildMeshWorldMatrix([0, 0, 0], [0, 0, 0], 0, Math.PI / 2, 0, [1, 1, 1]).world;
    const [x, y, z] = mat4TransformPoint(world, [1, 0, 0]);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1, 6);
  });

  it('pivot keeps the pivot point fixed under rotation', () => {
    const pivot: [number, number, number] = [50, 0, 0];
    const position: [number, number, number] = [100, 20, 0];
    const world = buildMeshWorldMatrix(position, pivot, 0, Math.PI / 3, 0, [1, 1, 1]).world;
    // The vertex sitting exactly at the pivot's local position should land at
    // position+pivot in world space regardless of rotation.
    const result = mat4TransformPoint(world, pivot);
    expect(result[0]).toBeCloseTo(position[0] + pivot[0], 6);
    expect(result[1]).toBeCloseTo(position[1] + pivot[1], 6);
    expect(result[2]).toBeCloseTo(position[2] + pivot[2], 6);
  });

  it('at rest (identity rotation/scale, zero pivot) reduces to a plain translation', () => {
    const world = buildMeshWorldMatrix([5, -7, 3], [0, 0, 0], 0, 0, 0, [1, 1, 1]).world;
    expect(mat4TransformPoint(world, [1, 2, 3])).toEqual([6, -5, 6]);
  });
});

describe('mat4LookAt', () => {
  it('camera at rest (eye on +Z, target at origin) sends +X to +X and +Y to +Y in view space', () => {
    // This underpins render2d.ts's screen-mapping convention: see its module
    // comment and geometry3d.ts's own "front faces point toward +Z" note.
    const view = mat4LookAt([0, 0, 500], [0, 0, 0], 0);
    const right = mat4TransformPoint(view, [100, 0, 0]);
    const up = mat4TransformPoint(view, [0, 100, 0]);
    expect(right[0]).toBeCloseTo(100, 6);
    expect(right[1]).toBeCloseTo(0, 6);
    expect(up[0]).toBeCloseTo(0, 6);
    expect(up[1]).toBeCloseTo(100, 6);
  });

  it('places a point in front of the camera at a negative view-space Z (OpenGL convention)', () => {
    const view = mat4LookAt([0, 0, 500], [0, 0, 0], 0);
    const viewSpace = mat4TransformPoint(view, [0, 0, 0]);
    expect(viewSpace[2]).toBeCloseTo(-500, 6);
  });

  it('does not degenerate when looking straight down (pitch = 90deg)', () => {
    const view = mat4LookAt([0, -500, 0], [0, 0, 0], 0);
    for (const row of view) expect(Number.isFinite(row)).toBe(true);
  });
});

describe('render2d 3D fallback winding convention', () => {
  // Locks in the sign render2d.ts's renderMesh3dScene relies on for backface
  // culling: a front-facing triangle (as wound by geometry3d.ts, viewed by a
  // camera at rest) projects to a NEGATIVE screen-space shoelace signed area
  // under this app's "no Y-flip" NDC-to-canvas mapping. See mat4LookAt's and
  // render2d.ts's module comments for the derivation.
  it('a front-facing triangle at rest produces a negative signed screen area', () => {
    const view = mat4LookAt([0, 0, 500], [0, 0, 0], 0);
    const fovRad = (45 * Math.PI) / 180;
    const tanHalf = Math.tan(fovRad / 2);
    const project = (p: [number, number, number]) => {
      const v = mat4TransformPoint(view, p);
      const denom = -v[2];
      const ndcX = v[0] / denom / tanHalf;
      const ndcY = v[1] / denom / tanHalf;
      return { x: (ndcX * 0.5 + 0.5) * 1080, y: (ndcY * 0.5 + 0.5) * 1920 };
    };

    // Matches generatePlaneGeometry's first triangle (v0, v3, v1) for a
    // 1x1-subdivision plane: (-hw,-hh,0), (hw,hh,0), (hw,-hh,0).
    const a = project([-50, -50, 0]);
    const b = project([50, 50, 0]);
    const c = project([50, -50, 0]);
    const signedArea = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
    expect(signedArea).toBeLessThan(0);
  });
});

describe('vec helpers', () => {
  it('cross and dot behave as expected', () => {
    expect(vecCross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(vecDot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(vecNormalize([3, 4, 0])).toEqual([0.6, 0.8, 0]);
  });
});

describe('renderer parity: buildMeshWorldMatrix vs Three Object3D', () => {
  // threeRenderer.ts builds the same transform out of Three's own
  // Group/Mesh nodes rather than this module, so the Euler order it picks
  // has to be the one whose matrix equals buildMeshWorldMatrix's
  // Rz*Ry*Rx composition. Anything else silently diverges the GPU and CPU
  // 3D paths as soon as two rotation axes are in play at once.
  it('matches Three ZYX Euler rotation about a pivot, with scale', async () => {
    const THREE = await import('three');

    const position: [number, number, number] = [120, -40, 30];
    const pivot: [number, number, number] = [25, 60, -10];
    const rot: [number, number, number] = [0.4, -0.9, 1.3];
    const scale: [number, number, number] = [1.4, 0.7, -1.1];

    const world = buildMeshWorldMatrix(position, pivot, rot[0], rot[1], rot[2], scale).world;

    const anchor = new THREE.Group();
    anchor.position.set(position[0] + pivot[0], position[1] + pivot[1], position[2] + pivot[2]);
    anchor.rotation.set(rot[0], rot[1], rot[2], 'ZYX');
    anchor.scale.set(scale[0], scale[1], scale[2]);
    const mesh = new THREE.Mesh();
    mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
    anchor.add(mesh);
    anchor.updateMatrixWorld(true);

    for (const local of [[0, 0, 0], [100, 0, 0], [0, 100, 0], [0, 0, 100], [-70, 45, 15]] as const) {
      const cpu = mat4TransformPoint(world, local as unknown as [number, number, number]);
      const gpu = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(mesh.matrixWorld);
      expect(cpu[0]).toBeCloseTo(gpu.x, 6);
      expect(cpu[1]).toBeCloseTo(gpu.y, 6);
      expect(cpu[2]).toBeCloseTo(gpu.z, 6);
    }
  });
});
