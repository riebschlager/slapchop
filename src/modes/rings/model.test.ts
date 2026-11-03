import { describe, expect, it } from 'vitest';
import { DEFAULT_RINGS, DEFAULT_RINGS_SIZE_MOTION, normalizeRings, resolveRings, ringCardSize, RingsAsset, RingsConfig, RingsSizeMotion } from './model';

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

describe('ring card size motion', () => {
  const withMotion = (updates: Partial<RingsSizeMotion>): RingsConfig =>
    normalizeRings({ ...DEFAULT_RINGS, gifSize: 300, sizeMotion: { ...DEFAULT_RINGS_SIZE_MOTION, ...updates } });

  it('uses the static GIF size when sweep and noise are off', () => {
    expect(ringCardSize(withMotion({}), 4, 2, 1.3)).toBe(300);
  });

  it('sweeps between the user range at the configured speed', () => {
    const c = withMotion({ sweep: true, min: 100, max: 500, speed: 0.5, ringSpread: 0 });
    expect(ringCardSize(c, 0, 0, 0)).toBeCloseTo(300);
    expect(ringCardSize(c, 0, 0, 0.5)).toBeCloseTo(500);
    expect(ringCardSize(c, 0, 0, 1.5)).toBeCloseTo(100);
  });

  it('travels the sweep down the corridor by ring spread', () => {
    const c = withMotion({ sweep: true, min: 100, max: 500, speed: 1, ringSpread: 0.25 });
    // Ring 1 at t reaches the phase ring 0 had a quarter cycle earlier.
    expect(ringCardSize(c, 1, 0, 0.5)).toBeCloseTo(ringCardSize(c, 0, 0, 0.25));
  });

  it('adds bounded, deterministic noise that differs per card', () => {
    const c = withMotion({ noise: true, noiseAmplitude: 100, noisePeriod: 0.5 });
    const samples = Array.from({ length: 200 }, (_, index) => ringCardSize(c, index % 9, index % 5, index * 0.037));
    expect(samples.every(size => size >= 200 && size <= 400)).toBe(true);
    expect(new Set(samples.map(size => size.toFixed(3))).size).toBeGreaterThan(100);
    expect(ringCardSize(c, 2, 1, 3.3)).not.toBe(ringCardSize(c, 2, 2, 3.3));
  });

  it('keeps card size positive and scales projected sprites', () => {
    const c = { ...withMotion({ noise: true, noiseAmplitude: 800 }), gifSize: 20 };
    for (let t = 0; t < 5; t += 0.1) expect(ringCardSize(c, 1, 1, t)).toBeGreaterThanOrEqual(1);
    const still = { ...DEFAULT_RINGS, speed: 0, rotationSpeed: 0 };
    const doubled = normalizeRings({ ...still, sizeMotion: { ...DEFAULT_RINGS_SIZE_MOTION, sweep: true, min: 640, max: 640 } });
    const base = resolveRings(assets, still, 0)[0];
    expect(resolveRings(assets, doubled, 0)[0].width).toBeCloseTo(base.width * 2);
  });

  it('defaults and clamps persisted size motion', () => {
    expect(normalizeRings({}).sizeMotion).toEqual(DEFAULT_RINGS_SIZE_MOTION);
    expect(normalizeRings({ sizeMotion: { sweep: true, min: -5, noisePeriod: 0, speed: NaN } as unknown as RingsSizeMotion }).sizeMotion)
      .toEqual({ ...DEFAULT_RINGS_SIZE_MOTION, sweep: true, min: 20, noisePeriod: 0.05 });
  });
});

describe('ring card rotation offset', () => {
  const still = { ...DEFAULT_RINGS, speed: 0, rotationSpeed: 0, twist: 0, cameraRoll: 0 };

  it('offsets radial and camera-parallel cards by the same angle', () => {
    for (const radialOrientation of [true, false]) {
      const base = resolveRings(assets, { ...still, radialOrientation }, 0);
      const turned = resolveRings(assets, { ...still, radialOrientation, gifRotation: 90 }, 0);
      turned.forEach((item, index) => {
        expect(item.rotation - base[index].rotation).toBeCloseTo(Math.PI / 2);
        expect(item.x).toBe(base[index].x);
      });
    }
  });

  it('defaults older configs to no offset and clamps persisted values', () => {
    const legacy: Partial<RingsConfig> = { ...DEFAULT_RINGS };
    delete legacy.gifRotation;
    expect(normalizeRings(legacy).gifRotation).toBe(0);
    expect(normalizeRings({ gifRotation: 720 }).gifRotation).toBe(180);
  });
});
