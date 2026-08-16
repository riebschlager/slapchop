import {
  DEFAULT_SYMMETRY_PARAMS,
  Layer,
  MotionConfig,
  PolygonLayer,
  PolygonPoint,
  SymmetryParams,
  SymmetryType,
  WallpaperLattice
} from '../types';

const DEG = Math.PI / 180;

export function applyMotion(baseValue: number, config: MotionConfig | undefined, t: number): number {
  if (!config || config.type === 'none') return baseValue;
  if (config.type === 'sine') {
    return baseValue + Math.sin(t * config.speed * Math.PI * 2 + config.phase) * config.amplitude;
  }
  if (config.type === 'noise') {
    const noise = Math.sin(t * config.speed * 1.5 + config.phase)
                * Math.sin(t * config.speed * 0.8 + config.phase * 1.3)
                * Math.cos(t * config.speed * 2.2 - config.phase);
    return baseValue + noise * config.amplitude;
  }
  return baseValue;
}

export function getModulatedLayer(layer: Layer, t: number): Layer {
  return {
    ...layer,
    x: applyMotion(layer.x, layer.motionX, t),
    y: applyMotion(layer.y, layer.motionY, t),
    rotation: applyMotion(layer.rotation, layer.motionRotation, t),
    scaleX: Math.sign(layer.scaleX || 1) * applyMotion(Math.abs(layer.scaleX), layer.motionScale, t),
    scaleY: Math.sign(layer.scaleY || 1) * applyMotion(Math.abs(layer.scaleY), layer.motionScale, t),
  };
}

export type LayerInstance = Layer & { isPrimary: boolean };

// Safety cap on generated copies for lattice/ring modes: a small wallpaper
// cell size or large ring/segment count shouldn't be able to balloon into
// hundreds of GPU sprites / masked polygons.
const MAX_SYMMETRY_INSTANCES = 200;

export function resolveSymmetryParams(raw?: Partial<SymmetryParams>): SymmetryParams {
  return { ...DEFAULT_SYMMETRY_PARAMS, ...raw };
}

/**
 * One symmetrized copy's placement, relative to (originX, originY). x/y are
 * the copy's absolute anchor position (consumed by Layer sprites); rotationDeg
 * /mirrorX/mirrorY/scaleMult describe its orientation change and are also
 * consumed directly by polygon vertex transforms (see transformPolygonPoint),
 * independent of x/y — every mode's orientation fields are computed without
 * reference to the base anchor, so the same InstanceTransform list is valid
 * for both a single-point sprite and a full vertex set.
 */
export interface InstanceTransform {
  x: number;
  y: number;
  rotationDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
  scaleMult: number;
  isPrimary: boolean;
}

function rotateAround(ox: number, oy: number, px: number, py: number, angleDeg: number): { x: number; y: number } {
  const rad = angleDeg * DEG;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = px - ox, dy = py - oy;
  return { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos };
}

// Lattice basis angle + point-group rotational order/mirror for each
// wallpaper variant. p3/p6 share a triangular/hexagonal lattice (60°
// basis) and differ only in local rotational order; p4m uses a square
// lattice (90° basis) with an added mirror per lattice point (dihedral-4).
const WALLPAPER_GROUPS: Record<WallpaperLattice, { order: number; mirror: boolean; basisAngleDeg: number }> = {
  p3: { order: 3, mirror: false, basisAngleDeg: 60 },
  p4m: { order: 4, mirror: true, basisAngleDeg: 90 },
  p6: { order: 6, mirror: false, basisAngleDeg: 60 }
};

/**
 * Core symmetry engine, shared by Layer sprites and PolygonLayer vertex
 * sets. (bx, by) is the shape's own anchor — a Layer's (x, y), or (0, 0)
 * for a polygon (whose vertices carry their own position, so only the
 * orientation-describing fields of each transform are used; see
 * getPolygonInstances). All geometry is relative to (originX, originY),
 * which defaults to the canvas center, preserving today's exact output.
 */
export function getSymmetryTransforms(
  type: SymmetryType,
  radialSegmentsRaw: number,
  paramsRaw: SymmetryParams | undefined,
  bx: number,
  by: number
): InstanceTransform[] {
  const params = resolveSymmetryParams(paramsRaw);
  const ox = params.originX, oy = params.originY;
  const primary = (x: number, y: number): InstanceTransform =>
    ({ x, y, rotationDeg: 0, mirrorX: false, mirrorY: false, scaleMult: 1, isPrimary: true });

  switch (type) {
    case 'none':
      return [primary(bx, by)];

    case 'mirror-x':
      return [
        primary(bx, by),
        { x: 2 * ox - bx, y: by, rotationDeg: 0, mirrorX: true, mirrorY: false, scaleMult: 1, isPrimary: false }
      ];

    case 'mirror-y':
      return [
        primary(bx, by),
        { x: bx, y: 2 * oy - by, rotationDeg: 0, mirrorX: false, mirrorY: true, scaleMult: 1, isPrimary: false }
      ];

    case 'quad':
      return [
        primary(bx, by),
        { x: 2 * ox - bx, y: by, rotationDeg: 0, mirrorX: true, mirrorY: false, scaleMult: 1, isPrimary: false },
        { x: bx, y: 2 * oy - by, rotationDeg: 0, mirrorX: false, mirrorY: true, scaleMult: 1, isPrimary: false },
        { x: 2 * ox - bx, y: 2 * oy - by, rotationDeg: 0, mirrorX: true, mirrorY: true, scaleMult: 1, isPrimary: false }
      ];

    case 'radial': {
      const N = Math.max(2, radialSegmentsRaw || 6);
      const instances: InstanceTransform[] = [];
      for (let i = 0; i < N; i++) {
        const deg = i * (360 / N);
        const p = rotateAround(ox, oy, bx, by, deg);
        instances.push({ x: p.x, y: p.y, rotationDeg: deg, mirrorX: false, mirrorY: false, scaleMult: 1, isPrimary: i === 0 });
      }
      return instances;
    }

    case 'spiral': {
      const N = Math.max(1, Math.round(params.spiralInstances));
      const instances: InstanceTransform[] = [];
      for (let i = 0; i < N; i++) {
        const deg = i * params.spiralAngleStep;
        const scaleMult = Math.pow(params.spiralGrowth, i);
        const p = rotateAround(ox, oy, bx, by, deg);
        // Growth shrinks/grows each copy's *distance from the origin*, not
        // just its size — that's what produces the Droste/vortex spiral
        // rather than a ring of identically-placed shrinking copies.
        const x = ox + (p.x - ox) * scaleMult;
        const y = oy + (p.y - oy) * scaleMult;
        instances.push({ x, y, rotationDeg: deg, mirrorX: false, mirrorY: false, scaleMult, isPrimary: i === 0 });
      }
      return instances;
    }

    case 'wallpaper': {
      const group = WALLPAPER_GROUPS[params.wallpaperLattice] ?? WALLPAPER_GROUPS.p6;
      const cell = Math.max(20, params.wallpaperCellSize);
      const basisRad = group.basisAngleDeg * DEG;
      const a1 = { x: cell, y: 0 };
      const a2 = { x: cell * Math.cos(basisRad), y: cell * Math.sin(basisRad) };
      const halfDiagonal = Math.hypot(1080, 1920) / 2 + cell;
      let margin = Math.max(1, Math.ceil(halfDiagonal / cell));
      const pointGroupSize = group.order * (group.mirror ? 2 : 1);
      while (margin > 1 && (2 * margin + 1) * (2 * margin + 1) * pointGroupSize > MAX_SYMMETRY_INSTANCES) {
        margin--;
      }

      const instances: InstanceTransform[] = [];
      for (let i = -margin; i <= margin; i++) {
        for (let j = -margin; j <= margin; j++) {
          const latX = ox + i * a1.x + j * a2.x;
          const latY = oy + i * a1.y + j * a2.y;
          const isOriginCell = i === 0 && j === 0;
          for (let k = 0; k < group.order; k++) {
            const deg = k * (360 / group.order);
            const rotated = rotateAround(ox, oy, bx, by, deg);
            instances.push({
              x: latX + (rotated.x - ox),
              y: latY + (rotated.y - oy),
              rotationDeg: deg, mirrorX: false, mirrorY: false, scaleMult: 1,
              isPrimary: isOriginCell && k === 0
            });
            if (group.mirror) {
              instances.push({
                x: latX + (rotated.x - ox),
                y: latY + (rotated.y - oy),
                rotationDeg: -deg, mirrorX: true, mirrorY: false, scaleMult: 1,
                isPrimary: false
              });
            }
          }
        }
      }
      return instances;
    }

    case 'poincare': {
      const N = Math.max(2, radialSegmentsRaw || 6);
      const rings = Math.max(1, Math.round(params.poincareRings));
      const boundary = Math.max(20, params.poincareRadius);
      // Ring 0 is the identity (the shape itself, unshrunk); rings 1..rings
      // sit at increasing radius approaching the boundary, shrinking as they
      // go — the visual signature of hyperbolic tiling via plain rigid
      // copies, so both renderers stay in lock-step with no shader/mesh work.
      const instances: InstanceTransform[] = [primary(bx, by)];
      for (let k = 1; k <= rings; k++) {
        const ringRadius = boundary * (1 - Math.pow(0.6, k));
        const ringScale = Math.pow(0.55, k);
        const stagger = (k % 2 === 1) ? (180 / N) : 0;
        for (let i = 0; i < N; i++) {
          const deg = i * (360 / N) + stagger;
          const rad = deg * DEG;
          const x = ox + Math.cos(rad) * ringRadius + (bx - ox) * ringScale;
          const y = oy + Math.sin(rad) * ringRadius + (by - oy) * ringScale;
          instances.push({ x, y, rotationDeg: deg, mirrorX: false, mirrorY: false, scaleMult: ringScale, isPrimary: false });
        }
      }
      return instances;
    }

    case 'voronoi':
      // Voronoi subdivides space rather than repeating a transformed copy,
      // so it has its own renderer code path (src/lib/voronoi.ts) instead
      // of an instance list. Callers must branch on the type before using
      // this function's output for voronoi.
      return [primary(bx, by)];

    default:
      return [primary(bx, by)];
  }
}

export function getInstances(layer: Layer, t: number): LayerInstance[] {
  const m = getModulatedLayer(layer, t);
  const transforms = getSymmetryTransforms(m.symmetry, m.radialSegments, m.symmetryParams, m.x, m.y);
  return transforms.map((tr) => {
    // A single mirror flips the sign of the base rotation (so the sprite
    // still reads "upright" after flipping); a double mirror (quad's 4th
    // instance) cancels back out — matches the exact sign rules the four
    // original modes used before this was generalized.
    const rotationSign = (tr.mirrorX !== tr.mirrorY) ? -1 : 1;
    return {
      ...m,
      x: tr.x,
      y: tr.y,
      rotation: rotationSign * m.rotation + tr.rotationDeg,
      scaleX: m.scaleX * tr.scaleMult * (tr.mirrorX ? -1 : 1),
      scaleY: m.scaleY * tr.scaleMult * (tr.mirrorY ? -1 : 1),
      isPrimary: tr.isPrimary
    };
  });
}

// ---------------------------------------------------------------- polygons

/**
 * Symmetry transforms for a polygon's own content. Unlike a Layer sprite,
 * a polygon has no separate "texture vs. shape" split at the renderer
 * boundary that a plain vertex-coordinate transform could exploit — the
 * texture pattern needs to mirror/rotate along with the shape, just like a
 * Layer's raster does. So renderers don't bake these into new point arrays;
 * instead they wrap the polygon's whole draw (path + pattern + stroke) in a
 * rigid transform around (originX, originY) built from each returned
 * transform's mirrorX/mirrorY/rotationDeg/scaleMult, using the *original*
 * points every time. The x/y fields are unused here (every mode's
 * orientation fields are independent of the anchor passed to
 * getSymmetryTransforms, so (0, 0) is passed and ignored downstream).
 */
export function getPolygonSymmetryTransforms(polygon: PolygonLayer): InstanceTransform[] {
  const type = polygon.symmetry ?? 'none';
  if (type === 'voronoi') {
    return [{ x: 0, y: 0, rotationDeg: 0, mirrorX: false, mirrorY: false, scaleMult: 1, isPrimary: true }];
  }
  const params = resolveSymmetryParams(polygon.symmetryParams);
  return getSymmetryTransforms(type, polygon.radialSegments ?? 6, params, 0, 0);
}

/**
 * "Jelly"/breathing vertex deformation, applied before symmetry (deform ->
 * symmetrize -> render, mirroring getModulatedLayer -> getInstances).
 * Offsets each vertex along its own direction from the polygon's centroid
 * by applyMotion's existing sine/noise curve, reusing that time-pure
 * primitive rather than a new animation system. incoherence desyncs each
 * vertex's phase around the shape (via applyMotion's own `phase` field) so
 * they don't pulse in unison — that's what reads as "jelly" rather than a
 * uniform scale pulse. Returns the original array (same reference) when no
 * deformation is configured, so callers can cheaply detect "unchanged".
 */
export function getDeformedPoints(polygon: PolygonLayer, t: number): PolygonPoint[] {
  const config = polygon.vertexNoise;
  const points = polygon.points;
  if (!config || config.type === 'none' || points.length === 0) return points;

  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  const incoherence = config.incoherence ?? 0;
  const angleStep = (2 * Math.PI) / points.length;
  return points.map((pt, i) => {
    const dx = pt.x - cx, dy = pt.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return pt;
    const nx = dx / dist, ny = dy / dist;
    const vertexConfig = { ...config, phase: config.phase + incoherence * i * angleStep };
    const offset = applyMotion(0, vertexConfig, t);
    return { x: pt.x + nx * offset, y: pt.y + ny * offset };
  });
}
