import { describe, expect, it } from 'vitest';
import {
  clampHandleToBounds,
  getVisibleHandleBounds,
  isPointOutsideCanvas
} from './canvasViewport';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../renderer/render2d';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('getVisibleHandleBounds', () => {
  it('maps the viewport into centered canvas coordinates', () => {
    const bounds = getVisibleHandleBounds({ width: 800, height: 600 }, 0.5, NO_INSETS);
    expect(bounds).toEqual({ minX: -800, maxX: 800, minY: -600, maxY: 600 });
  });

  it('removes insets in CSS pixels before converting to canvas units', () => {
    const bounds = getVisibleHandleBounds({ width: 800, height: 600 }, 0.5, {
      top: 60,
      right: 20,
      bottom: 20,
      left: 20
    });
    expect(bounds).toEqual({ minX: -760, maxX: 760, minY: -480, maxY: 560 });
  });

  it('always reaches past the frame for a workspace laid out with the usual 80px gutter', () => {
    // Matches the workspace fit: scale = min((w - 80) / CANVAS_WIDTH, (h - 80) / CANVAS_HEIGHT, 1)
    for (const [width, height] of [[900, 700], [1600, 1000], [400, 900], [2400, 2200]]) {
      const scale = Math.min(
        (width - 80) / CANVAS_WIDTH,
        (height - 80) / CANVAS_HEIGHT,
        1
      );
      const bounds = getVisibleHandleBounds({ width, height }, scale, NO_INSETS)!;
      expect(bounds.maxX).toBeGreaterThan(CANVAS_WIDTH / 2);
      expect(bounds.maxY).toBeGreaterThan(CANVAS_HEIGHT / 2);
    }
  });

  it('collapses instead of inverting when the insets overlap', () => {
    const bounds = getVisibleHandleBounds({ width: 30, height: 30 }, 1, {
      top: 40,
      right: 40,
      bottom: 40,
      left: 40
    })!;
    expect(bounds.minX).toBeLessThanOrEqual(bounds.maxX);
    expect(bounds.minY).toBeLessThanOrEqual(bounds.maxY);
  });

  it('returns null for an unmeasured viewport or a degenerate scale', () => {
    expect(getVisibleHandleBounds({ width: 0, height: 0 }, 1, NO_INSETS)).toBeNull();
    expect(getVisibleHandleBounds({ width: 800, height: 600 }, 0, NO_INSETS)).toBeNull();
    expect(getVisibleHandleBounds({ width: 800, height: 600 }, -1, NO_INSETS)).toBeNull();
  });
});

describe('clampHandleToBounds', () => {
  const bounds = { minX: -800, maxX: 800, minY: -600, maxY: 600 };

  it('leaves reachable points untouched', () => {
    expect(clampHandleToBounds({ x: 700, y: -400 }, bounds)).toEqual({
      x: 700,
      y: -400,
      pinned: false
    });
  });

  it('pins points past the edge and reports it', () => {
    expect(clampHandleToBounds({ x: 5000, y: -5000 }, bounds)).toEqual({
      x: 800,
      y: -600,
      pinned: true
    });
  });

  it('pins on a single axis when only one is out of range', () => {
    expect(clampHandleToBounds({ x: 0, y: 900 }, bounds)).toEqual({ x: 0, y: 600, pinned: true });
  });

  it('passes through unchanged when the viewport is unknown', () => {
    expect(clampHandleToBounds({ x: 5000, y: 5000 }, null)).toEqual({
      x: 5000,
      y: 5000,
      pinned: false
    });
  });
});

describe('isPointOutsideCanvas', () => {
  it('treats the frame edge as inside', () => {
    expect(isPointOutsideCanvas({ x: CANVAS_WIDTH / 2, y: 0 }, CANVAS_WIDTH, CANVAS_HEIGHT)).toBe(false);
    expect(isPointOutsideCanvas({ x: 0, y: -CANVAS_HEIGHT / 2 }, CANVAS_WIDTH, CANVAS_HEIGHT)).toBe(false);
  });

  it('detects points past either axis', () => {
    expect(isPointOutsideCanvas({ x: 541, y: 0 }, CANVAS_WIDTH, CANVAS_HEIGHT)).toBe(true);
    expect(isPointOutsideCanvas({ x: 0, y: -961 }, CANVAS_WIDTH, CANVAS_HEIGHT)).toBe(true);
  });
});
