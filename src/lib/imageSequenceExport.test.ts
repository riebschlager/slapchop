import { describe, expect, it } from 'vitest';
import {
  getSequenceCompatibilityError,
  getSequenceFrameName,
  getSequenceStartFrame
} from './imageSequenceExport';

describe('image sequence naming', () => {
  it('uses stable eight-digit, one-based filenames', () => {
    expect(getSequenceFrameName(1, 'png')).toBe('frame_00000001.png');
    expect(getSequenceFrameName(301, 'jpeg')).toBe('frame_00000301.jpg');
  });

  it('aligns start time to the nearest output frame', () => {
    expect(getSequenceStartFrame(10, 30)).toBe(300);
    expect(getSequenceStartFrame(1.01, 30)).toBe(30);
    expect(getSequenceStartFrame(-2, 30)).toBe(0);
  });
});

describe('image sequence resume compatibility', () => {
  const expected = { width: 1080, height: 1920, fps: 30, imageFormat: 'png' as const };

  it('accepts a matching sequence manifest', () => {
    expect(getSequenceCompatibilityError(expected, expected)).toBeNull();
  });

  it('rejects settings that would mix incompatible frames', () => {
    expect(getSequenceCompatibilityError({ ...expected, fps: 60 }, expected))
      .toBe('The existing sequence uses a different frame rate.');
    expect(getSequenceCompatibilityError({ ...expected, imageFormat: 'jpeg' }, expected))
      .toBe('The existing sequence uses a different image format.');
  });
});
