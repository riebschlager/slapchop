import { DEFAULT_SYMMETRY3D_PARAMS, Symmetry3dParams, Symmetry3dType } from '../types';

// 3D counterpart to motion.ts's getSymmetryTransforms: a pure function from
// (type, params, base position) to a list of rigid instance transforms. Each
// mesh is rendered once per returned instance; deformation happens upstream
// on the base geometry, so every instance shares the same deformed vertices
// and differs only in placement.

// Mirrors MAX_SYMMETRY_INSTANCES in motion.ts: bounds worst-case instance
// count (dense cubic grids, large helices) so a mesh with real-time vertex
// deformation can't balloon into hundreds of simultaneously-deforming copies.
const MAX_SYMMETRY3D_INSTANCES = 200;

export interface InstanceTransform3d {
  x: number;
  y: number;
  z: number;
  rotationXDeg: number;
  rotationYDeg: number;
  rotationZDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
  mirrorZ: boolean;
  scaleMult: number;
  isPrimary: boolean;
}

export function resolveSymmetry3dParams(raw?: Partial<Symmetry3dParams>): Symmetry3dParams {
  return { ...DEFAULT_SYMMETRY3D_PARAMS, ...raw };
}

function primary(x: number, y: number, z: number): InstanceTransform3d {
  return { x, y, z, rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0, mirrorX: false, mirrorY: false, mirrorZ: false, scaleMult: 1, isPrimary: true };
}

const DEG = Math.PI / 180;

export function getSymmetry3dTransforms(
  type: Symmetry3dType,
  radialSegmentsRaw: number,
  paramsRaw: Symmetry3dParams | undefined,
  bx: number,
  by: number,
  bz: number
): InstanceTransform3d[] {
  const params = resolveSymmetry3dParams(paramsRaw);
  const ox = params.originX, oy = params.originY, oz = params.originZ;

  switch (type) {
    case 'none':
      return [primary(bx, by, bz)];

    case 'mirror-x':
      return [
        primary(bx, by, bz),
        { x: 2 * ox - bx, y: by, z: bz, rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0, mirrorX: true, mirrorY: false, mirrorZ: false, scaleMult: 1, isPrimary: false }
      ];

    case 'mirror-y':
      return [
        primary(bx, by, bz),
        { x: bx, y: 2 * oy - by, z: bz, rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0, mirrorX: false, mirrorY: true, mirrorZ: false, scaleMult: 1, isPrimary: false }
      ];

    case 'mirror-z':
      return [
        primary(bx, by, bz),
        { x: bx, y: by, z: 2 * oz - bz, rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0, mirrorX: false, mirrorY: false, mirrorZ: true, scaleMult: 1, isPrimary: false }
      ];

    case 'radial-y': {
      // Ring of copies rotated around the vertical (Y) axis, in the XZ plane.
      const N = Math.max(2, Math.round(radialSegmentsRaw) || 6);
      const instances: InstanceTransform3d[] = [];
      const dx0 = bx - ox, dz0 = bz - oz;
      const radius = Math.hypot(dx0, dz0);
      const baseAngle = Math.atan2(dz0, dx0);
      for (let i = 0; i < N; i++) {
        const deg = i * (360 / N);
        const rad = baseAngle + deg * DEG;
        instances.push({
          x: ox + Math.cos(rad) * radius,
          y: by,
          z: oz + Math.sin(rad) * radius,
          rotationXDeg: 0, rotationYDeg: deg, rotationZDeg: 0,
          mirrorX: false, mirrorY: false, mirrorZ: false, scaleMult: 1,
          isPrimary: i === 0
        });
      }
      return instances;
    }

    case 'radial-z': {
      // Ring of copies rotated around the depth (Z) axis, in the XY plane —
      // the 3D analog of the 2D 'radial' mode.
      const N = Math.max(2, Math.round(radialSegmentsRaw) || 6);
      const instances: InstanceTransform3d[] = [];
      const dx0 = bx - ox, dy0 = by - oy;
      const radius = Math.hypot(dx0, dy0);
      const baseAngle = Math.atan2(dy0, dx0);
      for (let i = 0; i < N; i++) {
        const deg = i * (360 / N);
        const rad = baseAngle + deg * DEG;
        instances.push({
          x: ox + Math.cos(rad) * radius,
          y: oy + Math.sin(rad) * radius,
          z: bz,
          rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: deg,
          mirrorX: false, mirrorY: false, mirrorZ: false, scaleMult: 1,
          isPrimary: i === 0
        });
      }
      return instances;
    }

    case 'helix': {
      // A spiral ladder: each instance advances around Y and rises along Y,
      // like radial-y with a per-step vertical offset.
      const N = Math.max(1, Math.min(MAX_SYMMETRY3D_INSTANCES, Math.round(params.helixInstances)));
      const degPerStep = N > 0 ? (params.helixTurns * 360) / N : 0;
      const risePerStep = N > 0 ? params.helixRise / N : 0;
      const dx0 = bx - ox, dz0 = bz - oz;
      const radius = Math.hypot(dx0, dz0);
      const baseAngle = Math.atan2(dz0, dx0);
      const instances: InstanceTransform3d[] = [];
      for (let i = 0; i < N; i++) {
        const deg = i * degPerStep;
        const rad = baseAngle + deg * DEG;
        instances.push({
          x: ox + Math.cos(rad) * radius,
          y: by + i * risePerStep,
          z: oz + Math.sin(rad) * radius,
          rotationXDeg: 0, rotationYDeg: deg, rotationZDeg: 0,
          mirrorX: false, mirrorY: false, mirrorZ: false, scaleMult: 1,
          isPrimary: i === 0
        });
      }
      return instances;
    }

    case 'cubic-grid': {
      // A 3D lattice of copies centered on the base position, capped to
      // MAX_SYMMETRY3D_INSTANCES by shrinking the requested extents evenly.
      let countX = Math.max(1, Math.round(params.cubicGridCountX));
      let countY = Math.max(1, Math.round(params.cubicGridCountY));
      let countZ = Math.max(1, Math.round(params.cubicGridCountZ));
      while (countX * countY * countZ > MAX_SYMMETRY3D_INSTANCES) {
        if (countX >= countY && countX >= countZ && countX > 1) countX--;
        else if (countY >= countZ && countY > 1) countY--;
        else if (countZ > 1) countZ--;
        else break;
      }
      const spacing = Math.max(1, params.cubicGridSpacing);
      const instances: InstanceTransform3d[] = [];
      let isFirst = true;
      for (let i = 0; i < countX; i++) {
        for (let j = 0; j < countY; j++) {
          for (let k = 0; k < countZ; k++) {
            const x = bx + (i - (countX - 1) / 2) * spacing;
            const y = by + (j - (countY - 1) / 2) * spacing;
            const z = bz + (k - (countZ - 1) / 2) * spacing;
            instances.push({
              x, y, z, rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0,
              mirrorX: false, mirrorY: false, mirrorZ: false, scaleMult: 1,
              isPrimary: isFirst
            });
            isFirst = false;
          }
        }
      }
      return instances;
    }

    case 'spherical-shell': {
      // Even distribution over a sphere surface via the Fibonacci sphere
      // algorithm: deterministic, no RNG, and avoids the polar clustering
      // a naive latitude/longitude grid would produce.
      const N = Math.max(1, Math.min(MAX_SYMMETRY3D_INSTANCES, Math.round(params.sphericalShellCount)));
      const radius = Math.max(1, params.sphericalShellRadius);
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const instances: InstanceTransform3d[] = [];
      for (let i = 0; i < N; i++) {
        const yFrac = N > 1 ? 1 - (i / (N - 1)) * 2 : 0;
        const ringRadius = Math.sqrt(Math.max(0, 1 - yFrac * yFrac));
        const theta = goldenAngle * i;
        const x = ox + Math.cos(theta) * ringRadius * radius;
        const y = oy + yFrac * radius;
        const z = oz + Math.sin(theta) * ringRadius * radius;
        // Orient each instance's local Y axis to point outward from center,
        // so e.g. a plane primitive reads as a facet of the shell.
        const rotationYDeg = Math.atan2(x - ox, z - oz) / DEG;
        const rotationXDeg = -Math.asin(Math.max(-1, Math.min(1, yFrac))) / DEG;
        instances.push({
          x, y, z, rotationXDeg, rotationYDeg, rotationZDeg: 0,
          mirrorX: false, mirrorY: false, mirrorZ: false, scaleMult: 1,
          isPrimary: i === 0
        });
      }
      return instances;
    }

    default:
      return [primary(bx, by, bz)];
  }
}
