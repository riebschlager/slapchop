import { describe, expect, it } from 'vitest';
import {
  reverseTriangleWinding,
  generateBoxGeometry,
  generateCylinderGeometry,
  generateExtrudedPolygonGeometry,
  generateMesh3dGeometry,
  generatePlaneGeometry,
  generateRibbonGeometry,
  generateSphereGeometry,
  generateTorusGeometry,
  recomputeNormals,
  triangulatePolygon
} from './geometry3d';
import { createMesh3dLayer } from './mesh3dUtils';
import { Mesh3dPrimitive } from '../types';

function expectValidGeometry(geo: { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array }) {
  const vertexCount = geo.positions.length / 3;
  expect(geo.positions.length % 3).toBe(0);
  expect(geo.normals.length).toBe(geo.positions.length);
  expect(geo.uvs.length).toBe(vertexCount * 2);
  expect(geo.indices.length % 3).toBe(0);
  for (const idx of geo.indices) {
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(vertexCount);
  }
  // Every normal should be finite and roughly unit length.
  for (let i = 0; i < geo.normals.length; i += 3) {
    const len = Math.hypot(geo.normals[i], geo.normals[i + 1], geo.normals[i + 2]);
    expect(Number.isFinite(len)).toBe(true);
    expect(len).toBeGreaterThan(0.9);
    expect(len).toBeLessThan(1.1);
  }
}

describe('generatePlaneGeometry', () => {
  it('produces the expected vertex and triangle counts for a subdivision grid', () => {
    const geo = generatePlaneGeometry(400, 400, 4, 4);
    expect(geo.positions.length / 3).toBe(5 * 5);
    expect(geo.indices.length / 3).toBe(4 * 4 * 2);
    expectValidGeometry(geo);
  });

  it('is centered at the origin and spans the requested width/height', () => {
    const geo = generatePlaneGeometry(200, 100, 1, 1);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < geo.positions.length; i += 3) {
      minX = Math.min(minX, geo.positions[i]);
      maxX = Math.max(maxX, geo.positions[i]);
      minY = Math.min(minY, geo.positions[i + 1]);
      maxY = Math.max(maxY, geo.positions[i + 1]);
    }
    expect(minX).toBeCloseTo(-100);
    expect(maxX).toBeCloseTo(100);
    expect(minY).toBeCloseTo(-50);
    expect(maxY).toBeCloseTo(50);
  });

  it('clamps degenerate subdivisions to at least 1', () => {
    const geo = generatePlaneGeometry(100, 100, 0, -3);
    expect(geo.positions.length / 3).toBe(2 * 2);
  });

  it('is deterministic', () => {
    const a = generatePlaneGeometry(300, 150, 6, 3);
    const b = generatePlaneGeometry(300, 150, 6, 3);
    expect(a).toEqual(b);
  });
});

describe('generateRibbonGeometry', () => {
  it('is a single-row strip along its length', () => {
    const geo = generateRibbonGeometry(600, 80, 10);
    expect(geo.positions.length / 3).toBe(11 * 2);
    expectValidGeometry(geo);
  });
});

describe('generateBoxGeometry', () => {
  it('produces six faces worth of vertices with outward unit normals', () => {
    const geo = generateBoxGeometry(200, 200, 200, 1, 1);
    expect(geo.positions.length / 3).toBe(6 * 4);
    expectValidGeometry(geo);
  });

  it('keeps every vertex on the box surface (within half-extent bounds)', () => {
    const geo = generateBoxGeometry(200, 100, 50, 2, 2);
    for (let i = 0; i < geo.positions.length; i += 3) {
      expect(Math.abs(geo.positions[i])).toBeLessThanOrEqual(100 + 1e-4);
      expect(Math.abs(geo.positions[i + 1])).toBeLessThanOrEqual(50 + 1e-4);
      expect(Math.abs(geo.positions[i + 2])).toBeLessThanOrEqual(25 + 1e-4);
    }
  });

  // Regression test: the +Y/-Y (top/bottom) faces once had their per-face
  // rotation swapped, which left their normals pointing into the box
  // instead of away from it — a bug `expectValidGeometry`'s unit-length
  // check can't catch, since an inward normal is still unit length. Every
  // vertex sits on a single face of a box centered at the origin, so its
  // normal and its own position vector should point into the same
  // half-space (a strictly positive dot product); an inward-facing normal
  // fails this for every vertex on that face.
  it('every vertex normal points away from the box center, not into it', () => {
    const geo = generateBoxGeometry(200, 150, 100, 1, 1);
    for (let i = 0; i < geo.positions.length; i += 3) {
      const px = geo.positions[i], py = geo.positions[i + 1], pz = geo.positions[i + 2];
      const nx = geo.normals[i], ny = geo.normals[i + 1], nz = geo.normals[i + 2];
      const dot = px * nx + py * ny + pz * nz;
      expect(dot).toBeGreaterThan(0);
    }
  });
});

describe('generateCylinderGeometry', () => {
  it('produces a closed side wall with caps', () => {
    const geo = generateCylinderGeometry(100, 100, 300, 12, 4, false);
    expectValidGeometry(geo);
  });

  it('omits caps when openEnded is true', () => {
    const capped = generateCylinderGeometry(100, 100, 300, 12, 4, false);
    const open = generateCylinderGeometry(100, 100, 300, 12, 4, true);
    expect(open.positions.length).toBeLessThan(capped.positions.length);
    expectValidGeometry(open);
  });

  it('supports a truncated cone via differing radii', () => {
    const geo = generateCylinderGeometry(0, 100, 200, 16, 4, false);
    // Top ring (radiusTop=0) should collapse toward the axis.
    let minRadiusAtTop = Infinity;
    for (let i = 0; i < geo.positions.length; i += 3) {
      const y = geo.positions[i + 1];
      if (y < -99) {
        minRadiusAtTop = Math.min(minRadiusAtTop, Math.hypot(geo.positions[i], geo.positions[i + 2]));
      }
    }
    expect(minRadiusAtTop).toBeCloseTo(0, 4);
    expectValidGeometry(geo);
  });
});

describe('generateTorusGeometry', () => {
  it('produces a valid closed ring', () => {
    const geo = generateTorusGeometry(200, 60, 12, 24);
    expectValidGeometry(geo);
  });

  it('keeps every vertex within [radius - tube, radius + tube] of the center axis', () => {
    const geo = generateTorusGeometry(200, 60, 12, 24);
    for (let i = 0; i < geo.positions.length; i += 3) {
      const dist = Math.hypot(geo.positions[i], geo.positions[i + 2]);
      expect(dist).toBeGreaterThanOrEqual(200 - 60 - 1e-3);
      expect(dist).toBeLessThanOrEqual(200 + 60 + 1e-3);
    }
  });
});

describe('generateSphereGeometry', () => {
  it('places every vertex at the sphere radius from the origin', () => {
    const geo = generateSphereGeometry(150, 16, 12);
    for (let i = 0; i < geo.positions.length; i += 3) {
      const dist = Math.hypot(geo.positions[i], geo.positions[i + 1], geo.positions[i + 2]);
      expect(dist).toBeCloseTo(150, 3);
    }
    expectValidGeometry(geo);
  });
});

describe('triangulatePolygon', () => {
  it('triangulates a convex quad into two triangles covering all vertices', () => {
    const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const tris = triangulatePolygon(square);
    expect(tris.length).toBe(6);
    expect(new Set(tris)).toEqual(new Set([0, 1, 2, 3]));
  });

  it('triangulates a non-convex (star-like) polygon without throwing', () => {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? 100 : 45;
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    const tris = triangulatePolygon(points);
    expect(tris.length).toBe((points.length - 2) * 3);
  });

  it('handles clockwise-wound input the same as counter-clockwise', () => {
    const ccw = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const cw = [...ccw].reverse();
    expect(triangulatePolygon(cw).length).toBe(triangulatePolygon(ccw).length);
  });

  it('returns nothing for fewer than 3 points', () => {
    expect(triangulatePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });
});

describe('generateExtrudedPolygonGeometry', () => {
  it('produces front cap, back cap, and side walls for a triangle', () => {
    const contour = [{ x: 0, y: -50 }, { x: 43, y: 25 }, { x: -43, y: 25 }];
    const geo = generateExtrudedPolygonGeometry(contour, 40);
    // 2 caps of 3 verts + 3 side-wall quads of 4 verts each.
    expect(geo.positions.length / 3).toBe(3 * 2 + 3 * 4);
    expectValidGeometry(geo);
  });

  it('keeps cap vertices at +-depth/2', () => {
    const contour = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const geo = generateExtrudedPolygonGeometry(contour, 60);
    const zValues = new Set<number>();
    for (let i = 0; i < contour.length * 2; i++) {
      zValues.add(Math.round(geo.positions[i * 3 + 2]));
    }
    expect(zValues.has(30)).toBe(true);
    expect(zValues.has(-30)).toBe(true);
  });
});

describe('recomputeNormals', () => {
  it('produces unit-length normals for a simple triangle', () => {
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = Uint32Array.from([0, 1, 2]);
    const normals = recomputeNormals(positions, indices);
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 4);
    }
    // Triangle lies in the XY plane, so its normal should point along +/-Z.
    expect(Math.abs(normals[2])).toBeCloseTo(1, 4);
  });
});

describe('generateMesh3dGeometry', () => {
  const primitives: Mesh3dPrimitive[] = ['plane', 'box', 'cylinder', 'torus', 'sphere', 'ribbon', 'extruded-polygon', 'custom-mesh'];

  it('produces valid, non-empty geometry for every primitive using its preset defaults', () => {
    for (const primitive of primitives) {
      const layer = createMesh3dLayer('Test', primitive);
      const geo = generateMesh3dGeometry(layer);
      expect(geo.positions.length).toBeGreaterThan(0);
      expectValidGeometry(geo);
    }
  });

  it('matches the dedicated generator for a plane', () => {
    const layer = createMesh3dLayer('Plane', 'plane', { width: 200, height: 300, subdivisionX: 3, subdivisionY: 2 });
    const geo = generateMesh3dGeometry(layer);
    const expected = generatePlaneGeometry(200, 300, 3, 2);
    expect(geo.positions).toEqual(expected.positions);
    expect(geo.indices).toEqual(expected.indices);
  });
});

describe('reverseTriangleWinding', () => {
  it('reverses each triangle independently, keeping the first vertex fixed', () => {
    const out = reverseTriangleWinding(new Uint32Array([0, 1, 2, 3, 4, 5]));
    expect(Array.from(out)).toEqual([0, 2, 1, 3, 5, 4]);
  });

  it('round-trips: reversing twice restores the original winding', () => {
    const original = new Uint32Array([7, 1, 4, 9, 2, 0, 5, 5, 8]);
    expect(Array.from(reverseTriangleWinding(reverseTriangleWinding(original)))).toEqual(Array.from(original));
  });

  it('flips the sign of every triangle\'s signed area, which is what culling reads', () => {
    // A single triangle in the XY plane; the shoelace sign is exactly what a
    // rasterizer uses to decide front vs back facing.
    const positions = [0, 0, 10, 0, 0, 10];
    const signedArea = (idx: Uint32Array) => {
      const [a, b, c] = [idx[0], idx[1], idx[2]];
      const ax = positions[a * 2], ay = positions[a * 2 + 1];
      const bx = positions[b * 2], by = positions[b * 2 + 1];
      const cx = positions[c * 2], cy = positions[c * 2 + 1];
      return ax * (by - cy) + bx * (cy - ay) + cx * (ay - by);
    };
    const original = new Uint32Array([0, 1, 2]);
    expect(Math.sign(signedArea(reverseTriangleWinding(original)))).toBe(-Math.sign(signedArea(original)));
  });

  it('leaves the geometry itself intact — every index still refers to a real vertex', () => {
    const geo = generateBoxGeometry(200, 200, 200, 2, 2);
    const flipped = reverseTriangleWinding(geo.indices);
    expect(flipped.length).toBe(geo.indices.length);
    expect(new Set(flipped).size).toBe(new Set(geo.indices).size);
    for (const i of flipped) expect(i).toBeLessThan(geo.positions.length / 3);
  });
});
