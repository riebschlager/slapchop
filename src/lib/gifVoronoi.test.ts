import { describe, expect, it } from 'vitest';
import { DEFAULT_GIF_VORONOI, GifVoronoiAsset } from '../types';
import {
  buildGifVoronoiLayout,
  gifVoronoiCoverRect,
  gifVoronoiGeometryFrameKey,
  gifVoronoiGeometryKey,
  gifVoronoiSourceTime
} from './gifVoronoi';

const bounds = { minX: -540, minY: -960, maxX: 540, maxY: 960 };
const gifData = { width: 400, height: 200, totalDurationMs: 4000, frames: [] };
const assets: GifVoronoiAsset[] = [
  { id: 'a', name: 'a.gif', src: 'a', width: 400, height: 200, gifData },
  { id: 'b', name: 'b.gif', src: 'b', width: 200, height: 400, gifData: { ...gifData, width: 200, height: 400 } }
];

describe('buildGifVoronoiLayout', () => {
  it('creates the requested number of deterministic cells', () => {
    const config = { ...DEFAULT_GIF_VORONOI, cellCount: 42 };
    const first = buildGifVoronoiLayout(assets, config, bounds);
    expect(first).toHaveLength(42);
    expect(first).toEqual(buildGifVoronoiLayout(assets, config, bounds));
  });

  it('assigns the exact rounded occupancy and cycles the library', () => {
    const cells = buildGifVoronoiLayout(assets, {
      ...DEFAULT_GIF_VORONOI,
      cellCount: 20,
      occupancy: 0.65,
      arrangement: 'scan'
    }, bounds);
    const occupied = cells.filter(cell => cell.asset);
    expect(occupied).toHaveLength(13);
    expect(new Set(occupied.map(cell => cell.asset?.id))).toEqual(new Set(['a', 'b']));
  });

  it('resolves transparent and palette blanks independently from geometry', () => {
    const transparent = buildGifVoronoiLayout([], {
      ...DEFAULT_GIF_VORONOI,
      cellCount: 8,
      blankFill: 'transparent'
    }, bounds);
    const palette = buildGifVoronoiLayout([], {
      ...DEFAULT_GIF_VORONOI,
      cellCount: 8,
      blankFill: 'palette',
      palette: ['#111111', '#eeeeee']
    }, bounds);
    expect(transparent.every(cell => cell.blankColor === null)).toBe(true);
    expect(palette.every(cell => ['#111111', '#eeeeee'].includes(cell.blankColor ?? ''))).toBe(true);
  });

  it('keeps assignment-only changes out of the renderer geometry key', () => {
    const first = gifVoronoiGeometryKey(DEFAULT_GIF_VORONOI);
    const reassignedConfig = {
      ...DEFAULT_GIF_VORONOI,
      arrangement: 'radial' as const,
      occupancy: 0.25,
      blankFill: 'transparent' as const,
      palette: ['#ffffff']
    };
    const reassigned = gifVoronoiGeometryKey(reassignedConfig);

    expect(reassigned).toBe(first);
    expect(gifVoronoiGeometryKey({ ...DEFAULT_GIF_VORONOI, seed: 99 })).not.toBe(first);
  });

  it.each(['scatter', 'scan', 'radial'] as const)(
    'animates point drift deterministically without changing %s assignments',
    (arrangement) => {
      const config = {
        ...DEFAULT_GIF_VORONOI,
        cellCount: 18,
        arrangement,
        pointDriftAmount: 0.9,
        pointDriftSpeed: 0.25
      };
      const first = buildGifVoronoiLayout(assets, config, bounds, 1.25);
      const repeated = buildGifVoronoiLayout(assets, config, bounds, 1.25);
      const later = buildGifVoronoiLayout(assets, config, bounds, 7.75);

      expect(first).toEqual(repeated);
      expect(first.map(cell => cell.index)).toEqual(later.map(cell => cell.index));
      expect(first.map(cell => cell.asset?.id)).toEqual(later.map(cell => cell.asset?.id));
      expect(first.map(cell => cell.points)).not.toEqual(later.map(cell => cell.points));
    }
  );

  it('keeps static geometry cached independently from playback time', () => {
    expect(gifVoronoiGeometryFrameKey(DEFAULT_GIF_VORONOI, 1)).toBe(
      gifVoronoiGeometryFrameKey(DEFAULT_GIF_VORONOI, 2)
    );
    const drifting = { ...DEFAULT_GIF_VORONOI, pointDriftAmount: 0.4 };
    expect(gifVoronoiGeometryFrameKey(drifting, 1)).not.toBe(
      gifVoronoiGeometryFrameKey(drifting, 2)
    );
  });
});

describe('GIF Voronoi playback and crop', () => {
  it('supports synchronized and per-cell staggered playback', () => {
    const cell = buildGifVoronoiLayout(assets, {
      ...DEFAULT_GIF_VORONOI,
      cellCount: 2,
      occupancy: 1
    }, bounds)[0];
    const sync = gifVoronoiSourceTime(cell, {
      ...DEFAULT_GIF_VORONOI,
      gifSpeed: 2,
      phaseMode: 'sync'
    }, 1.5, bounds);
    const staggered = gifVoronoiSourceTime(cell, {
      ...DEFAULT_GIF_VORONOI,
      gifSpeed: 2,
      phaseMode: 'staggered',
      phaseSpread: 1
    }, 1.5, bounds);
    expect(sync).toBe(3);
    expect(staggered).toBeGreaterThanOrEqual(sync);
    expect(staggered).toBeLessThan(sync + 4);
  });

  it('cover-crops without stretching and keeps the target fully covered', () => {
    const target = { minX: 10, minY: 20, maxX: 210, maxY: 420 };
    const rect = gifVoronoiCoverRect(400, 200, target, 1, 0, 0);
    expect(rect.width / rect.height).toBeCloseTo(2);
    expect(rect.width).toBeGreaterThanOrEqual(200);
    expect(rect.height).toBeGreaterThanOrEqual(400);
    expect(rect.x).toBeLessThanOrEqual(target.minX);
    expect(rect.y).toBeLessThanOrEqual(target.minY);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(target.maxX);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(target.maxY);
  });
});
