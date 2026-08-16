import { describe, expect, it } from 'vitest';
import { GifData, GifFrameData } from '../types';
import { getGifFrameAtTime, getGifFrameIndexAtTime } from './gifUtils';

// getGifFrameAtTime only reads frame timing and returns the stored image,
// so a tagged placeholder object stands in for the ImageBitmap in node.
function makeGifData(delaysMs: number[]): GifData {
  let t = 0;
  const frames: GifFrameData[] = delaysMs.map((delayMs, i) => {
    const frame = {
      image: { frameIndex: i } as unknown as ImageBitmap,
      delayMs,
      startTimeMs: t,
      endTimeMs: t + delayMs
    };
    t += delayMs;
    return frame;
  });
  return { frames, totalDurationMs: t, width: 10, height: 10 };
}

function frameIndexAt(gif: GifData, tSeconds: number, speed?: number): number | null {
  const image = getGifFrameAtTime(gif, tSeconds, speed);
  return image ? (image as unknown as { frameIndex: number }).frameIndex : null;
}

describe('getGifFrameAtTime', () => {
  const gif = makeGifData([100, 100, 200, 100]); // 500ms total

  it('finds the frame containing the timestamp', () => {
    expect(frameIndexAt(gif, 0)).toBe(0);
    expect(frameIndexAt(gif, 0.05)).toBe(0);
    expect(frameIndexAt(gif, 0.15)).toBe(1);
    expect(frameIndexAt(gif, 0.25)).toBe(2);
    expect(frameIndexAt(gif, 0.399)).toBe(2);
    expect(frameIndexAt(gif, 0.45)).toBe(3);
  });

  it('treats frame boundaries as the start of the next frame', () => {
    expect(frameIndexAt(gif, 0.1)).toBe(1);
    expect(frameIndexAt(gif, 0.4)).toBe(3);
  });

  it('wraps around the total duration', () => {
    expect(frameIndexAt(gif, 0.5)).toBe(0);
    expect(frameIndexAt(gif, 0.65)).toBe(1);
    expect(frameIndexAt(gif, 5.05)).toBe(0);
  });

  it('applies the speed multiplier', () => {
    // t=0.1s at 2x speed = 200ms into the loop -> frame 2
    expect(frameIndexAt(gif, 0.1, 2)).toBe(2);
    // t=0.4s at 0.5x speed = 200ms -> frame 2
    expect(frameIndexAt(gif, 0.4, 0.5)).toBe(2);
  });

  it('falls back to speed 1 for invalid speed values', () => {
    expect(frameIndexAt(gif, 0.15, NaN)).toBe(1);
  });

  it('returns null for empty or zero-duration gifs', () => {
    expect(getGifFrameAtTime(makeGifData([]), 0.5)).toBeNull();
    const zero = makeGifData([0]);
    expect(getGifFrameAtTime(zero, 0.5)).toBeNull();
  });
});

describe('getGifFrameIndexAtTime', () => {
  const gif = makeGifData([100, 100, 200, 100]); // 500ms total

  it('agrees with getGifFrameAtTime across the loop', () => {
    for (const t of [0, 0.05, 0.1, 0.15, 0.25, 0.399, 0.4, 0.45, 0.5, 0.65, 5.05]) {
      const idx = getGifFrameIndexAtTime(gif, t);
      expect(gif.frames[idx].image).toBe(getGifFrameAtTime(gif, t));
    }
  });

  it('returns -1 for empty or zero-duration gifs', () => {
    expect(getGifFrameIndexAtTime(makeGifData([]), 0.5)).toBe(-1);
    expect(getGifFrameIndexAtTime(makeGifData([0]), 0.5)).toBe(-1);
  });
});
