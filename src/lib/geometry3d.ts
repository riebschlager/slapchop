import { Mesh3dLayer, PolygonPoint } from '../types';

// Parametric mesh generators for 3D Mesh Mode. Every generator is a pure
// function of its numeric/shape arguments so a given (primitive, params)
// pair always yields the identical vertex buffer, byte-for-byte, whether
// called from a live playback frame or an offline export frame.
//
// Coordinate convention matches the rest of the app: x/y are center-origin
// like Layer/PolygonLayer (y increases downward, same as canvas space); z is
// depth, positive toward the camera. Triangle winding is CCW as seen from
// the default camera (looking from +Z toward the origin), i.e. front faces
// have a normal with a positive Z component when facing the camera at rest.

export interface Mesh3dGeometry {
  positions: Float32Array; // xyz per vertex
  normals: Float32Array; // xyz per vertex
  uvs: Float32Array; // uv per vertex
  indices: Uint32Array; // triangle list, 3 indices per triangle
}

function buildGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[]
): Mesh3dGeometry {
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices)
  };
}

function clampSubdivision(n: number): number {
  return Math.max(1, Math.round(n) || 1);
}

/**
 * A flat, subdivided rectangle in the XY plane at z=0, centered at the
 * origin. The shared building block for planes, box faces, and ribbons.
 */
export function generatePlaneGeometry(
  width: number,
  height: number,
  subdivisionX: number,
  subdivisionY: number
): Mesh3dGeometry {
  const subX = clampSubdivision(subdivisionX);
  const subY = clampSubdivision(subdivisionY);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const halfW = width / 2;
  const halfH = height / 2;

  for (let j = 0; j <= subY; j++) {
    const v = j / subY;
    const y = -halfH + v * height;
    for (let i = 0; i <= subX; i++) {
      const u = i / subX;
      const x = -halfW + u * width;
      positions.push(x, y, 0);
      normals.push(0, 0, 1);
      uvs.push(u, v);
    }
  }

  const cols = subX + 1;
  for (let j = 0; j < subY; j++) {
    for (let i = 0; i < subX; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Two CCW triangles per cell, viewed from +Z.
      indices.push(a, d, b, a, c, d);
    }
  }

  return buildGeometry(positions, normals, uvs, indices);
}

/**
 * A single-strip plane along X, exposed separately from generatePlaneGeometry
 * so ribbon-specific authoring (long, thin, densely subdivided along its
 * length) reads clearly at call sites even though it's the same generator.
 */
export function generateRibbonGeometry(length: number, width: number, segments: number): Mesh3dGeometry {
  return generatePlaneGeometry(length, width, segments, 1);
}

/**
 * Six subdivided plane faces assembled into a box, each rotated/offset into
 * place with outward-facing normals.
 */
export function generateBoxGeometry(
  width: number,
  height: number,
  depth: number,
  subdivisionX: number,
  subdivisionY: number
): Mesh3dGeometry {
  const halfW = width / 2;
  const halfH = height / 2;
  const halfD = depth / 2;

  // Each face: a plane sized for its axes, a rotation to orient its local
  // +Z normal outward, and a translation to its face position.
  const faces: { w: number; h: number; rotate: (p: [number, number, number]) => [number, number, number]; translate: [number, number, number] }[] = [
    { w: width, h: height, rotate: (p) => p, translate: [0, 0, halfD] }, // +Z front
    { w: width, h: height, rotate: ([x, y, z]) => [-x, y, -z], translate: [0, 0, -halfD] }, // -Z back
    { w: depth, h: height, rotate: ([x, y, z]) => [z, y, -x], translate: [halfW, 0, 0] }, // +X right
    { w: depth, h: height, rotate: ([x, y, z]) => [-z, y, x], translate: [-halfW, 0, 0] }, // -X left
    { w: width, h: depth, rotate: ([x, y, z]) => [x, -z, y], translate: [0, halfH, 0] }, // +Y bottom (canvas y-down)
    { w: width, h: depth, rotate: ([x, y, z]) => [x, z, -y], translate: [0, -halfH, 0] } // -Y top
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let indexOffset = 0;

  for (const face of faces) {
    const plane = generatePlaneGeometry(face.w, face.h, subdivisionX, subdivisionY);
    const vertexCount = plane.positions.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      const p: [number, number, number] = [plane.positions[i * 3], plane.positions[i * 3 + 1], plane.positions[i * 3 + 2]];
      const n: [number, number, number] = [plane.normals[i * 3], plane.normals[i * 3 + 1], plane.normals[i * 3 + 2]];
      const rp = face.rotate(p);
      const rn = face.rotate(n);
      positions.push(rp[0] + face.translate[0], rp[1] + face.translate[1], rp[2] + face.translate[2]);
      normals.push(rn[0], rn[1], rn[2]);
      uvs.push(plane.uvs[i * 2], plane.uvs[i * 2 + 1]);
    }
    for (const idx of plane.indices) indices.push(idx + indexOffset);
    indexOffset += vertexCount;
  }

  return buildGeometry(positions, normals, uvs, indices);
}

/**
 * A cylinder (or truncated cone when radiusTop !== radiusBottom) with an
 * optional pair of end caps, centered at the origin along Y.
 */
export function generateCylinderGeometry(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
  heightSegments: number,
  openEnded: boolean
): Mesh3dGeometry {
  const radial = Math.max(3, Math.round(radialSegments) || 3);
  const heightSegs = clampSubdivision(heightSegments);
  const halfH = height / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Precompute the side wall's slant so normals tilt correctly for a cone.
  const slope = (radiusBottom - radiusTop) / height;
  const normalY = slope; // unnormalized; normalized per-vertex below.

  for (let j = 0; j <= heightSegs; j++) {
    const v = j / heightSegs;
    const y = -halfH + v * height;
    const radius = radiusTop + (radiusBottom - radiusTop) * v;
    for (let i = 0; i <= radial; i++) {
      const u = i / radial;
      const theta = u * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      positions.push(radius * sinT, y, radius * cosT);
      const nLen = Math.hypot(sinT, normalY, cosT) || 1;
      normals.push(sinT / nLen, normalY / nLen, cosT / nLen);
      uvs.push(u, v);
    }
  }

  const cols = radial + 1;
  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  if (!openEnded) {
    let indexOffset = positions.length / 3;
    for (const [radius, y, capNormalY, flip] of [
      [radiusTop, -halfH, -1, false],
      [radiusBottom, halfH, 1, true]
    ] as [number, number, number, boolean][]) {
      if (radius <= 0) continue;
      const centerIndex = indexOffset;
      positions.push(0, y, 0);
      normals.push(0, capNormalY, 0);
      uvs.push(0.5, 0.5);
      for (let i = 0; i <= radial; i++) {
        const theta = (i / radial) * Math.PI * 2;
        positions.push(radius * Math.sin(theta), y, radius * Math.cos(theta));
        normals.push(0, capNormalY, 0);
        uvs.push(0.5 + Math.sin(theta) * 0.5, 0.5 + Math.cos(theta) * 0.5);
      }
      for (let i = 0; i < radial; i++) {
        const a = centerIndex + 1 + i;
        const b = centerIndex + 1 + i + 1;
        if (flip) indices.push(centerIndex, b, a);
        else indices.push(centerIndex, a, b);
      }
      indexOffset += radial + 2;
    }
  }

  return buildGeometry(positions, normals, uvs, indices);
}

/**
 * A torus ring in the XZ plane, centered at the origin.
 */
export function generateTorusGeometry(
  radius: number,
  tubeRadius: number,
  radialSegments: number,
  tubularSegments: number
): Mesh3dGeometry {
  const radial = Math.max(3, Math.round(radialSegments) || 8); // around the tube
  const tubular = Math.max(3, Math.round(tubularSegments) || 24); // around the ring

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= tubular; j++) {
    const u = (j / tubular) * Math.PI * 2;
    const cx = Math.cos(u) * radius;
    const cz = Math.sin(u) * radius;
    for (let i = 0; i <= radial; i++) {
      const v = (i / radial) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      const x = (radius + tubeRadius * cosV) * Math.cos(u);
      const y = tubeRadius * sinV;
      const z = (radius + tubeRadius * cosV) * Math.sin(u);
      positions.push(x, y, z);
      // Normal points from the tube's centerline (cx, 0, cz) outward.
      const nx = x - cx;
      const nz = z - cz;
      const nLen = Math.hypot(nx, y, nz) || 1;
      normals.push(nx / nLen, y / nLen, nz / nLen);
      uvs.push(j / tubular, i / radial);
    }
  }

  const cols = radial + 1;
  for (let j = 0; j < tubular; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  return buildGeometry(positions, normals, uvs, indices);
}

/**
 * A UV sphere (latitude/longitude grid), centered at the origin.
 */
export function generateSphereGeometry(
  radius: number,
  widthSegments: number,
  heightSegments: number
): Mesh3dGeometry {
  const widthSegs = Math.max(3, Math.round(widthSegments) || 16);
  const heightSegs = Math.max(2, Math.round(heightSegments) || 12);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= heightSegs; j++) {
    const v = j / heightSegs;
    const phi = v * Math.PI; // 0 (top pole) to PI (bottom pole)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let i = 0; i <= widthSegs; i++) {
      const u = i / widthSegs;
      const theta = u * Math.PI * 2;
      const x = -radius * sinPhi * Math.cos(theta);
      const y = radius * cosPhi;
      const z = radius * sinPhi * Math.sin(theta);
      positions.push(x, y, z);
      const nLen = radius || 1;
      normals.push(x / nLen, y / nLen, z / nLen);
      uvs.push(u, v);
    }
  }

  const cols = widthSegs + 1;
  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < widthSegs; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Degenerate triangles at the poles (a==b positionally) are harmless;
      // skipping them isn't necessary since indices still reference valid
      // (if coincident) vertices produced by the pole ring above.
      if (j !== 0) indices.push(a, b, c);
      if (j !== heightSegs - 1) indices.push(b, d, c);
    }
  }

  return buildGeometry(positions, normals, uvs, indices);
}

/**
 * Ear-clipping triangulation for a simple (non-self-intersecting) polygon.
 * Returns indices into the original `points` array, three per triangle.
 * Throws rather than silently guessing when the contour can't be resolved
 * (e.g. self-intersecting or duplicate-point input), matching the project's
 * convention of surfacing bad input instead of masking it.
 */
export function triangulatePolygon(points: PolygonPoint[]): number[] {
  if (points.length < 3) return [];

  // Ear clipping expects CCW winding; reverse the working order if the
  // signed area says the input is CW, but keep original-index bookkeeping.
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  const remaining = points.map((_, i) => i);
  if (signedArea < 0) remaining.reverse();

  const cross = (o: PolygonPoint, a: PolygonPoint, b: PolygonPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const pointInTriangle = (p: PolygonPoint, a: PolygonPoint, b: PolygonPoint, c: PolygonPoint) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const triangles: number[] = [];
  let guard = remaining.length * remaining.length + 8; // safety bound on ears found
  while (remaining.length > 3 && guard-- > 0) {
    let earFound = false;
    for (let i = 0; i < remaining.length; i++) {
      const prevIdx = remaining[(i - 1 + remaining.length) % remaining.length];
      const currIdx = remaining[i];
      const nextIdx = remaining[(i + 1) % remaining.length];
      const prev = points[prevIdx];
      const curr = points[currIdx];
      const next = points[nextIdx];

      if (cross(prev, curr, next) <= 0) continue; // reflex vertex, not an ear

      let containsOther = false;
      for (const idx of remaining) {
        if (idx === prevIdx || idx === currIdx || idx === nextIdx) continue;
        if (pointInTriangle(points[idx], prev, curr, next)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles.push(prevIdx, currIdx, nextIdx);
      remaining.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) {
      throw new Error('Unable to triangulate polygon: contour may be self-intersecting or degenerate.');
    }
  }
  if (remaining.length === 3) {
    triangles.push(remaining[0], remaining[1], remaining[2]);
  }
  return triangles;
}

/**
 * Extrudes a 2D contour (in the XY plane, center-origin) along Z into a
 * closed solid: a front cap, a back cap, and quad side walls per edge.
 * `bevelSize` is accepted for forward compatibility with the persisted
 * schema but not yet applied — see the 3D mode implementation plan.
 */
export function generateExtrudedPolygonGeometry(contour: PolygonPoint[], depth: number): Mesh3dGeometry {
  if (contour.length < 3) return buildGeometry([], [], [], []);

  const halfD = depth / 2;
  const triangleIndices = triangulatePolygon(contour);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Bounding box for a stable UV projection across front/back caps.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of contour) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  // Front cap (z = +halfD), normal +Z.
  const frontOffset = 0;
  for (const p of contour) {
    positions.push(p.x, p.y, halfD);
    normals.push(0, 0, 1);
    uvs.push((p.x - minX) / spanX, (p.y - minY) / spanY);
  }
  for (let i = 0; i < triangleIndices.length; i += 3) {
    indices.push(
      frontOffset + triangleIndices[i],
      frontOffset + triangleIndices[i + 1],
      frontOffset + triangleIndices[i + 2]
    );
  }

  // Back cap (z = -halfD), normal -Z, winding reversed to face outward.
  const backOffset = contour.length;
  for (const p of contour) {
    positions.push(p.x, p.y, -halfD);
    normals.push(0, 0, -1);
    uvs.push((p.x - minX) / spanX, (p.y - minY) / spanY);
  }
  for (let i = 0; i < triangleIndices.length; i += 3) {
    indices.push(
      backOffset + triangleIndices[i],
      backOffset + triangleIndices[i + 2],
      backOffset + triangleIndices[i + 1]
    );
  }

  // Side walls: one quad per contour edge, normal = outward edge normal.
  let sideOffset = contour.length * 2;
  const perimeter = contour.reduce((sum, p, i) => {
    const next = contour[(i + 1) % contour.length];
    return sum + Math.hypot(next.x - p.x, next.y - p.y);
  }, 0) || 1;
  let traveled = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (b.y - a.y) / edgeLen;
    const ny = -(b.x - a.x) / edgeLen;
    const uA = traveled / perimeter;
    const uB = (traveled + edgeLen) / perimeter;
    traveled += edgeLen;

    positions.push(a.x, a.y, halfD, b.x, b.y, halfD, a.x, a.y, -halfD, b.x, b.y, -halfD);
    normals.push(nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0);
    uvs.push(uA, 0, uB, 0, uA, 1, uB, 1);

    indices.push(
      sideOffset, sideOffset + 2, sideOffset + 1,
      sideOffset + 1, sideOffset + 2, sideOffset + 3
    );
    sideOffset += 4;
  }

  return buildGeometry(positions, normals, uvs, indices);
}

/**
 * Dispatches a Mesh3dLayer's authored geometry fields to the matching
 * generator above. The single entry point both renderers (threeRenderer.ts,
 * render2d.ts's 3D fallback) call for a layer's undeformed base geometry, so
 * "which fields mean what for which primitive" lives in one place.
 *
 * 'custom-mesh' has no dedicated generator yet (importing an external mesh
 * file is out of scope for this pass, see the 3D mode implementation plan);
 * it falls back to a box using the layer's own dimensions as a visible
 * placeholder rather than silently rendering nothing.
 */
export function generateMesh3dGeometry(layer: Mesh3dLayer): Mesh3dGeometry {
  switch (layer.primitive) {
    case 'plane':
      return generatePlaneGeometry(layer.width, layer.height, layer.subdivisionX, layer.subdivisionY);
    case 'ribbon':
      return generateRibbonGeometry(layer.width, layer.height, layer.subdivisionX);
    case 'box':
    case 'custom-mesh':
      return generateBoxGeometry(layer.width, layer.height, layer.depth, layer.subdivisionX, layer.subdivisionY);
    case 'cylinder':
      return generateCylinderGeometry(layer.width / 2, layer.width / 2, layer.height, layer.subdivisionX, layer.subdivisionY, false);
    case 'torus':
      return generateTorusGeometry(layer.width / 2, layer.depth / 2, layer.subdivisionX, layer.subdivisionY);
    case 'sphere':
      return generateSphereGeometry(layer.width / 2, layer.subdivisionX, layer.subdivisionY);
    case 'extruded-polygon':
      return generateExtrudedPolygonGeometry(layer.contour ?? [], layer.depth);
  }
}

/**
 * Recomputes vertex normals from scratch via face-normal accumulation.
 * Used after vertex deformation, where analytic normals no longer apply.
 */
export function recomputeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}
