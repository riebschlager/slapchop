import { afterEach, expect, it, vi } from 'vitest';
import { parseGifFile } from '../../lib/gifUtils';
import { loadGridAssets } from './assets';
vi.mock('../../lib/gifUtils', () => ({ parseGifFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
it('rejects an empty folder without creating resources', async () => {
  await expect(loadGridAssets([])).rejects.toThrow('no GIF files');
});
it('cleans up a partially decoded library if a later file is corrupt', async () => {
  const close = vi.fn();
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.mocked(parseGifFile).mockResolvedValueOnce({ width: 1, height: 1, totalDurationMs: 100,
    frames: [{ image: { close } as unknown as ImageBitmap, delayMs: 100, startTimeMs: 0, endTimeMs: 100 }] }).mockResolvedValueOnce(null);
  await expect(loadGridAssets([new File([''], 'a.gif'), new File([''], 'b.gif')])).rejects.toThrow('b.gif');
  expect(close).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith('blob:test');
});
