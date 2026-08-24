import { describe, expect, it } from 'vitest';
import { getPartialVideoPath } from './ffmpegExport';

describe('native ffmpeg export configuration', () => {
  it('keeps a partial output beside the requested file with the same extension', () => {
    expect(getPartialVideoPath('/exports/show.mov', 'abc'))
      .toBe('/exports/show.slapchop-partial-abc.mov');
  });
});
