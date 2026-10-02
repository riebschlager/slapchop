import type { GridConfig } from './model';

export interface GridPoint { x: number; y: number }
/** Clockwise from top-left; both renderers split along the same TL–BR diagonal. */
export type GridQuad = [GridPoint, GridPoint, GridPoint, GridPoint];

export function resolveGridVertices(xs: number[], ys: number[], c: GridConfig, t: number): GridPoint[] {
  const columns = xs.length - 1;
  const rows = ys.length - 1;
  const motion = c.motionPattern === 'ripple' ? c.ripple : c.directional;
  const angle = (c.directional.angle + t * c.directional.rotationSpeed) * Math.PI / 180;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const originX = xs[columns] * c.ripple.centerX;
  const originY = ys[rows] * c.ripple.centerY;
  const vertices = Array.from({ length: (columns + 1) * (rows + 1) }, (_, i) => {
    const col = i % (columns + 1);
    const row = Math.floor(i / (columns + 1));
    const x = xs[col];
    const y = ys[row];
    if (col === 0 || row === 0 || col === columns || row === rows) return { x, y };
    const localWidth = Math.min(x - xs[col - 1], xs[col + 1] - x);
    const localHeight = Math.min(y - ys[row - 1], ys[row + 1] - y);
    let directionX = nx;
    let directionY = ny;
    let distance = (x - xs[columns] / 2) * nx + (y - ys[rows] / 2) * ny;
    if (c.motionPattern === 'ripple') {
      const dx = x - originX;
      const dy = y - originY;
      distance = Math.hypot(dx, dy);
      // A soft center avoids a direction singularity when the origin crosses a vertex.
      const radius = Math.hypot(distance, Math.min(localWidth, localHeight) * 0.5);
      directionX = dx / radius;
      directionY = dy / radius;
    }
    const phase = Math.PI * 2 * (distance / motion.wavelength + motion.phase - t * motion.speed * (motion.reverse ? -1 : 1));
    // Strengths up to 1 stay below 1/4 of each adjacent span; larger values
    // use the convexity limit below instead of clamping the strength control.
    const displacement = 0.22 * motion.amount * Math.sin(phase);
    return { x: x + localWidth * directionX * displacement, y: y + localHeight * directionY * displacement };
  });
  if (motion.amount <= 1) return vertices;
  return limitDeformation(vertices, xs, ys);
}

function limitDeformation(vertices: GridPoint[], xs: number[], ys: number[]): GridPoint[] {
  const columns = xs.length - 1;
  const rows = ys.length - 1;
  const base = vertices.map((_, i) => ({ x: xs[i % (columns + 1)], y: ys[Math.floor(i / (columns + 1))] }));
  const delta = vertices.map((p, i) => ({ x: p.x - base[i].x, y: p.y - base[i].y }));
  const subtract = (a: GridPoint, b: GridPoint) => ({ x: a.x - b.x, y: a.y - b.y });
  const cross = (a: GridPoint, b: GridPoint) => a.x * b.y - a.y * b.x;
  let scale = 1;
  // Each corner's signed turn is a quadratic in displacement scale. Limit
  // to just before its first positive root, preserving convexity continuously
  // without a frame-dependent solver or stepping the animation backwards.
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const top = row * (columns + 1) + col;
    const ids = [top, top + 1, top + columns + 2, top + columns + 1];
    for (let corner = 0; corner < 4; corner++) {
      const a = ids[corner]; const b = ids[(corner + 1) % 4]; const c = ids[(corner + 2) % 4];
      const edge1 = subtract(base[b], base[a]);
      const edge2 = subtract(base[c], base[b]);
      const move1 = subtract(delta[b], delta[a]);
      const move2 = subtract(delta[c], delta[b]);
      const quadratic = cross(move1, move2);
      const linear = cross(move1, edge2) + cross(edge1, move2);
      const constant = cross(edge1, edge2);
      const consider = (root: number) => { if (root > 0) scale = Math.min(scale, root * 0.95); };
      if (Math.abs(quadratic) < constant * 1e-12) {
        if (linear < 0) consider(-constant / linear);
      } else {
        const discriminant = linear * linear - 4 * quadratic * constant;
        if (discriminant >= 0) {
          const q = -0.5 * (linear + (linear >= 0 ? 1 : -1) * Math.sqrt(discriminant));
          if (q !== 0) { consider(q / quadratic); consider(constant / q); }
        }
      }
    }
  }
  return scale === 1 ? vertices : vertices.map((_, i) => ({ x: base[i].x + delta[i].x * scale, y: base[i].y + delta[i].y * scale }));
}

/** Offset each edge inward by half the gutter, hiding cells too small for that inset. */
export function insetGridQuad(quad: GridQuad, gutter: number): GridQuad {
  if (gutter === 0) return quad;
  const center = { x: quad.reduce((s, p) => s + p.x, 0) / 4, y: quad.reduce((s, p) => s + p.y, 0) / 4 };
  const collapsed: GridQuad = [center, center, center, center];
  const edges = quad.map((p, i) => {
    const next = quad[(i + 1) % 4];
    const length = Math.hypot(next.x - p.x, next.y - p.y);
    return { x: -(next.y - p.y) / length, y: (next.x - p.x) / length };
  });
  const inset = quad.map((p, i) => {
    const previous = edges[(i + 3) % 4];
    const next = edges[i];
    const factor = gutter / 2 / (1 + previous.x * next.x + previous.y * next.y);
    return { x: p.x + (previous.x + next.x) * factor, y: p.y + (previous.y + next.y) * factor };
  });
  if (inset.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || edges.some((n, i) => (p.x - quad[i].x) * n.x + (p.y - quad[i].y) * n.y < gutter / 2 - 1e-7))) return collapsed;
  return [inset[0], inset[1], inset[2], inset[3]];
}
