import { describe, expect, it } from 'vitest';
import {
  CANVAS_ASPECTS, getCanvasSize, getDesignSizeForOutput, getExportSize, getPatternAnchor, isCanvasAspect, MAX_HALF_EXTENT
} from './canvasSize';

describe('canvas size presets', () => {
  it('keeps the short side at 1080', () => {
    expect(getCanvasSize('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(getCanvasSize('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(getCanvasSize('1:1')).toEqual({ width: 1080, height: 1080 });
    expect(getCanvasSize(undefined)).toEqual({ width: 1080, height: 1920 });
  });

  it('produces even export sizes for every preset and resolution', () => {
    for (const aspect of CANVAS_ASPECTS) {
      for (const resolution of ['full', 'hd', 'compact'] as const) {
        const { width, height } = getExportSize(aspect, resolution);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
      }
    }
    expect(getExportSize('9:16', 'hd')).toEqual({ width: 720, height: 1280 });
    expect(getExportSize('16:9', 'compact')).toEqual({ width: 960, height: 540 });
    expect(getExportSize('1:1', 'hd')).toEqual({ width: 720, height: 720 });
  });

  it('validates persisted values', () => {
    expect(isCanvasAspect('16:9')).toBe(true);
    expect(isCanvasAspect('4:3')).toBe(false);
    expect(isCanvasAspect(undefined)).toBe(false);
  });

  it('recovers the design frame from any export size', () => {
    for (const aspect of CANVAS_ASPECTS) {
      for (const resolution of ['full', 'hd', 'compact'] as const) {
        const { width, height } = getExportSize(aspect, resolution);
        expect(getDesignSizeForOutput(width, height)).toEqual(getCanvasSize(aspect));
      }
    }
  });

  it('anchors patterns to the portrait corner and bounds coordinates by the largest preset', () => {
    expect(getPatternAnchor(getCanvasSize('9:16'))).toEqual({ x: 0, y: 0 });
    expect(getPatternAnchor(getCanvasSize('16:9'))).toEqual({ x: 420, y: -420 });
    expect(MAX_HALF_EXTENT).toEqual({ x: 960, y: 960 });
  });
});
