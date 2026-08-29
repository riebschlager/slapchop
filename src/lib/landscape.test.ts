import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDSCAPE } from '../types';
import { landscapeAssetIndex, landscapeHeight, resolveLandscapeCells } from './landscape';

describe('GIF Landscape procedural scene', () => {
  it('resolves identical terrain for an identical document time', () => {
    const first = resolveLandscapeCells(DEFAULT_LANDSCAPE, 1.25, 7);
    expect(first).toEqual(resolveLandscapeCells(DEFAULT_LANDSCAPE, 1.25, 7));
    expect(first).toHaveLength(DEFAULT_LANDSCAPE.meshColumns * DEFAULT_LANDSCAPE.meshRows);
  });

  it('advances terrain rows without repeating the sampled height field', () => {
    const cellDepth = DEFAULT_LANDSCAPE.terrainDepth / DEFAULT_LANDSCAPE.meshRows;
    const later = resolveLandscapeCells(DEFAULT_LANDSCAPE, cellDepth / DEFAULT_LANDSCAPE.flightSpeed, 4);
    const initial = resolveLandscapeCells(DEFAULT_LANDSCAPE, 0, 4);
    expect(later[0].row).toBe(initial[0].row + 1);
    expect(later[0].corners[0].y).not.toBe(initial[0].corners[0].y);
  });

  it('uses ridge and plateau shaping deterministically', () => {
    const smooth = landscapeHeight(330, -1200, { ...DEFAULT_LANDSCAPE, ridgeAmount: 0, plateauAmount: 0 });
    const shaped = landscapeHeight(330, -1200, { ...DEFAULT_LANDSCAPE, ridgeAmount: 1, plateauAmount: 1 });
    expect(shaped).not.toBe(smooth);
    expect(shaped).toBe(landscapeHeight(330, -1200, { ...DEFAULT_LANDSCAPE, ridgeAmount: 1, plateauAmount: 1 }));
  });

  it('can preserve order or use a seeded shuffle for GIF assignment', () => {
    const ordered = { ...DEFAULT_LANDSCAPE, terrainShuffle: false, meshColumns: 4 };
    expect(landscapeAssetIndex(0, 0, 3, ordered)).toBe(0);
    expect(landscapeAssetIndex(0, 1, 3, ordered)).toBe(1);
    expect(landscapeAssetIndex(2, 3, 3, ordered)).toBe(2);
    expect(landscapeAssetIndex(8, 4, 5, DEFAULT_LANDSCAPE)).toBe(
      landscapeAssetIndex(8, 4, 5, DEFAULT_LANDSCAPE)
    );
  });
});
