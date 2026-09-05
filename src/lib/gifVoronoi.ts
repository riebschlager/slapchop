import { Delaunay } from 'd3-delaunay';
import {
  GifVoronoiAsset,
  GifVoronoiConfig,
  PolygonPoint
} from '../types';

export interface GifVoronoiBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GifVoronoiCell {
  index: number;
  points: PolygonPoint[];
  bounds: GifVoronoiBounds;
  centroid: PolygonPoint;
  phase: number;
  asset: GifVoronoiAsset | null;
  blankColor: string | null;
}

export interface GifVoronoiCoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GeneratedCell extends Omit<GifVoronoiCell, 'asset' | 'blankColor'> {
  fillRank: number;
  scatterRank: number;
}

const MIN_CELLS = 2;
const MAX_CELLS = 120;

export function gifVoronoiGeometryKey(
  config: Pick<GifVoronoiConfig, 'cellCount' | 'irregularity' | 'seed' | 'pointDriftAmount' | 'pointDriftSpeed'>
): string {
  return [
    config.cellCount,
    config.irregularity,
    config.seed,
    config.pointDriftAmount,
    config.pointDriftSpeed
  ].join('|');
}

export function gifVoronoiGeometryFrameKey(config: GifVoronoiConfig, t: number): string {
  const geometryKey = gifVoronoiGeometryKey(config);
  return config.pointDriftAmount > 0 && config.pointDriftSpeed > 0
    ? `${geometryKey}|${t}`
    : geometryKey;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polygonBounds(points: PolygonPoint[]): GifVoronoiBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function polygonCentroid(points: PolygonPoint[]): PolygonPoint {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 0.000001) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
  }
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

function generateCells(bounds: GifVoronoiBounds, config: GifVoronoiConfig, t: number): GeneratedCell[] {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) return [];

  const count = Math.round(clamp(config.cellCount, MIN_CELLS, MAX_CELLS));
  const irregularity = clamp(config.irregularity, 0, 1);
  const rand = mulberry32(Math.floor(config.seed) || 1);
  const aspect = width / height;
  const rows = Math.max(1, Math.round(Math.sqrt(count / aspect)));
  const baseColumns = Math.floor(count / rows);
  const widerRows = count % rows;
  const rowHeight = height / rows;
  const sites: [number, number][] = [];
  const siteRegions: GifVoronoiBounds[] = [];

  for (let row = 0; row < rows; row++) {
    const columns = Math.max(1, baseColumns + (row < widerRows ? 1 : 0));
    const columnWidth = width / columns;
    for (let column = 0; column < columns; column++) {
      const jitterX = (rand() - 0.5) * columnWidth * 0.82 * irregularity;
      const jitterY = (rand() - 0.5) * rowHeight * 0.82 * irregularity;
      const minX = bounds.minX + column * columnWidth;
      const minY = bounds.minY + row * rowHeight;
      sites.push([minX + columnWidth / 2 + jitterX, minY + rowHeight / 2 + jitterY]);
      siteRegions.push({ minX, minY, maxX: minX + columnWidth, maxY: minY + rowHeight });
    }
  }

  const phases = sites.map(() => rand());
  const fillRanks = sites.map(() => rand());
  const scatterRanks = sites.map(() => rand());
  const driftAmount = clamp(config.pointDriftAmount, 0, 1);
  if (driftAmount > 0) {
    // A separate seeded stream keeps existing static meshes and assignments
    // byte-for-byte stable when drift is disabled.
    const driftRand = mulberry32((Math.floor(config.seed) || 1) ^ 0x5f3759df);
    const angle = Math.max(0, t) * Math.max(0, config.pointDriftSpeed) * Math.PI * 2;
    for (let index = 0; index < sites.length; index++) {
      const region = siteRegions[index];
      const regionWidth = region.maxX - region.minX;
      const regionHeight = region.maxY - region.minY;
      const phaseX = driftRand() * Math.PI * 2;
      const phaseY = driftRand() * Math.PI * 2;
      const rateX = 0.72 + driftRand() * 0.56;
      const rateY = 0.72 + driftRand() * 0.56;
      const marginX = regionWidth * 0.03;
      const marginY = regionHeight * 0.03;
      sites[index][0] = clamp(
        sites[index][0] + Math.sin(phaseX + angle * rateX) * regionWidth * 0.38 * driftAmount,
        region.minX + marginX,
        region.maxX - marginX
      );
      sites[index][1] = clamp(
        sites[index][1] + Math.sin(phaseY + angle * rateY) * regionHeight * 0.38 * driftAmount,
        region.minY + marginY,
        region.maxY - marginY
      );
    }
  }
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
  const cells: GeneratedCell[] = [];

  for (let index = 0; index < sites.length; index++) {
    const polygon = voronoi.cellPolygon(index);
    if (!polygon || polygon.length < 4) continue;
    const points = polygon.slice(0, -1).map(([x, y]) => ({ x, y }));
    cells.push({
      index,
      points,
      bounds: polygonBounds(points),
      centroid: polygonCentroid(points),
      phase: phases[index],
      fillRank: fillRanks[index],
      scatterRank: scatterRanks[index]
    });
  }
  return cells;
}

function orderedCells(cells: GeneratedCell[], config: GifVoronoiConfig): GeneratedCell[] {
  if (config.arrangement === 'radial') {
    return [...cells].sort((a, b) => {
      const aRadius = Math.hypot(a.centroid.x, a.centroid.y);
      const bRadius = Math.hypot(b.centroid.x, b.centroid.y);
      return aRadius - bRadius
        || Math.atan2(a.centroid.y, a.centroid.x) - Math.atan2(b.centroid.y, b.centroid.x);
    });
  }
  if (config.arrangement === 'scatter') {
    return [...cells].sort((a, b) => a.scatterRank - b.scatterRank);
  }
  return [...cells].sort((a, b) => a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x);
}

export function buildGifVoronoiLayout(
  assets: GifVoronoiAsset[],
  config: GifVoronoiConfig,
  bounds: GifVoronoiBounds,
  t = 0
): GifVoronoiCell[] {
  const generated = generateCells(bounds, config, t);
  const assignmentCells = config.pointDriftAmount > 0 && config.arrangement !== 'scatter'
    ? generateCells(bounds, { ...config, pointDriftAmount: 0 }, 0)
    : generated;
  const occupiedCount = assets.length > 0
    ? Math.round(generated.length * clamp(config.occupancy, 0, 1))
    : 0;
  const occupied = new Set(
    [...generated]
      .sort((a, b) => a.fillRank - b.fillRank)
      .slice(0, occupiedCount)
      .map(cell => cell.index)
  );
  const assetByCell = new Map<number, GifVoronoiAsset>();
  orderedCells(assignmentCells, config)
    .filter(cell => occupied.has(cell.index))
    .forEach((cell, slot) => assetByCell.set(cell.index, assets[slot % assets.length]));
  const palette = config.palette.length > 0 ? config.palette : [config.blankColor];

  return generated.map((cell): GifVoronoiCell => {
    const asset = assetByCell.get(cell.index) ?? null;
    let blankColor: string | null = null;
    if (!asset && config.blankFill === 'solid') blankColor = config.blankColor;
    if (!asset && config.blankFill === 'palette') {
      blankColor = palette[Math.floor(cell.phase * palette.length) % palette.length];
    }
    return {
      index: cell.index,
      points: cell.points,
      bounds: cell.bounds,
      centroid: cell.centroid,
      phase: cell.phase,
      asset,
      blankColor
    };
  });
}

export function gifVoronoiSourceTime(
  cell: GifVoronoiCell,
  config: GifVoronoiConfig,
  t: number,
  stageBounds: GifVoronoiBounds
): number {
  if (!cell.asset) return t * config.gifSpeed;
  const duration = Math.max(0, cell.asset.gifData.totalDurationMs / 1000);
  let phase = 0;
  if (config.phaseMode === 'staggered') phase = cell.phase;
  if (config.phaseMode === 'sweep') {
    const x = (cell.centroid.x - stageBounds.minX) / Math.max(1, stageBounds.maxX - stageBounds.minX);
    const y = (cell.centroid.y - stageBounds.minY) / Math.max(1, stageBounds.maxY - stageBounds.minY);
    phase = x * 0.35 + y * 0.65;
  }
  return t * config.gifSpeed + phase * duration * clamp(config.phaseSpread, 0, 1);
}

export function gifVoronoiCoverRect(
  sourceWidth: number,
  sourceHeight: number,
  bounds: GifVoronoiBounds,
  zoom: number,
  offsetX: number,
  offsetY: number
): GifVoronoiCoverRect {
  const targetWidth = Math.max(0.001, bounds.maxX - bounds.minX);
  const targetHeight = Math.max(0.001, bounds.maxY - bounds.minY);
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.max(targetWidth / safeWidth, targetHeight / safeHeight) * clamp(zoom, 0.25, 4);
  const width = safeWidth * scale;
  const height = safeHeight * scale;
  const availableX = Math.abs(width - targetWidth) / 2;
  const availableY = Math.abs(height - targetHeight) / 2;
  const centerX = (bounds.minX + bounds.maxX) / 2 + clamp(offsetX, -1, 1) * availableX;
  const centerY = (bounds.minY + bounds.maxY) / 2 + clamp(offsetY, -1, 1) * availableY;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}
