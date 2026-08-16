import { describe, expect, it } from 'vitest';
import { pickBitrate } from './videoExport';

describe('pickBitrate', () => {
  it('scales with pixels and fps', () => {
    expect(pickBitrate(1080, 1920, 30)).toBe(Math.round(1080 * 1920 * 30 * 0.15));
  });

  it('clamps tiny exports to the 2 Mbps floor', () => {
    expect(pickBitrate(100, 100, 15)).toBe(2_000_000);
  });

  it('clamps huge exports to the 24 Mbps ceiling', () => {
    expect(pickBitrate(3840, 2160, 60)).toBe(24_000_000);
  });
});
