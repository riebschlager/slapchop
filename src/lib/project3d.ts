import { Camera3dConfig, Mesh3dLayer } from '../types';
import { CameraPose, getMesh3dInstances, resolveCameraPose } from './motion3d';
import { buildMeshWorldMatrix, mat4LookAt, mat4TransformPoint, Mat4, Vec3 } from './mat4';
import { generateMesh3dGeometry } from './geometry3d';
import { deformGeometry } from './deformation3d';

// World -> canvas projection for 3D Mesh Mode, shared by the CPU renderer
// (render2d.ts's 3D path) and the interactive viewport (CanvasWorkspace's
// camera gestures, mesh picking, and transform gizmo). Both renderers place
// the eye from resolveCameraPose (motion3d.ts); this module is the matching
// single source of truth for where a world point lands *on the canvas*, so
// an on-canvas handle can never drift from the pixels underneath it.
//
// Canvas mapping matches render2d.ts: NDC maps straight to canvas pixels with
// no top/bottom flip, which is what puts world +Y toward the bottom of the
// frame and keeps 3D consistent with this app's Y-down 2D convention. The GPU
// path reaches the same screen positions by a different route — Three renders
// Y-up and pixiRenderer.ts flips the composited sprite — so these coordinates
// are correct for both renderers.

export interface ScreenPoint {
  x: number; // canvas pixels, origin top-left
  y: number;
  viewZ: number; // view-space depth; more negative = farther from the eye
}

export interface Screen3dProjector {
  pose: CameraPose;
  view: Mat4;
  eye: Vec3;
  /** Camera right axis in world space; moving along it moves +x on the canvas. */
  right: Vec3;
  /** Camera up axis in world space; moving along it moves +y on the canvas, i.e. *down* the frame. */
  screenDown: Vec3;
  /** null when the point is at or behind the eye under perspective projection. */
  project(world: Vec3): ScreenPoint | null;
  /**
   * World units spanned by one canvas pixel at a given view depth. Under
   * perspective this grows with distance from the eye, so screen-space drags
   * have to be converted at the depth of the thing being dragged.
   */
  worldPerPixel(viewZ: number): number;
}

export function createScreen3dProjector(
  camera3dRaw: Camera3dConfig,
  t: number,
  width: number,
  height: number
): Screen3dProjector {
  const pose = resolveCameraPose(camera3dRaw, t);
  const eye: Vec3 = [pose.eyeX, pose.eyeY, pose.eyeZ];
  const view = mat4LookAt(eye, [pose.targetX, pose.targetY, pose.targetZ], pose.rollRad);
  const tanHalfFov = Math.tan((pose.fovDeg * Math.PI) / 180 / 2);
  const aspect = width / height;
  const halfHeightWorld = pose.distance * tanHalfFov;
  const orthographic = pose.projection === 'orthographic';

  const project = (world: Vec3): ScreenPoint | null => {
    const v = mat4TransformPoint(view, world);
    let ndcX: number;
    let ndcY: number;
    if (orthographic) {
      ndcX = v[0] / (halfHeightWorld * aspect);
      ndcY = v[1] / halfHeightWorld;
    } else {
      const denom = -v[2];
      if (denom <= 1e-3) return null; // behind or at the camera; dropped rather than clipped
      ndcX = v[0] / denom / tanHalfFov / aspect;
      ndcY = v[1] / denom / tanHalfFov;
    }
    return { x: (ndcX * 0.5 + 0.5) * width, y: (ndcY * 0.5 + 0.5) * height, viewZ: v[2] };
  };

  const worldPerPixel = (viewZ: number): number => orthographic
    ? (2 * halfHeightWorld) / height
    : (2 * Math.max(1e-3, -viewZ) * tanHalfFov) / height;

  return {
    pose,
    view,
    eye,
    right: [view[0], view[4], view[8]],
    screenDown: [view[1], view[5], view[9]],
    project,
    worldPerPixel
  };
}

/**
 * World-space position of a mesh's own local origin for one symmetry
 * instance — the anchor the transform gizmo attaches to. Not the same as the
 * layer's x/y/z whenever a pivot is set (see buildMeshWorldMatrix), so it is
 * derived from the instance matrix rather than read off the layer.
 */
export function getMesh3dInstanceOrigins(layer: Mesh3dLayer, t: number): { origin: Vec3; isPrimary: boolean }[] {
  return getMesh3dInstances(layer, t).map((inst) => {
    const { world } = buildMeshWorldMatrix(
      [inst.x, inst.y, inst.z],
      [layer.pivotX, layer.pivotY, layer.pivotZ],
      (inst.rotationXDeg * Math.PI) / 180,
      (inst.rotationYDeg * Math.PI) / 180,
      (inst.rotationZDeg * Math.PI) / 180,
      [inst.scaleX, inst.scaleY, inst.scaleZ]
    );
    return { origin: mat4TransformPoint(world, [0, 0, 0]), isPrimary: inst.isPrimary };
  });
}

/** Convenience for the gizmo: the primary (un-mirrored, un-arrayed) instance's origin. */
export function getMesh3dPrimaryOrigin(layer: Mesh3dLayer, t: number): Vec3 | null {
  const origins = getMesh3dInstanceOrigins(layer, t);
  const primary = origins.find(o => o.isPrimary) ?? origins[0];
  return primary ? primary.origin : null;
}

function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export interface Mesh3dPick {
  meshId: string;
  /** View depth of the winning triangle; kept so callers can compare picks. */
  viewZ: number;
}

/**
 * Picks the frontmost mesh under a canvas-space point by projecting every
 * visible mesh's deformed geometry and hit-testing the resulting triangles.
 *
 * Deliberately geometry-accurate rather than a projected bounding box: a
 * subdivided, deformed, or symmetrized mesh's silhouette has little to do with
 * its bounds, and clicking a hole in a torus should not select it. Cost is one
 * geometry+deformation pass per visible mesh, which is fine for a click but is
 * why this is not called per frame.
 *
 * Backfaces count as hits — a single-sided plane turned away from the camera is
 * still culled by the renderer, so it is excluded, but the near side of a solid
 * is what wins on depth anyway.
 */
export function pickMesh3dAt(
  point: { x: number; y: number },
  mesh3dLayers: Mesh3dLayer[],
  camera3d: Camera3dConfig,
  t: number,
  width: number,
  height: number
): Mesh3dPick | null {
  const projector = createScreen3dProjector(camera3d, t, width, height);
  let best: Mesh3dPick | null = null;

  for (const layer of mesh3dLayers) {
    if (layer.hidden) continue;
    const deformed = deformGeometry(generateMesh3dGeometry(layer), layer, t);
    const vertexCount = deformed.positions.length / 3;

    for (const inst of getMesh3dInstances(layer, t)) {
      const { world: worldMatrix } = buildMeshWorldMatrix(
        [inst.x, inst.y, inst.z],
        [layer.pivotX, layer.pivotY, layer.pivotZ],
        (inst.rotationXDeg * Math.PI) / 180,
        (inst.rotationYDeg * Math.PI) / 180,
        (inst.rotationZDeg * Math.PI) / 180,
        [inst.scaleX, inst.scaleY, inst.scaleZ]
      );

      const projected: (ScreenPoint | null)[] = new Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        const local: Vec3 = [
          deformed.positions[i * 3],
          deformed.positions[i * 3 + 1],
          deformed.positions[i * 3 + 2]
        ];
        projected[i] = projector.project(mat4TransformPoint(worldMatrix, local));
      }

      for (let idx = 0; idx < deformed.indices.length; idx += 3) {
        const pa = projected[deformed.indices[idx]];
        const pb = projected[deformed.indices[idx + 1]];
        const pc = projected[deformed.indices[idx + 2]];
        if (!pa || !pb || !pc) continue;

        // Same screen-space winding test render2d.ts culls with, so picking
        // agrees with what is actually drawn for single-sided meshes.
        const signedArea = pa.x * (pb.y - pc.y) + pb.x * (pc.y - pa.y) + pc.x * (pa.y - pb.y);
        if (!layer.doubleSided && signedArea > 0) continue;
        if (!pointInTriangle(point.x, point.y, pa.x, pa.y, pb.x, pb.y, pc.x, pc.y)) continue;

        // View z is negative going away from the eye, so the nearest hit is
        // the greatest. Ties go to the later layer, matching stack order.
        const viewZ = (pa.viewZ + pb.viewZ + pc.viewZ) / 3;
        if (!best || viewZ >= best.viewZ) best = { meshId: layer.id, viewZ };
      }
    }
  }

  return best;
}
