import { Delaunay } from 'd3-delaunay';
import { PolygonPoint } from '../types';

// Voronoi is a subdivision/masking effect (partition an area into shards),
// not a repeat-and-transform one like the rest of the symmetry engine in
// motion.ts — so it gets its own deterministic geometry module, consumed
// directly by both renderers.

/**
 * Deterministic PRNG (mulberry32) so a given seed always produces the same
 * site layout and per-cell phase values — required for exported frames to
 * match live playback and for re-opening a saved project to look identical.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VoronoiBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface VoronoiCell {
  points: PolygonPoint[];
  // Deterministic per-cell value in [0, 1), used to offset texture
  // placement per shard — not time-based, so exports stay reproducible.
  phase: number;
}

// Matches the brainstorm's "5-50 shards" range with headroom, while keeping
// worst-case mask/tiler counts in both renderers bounded.
const MAX_VORONOI_CELLS = 60;

/**
 * Voronoi shards covering `bounds`: sites are laid out on a jittered grid
 * (more even coverage than pure-random points) keyed by `seed`, then
 * partitioned via d3-delaunay's Voronoi diagram, clipped to bounds. The
 * same (bounds, count, seed) always yields the same cells.
 */
export function getVoronoiCells(bounds: VoronoiBounds, count: number, seed: number): VoronoiCell[] {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) return [];

  const n = Math.max(2, Math.min(MAX_VORONOI_CELLS, Math.round(count)));
  const rand = mulberry32(Math.floor(seed) || 1);

  const aspect = width / height;
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  const rows = Math.max(1, Math.round(n / cols));
  const cellW = width / cols;
  const cellH = height / rows;

  const sites: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jitterX = (rand() - 0.5) * cellW * 0.7;
      const jitterY = (rand() - 0.5) * cellH * 0.7;
      sites.push([
        bounds.minX + (c + 0.5) * cellW + jitterX,
        bounds.minY + (r + 0.5) * cellH + jitterY
      ]);
    }
  }
  // Rounding cols/rows to fit n can overshoot slightly; trim back to n.
  sites.length = Math.min(sites.length, n);

  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);

  const cells: VoronoiCell[] = [];
  for (let i = 0; i < sites.length; i++) {
    const polygon = voronoi.cellPolygon(i);
    if (!polygon || polygon.length < 3) continue;
    // cellPolygon returns a closed ring (last point repeats the first);
    // the rest of the app's PolygonPoint[] paths close implicitly.
    const ring = polygon.slice(0, -1);
    cells.push({
      points: ring.map(([x, y]) => ({ x, y })),
      phase: rand()
    });
  }
  return cells;
}
