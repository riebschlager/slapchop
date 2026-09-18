import { describe, expect, it, vi } from 'vitest';
import { createRingsResourceTracker } from './resources';
import type { RingsAsset } from './model';

it('keeps ring assets alive through undo, then releases expired resources once', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const close = vi.fn();
  const asset: RingsAsset = {
    id: 'a', name: 'a.gif', src: 'blob:a',
    gifData: { width: 10, height: 10, totalDurationMs: 100, frames: [
      { image: { close } as unknown as ImageBitmap, delayMs: 100, startTimeMs: 0, endTimeMs: 100 }
    ] }
  };
  const tracker = createRingsResourceTracker();
  tracker.remember([asset]);
  tracker.sweep([{ ringsAssets: [] }, { ringsAssets: [asset] }]);
  expect(close).not.toHaveBeenCalled();
  tracker.sweep([{ ringsAssets: [] }]);
  tracker.sweep([]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:a');
  revoke.mockRestore();
});

describe('shared project sources', () => {
  it('does not revoke an asset retained by another mode', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const asset: RingsAsset = { id: 'a', name: 'a.png', src: 'blob:shared' };
    const tracker = createRingsResourceTracker();
    tracker.remember([asset]);
    tracker.sweep([{ ringsAssets: [], tunnelAssets: [asset] }]);
    expect(revoke).not.toHaveBeenCalled();
    revoke.mockRestore();
  });
});
