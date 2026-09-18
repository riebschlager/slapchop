import { describe, expect, it } from 'vitest';
import { DEFAULT_RINGS, normalizeRings, resolveRings, RingsAsset } from './model';

const assets: RingsAsset[] = [
  { id: 'a', name: 'wide.gif', src: 'a', width: 400, height: 200 },
  { id: 'b', name: 'tall.gif', src: 'b', width: 100, height: 300 }
];

describe('ring flight', () => {
  it('repeats exactly one source per ring and preserves its aspect ratio', () => {
    const items = resolveRings(assets, DEFAULT_RINGS, 0.25);
    expect(items).toHaveLength(DEFAULT_RINGS.gifsPerRing * DEFAULT_RINGS.ringCount);
    for (const id of new Set(items.map(item => item.ringIndex))) {
      const ring = items.filter(item => item.ringIndex === id);
      expect(new Set(ring.map(item => item.asset.id)).size).toBe(1);
      for (const item of ring) expect(item.width / item.height).toBeCloseTo(item.asset.width! / item.asset.height!);
    }
  });
  it('is deterministic for shuffled and reverse flight, independent of frame order', () => {
    const c = { ...DEFAULT_RINGS, speed: -900, shuffle: true };
    const first = resolveRings(assets, c, 100);
    resolveRings(assets, c, 0);
    expect(resolveRings(assets, c, 100)).toEqual(first);
    expect(first.every(item => Number.isFinite(item.x) && item.width > 0)).toBe(true);
  });
  it('keeps ring identities across a camera crossing with continuous projection', () => {
    const c = { ...DEFAULT_RINGS, speed: 700, spacing: 700 };
    const before = resolveRings(assets, c, 0.99999).find(item => item.ringIndex === 3)!;
    const after = resolveRings(assets, c, 1.00001).find(item => item.ringIndex === 3)!;
    expect(before.asset).toBe(after.asset);
    expect(Math.abs(before.x - after.x)).toBeLessThan(0.1);
  });
  it('stops travel and animation independently and shares playback within each ring', () => {
    const c = { ...DEFAULT_RINGS, speed: 0, rotationSpeed: 0, gifSpeed: 0 };
    expect(resolveRings(assets, c, 10)).toEqual(resolveRings(assets, c, 0));
  });
  it('caps allocations and rejects non-finite persisted settings', () => {
    expect(normalizeRings({ gifsPerRing: 1e9, ringCount: -1, fov: NaN, speed: Infinity }))
      .toMatchObject({ gifsPerRing: 48, ringCount: 4, fov: 74, speed: 900 });
    expect(resolveRings([], DEFAULT_RINGS, 0)).toEqual([]);
  });
});
