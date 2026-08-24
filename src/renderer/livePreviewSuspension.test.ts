import { describe, expect, it, vi } from 'vitest';
import {
  isLivePreviewRenderingSuspended,
  subscribeToLivePreviewSuspension,
  suspendLivePreviewRendering
} from './livePreviewSuspension';

describe('live preview rendering suspension', () => {
  it('stays suspended until every caller releases its hold', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToLivePreviewSuspension(listener);
    const resumeFirst = suspendLivePreviewRendering();
    const resumeSecond = suspendLivePreviewRendering();

    expect(isLivePreviewRenderingSuspended()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(true);

    resumeFirst();
    resumeFirst();
    expect(isLivePreviewRenderingSuspended()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    resumeSecond();
    expect(isLivePreviewRenderingSuspended()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(false);

    unsubscribe();
  });
});
