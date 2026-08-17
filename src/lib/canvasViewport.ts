import { PolygonPoint } from '../types';

/**
 * Geometry for keeping interactive handles reachable when the point they
 * represent sits outside the 1080x1920 frame.
 *
 * Everything here works in design canvas coordinates (center origin), the same
 * space polygon points and layer positions live in. The workspace scales that
 * space down to fit the window, so the visible area is usually larger than the
 * frame itself — a point just outside the frame can still be drawn in the
 * margin, and a point beyond the margin gets pinned to the edge of the visible
 * area so it can still be grabbed.
 */

export interface Viewport {
  width: number;
  height: number;
}

/** CSS-pixel gutters kept clear of pinned handles (top clears the header bar). */
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Reachable handle area in canvas coordinates. */
export interface HandleBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface HandlePlacement {
  /** Canvas coordinates to draw the handle at. */
  x: number;
  y: number;
  /** True when the real point is outside the bounds and the handle was moved. */
  pinned: boolean;
}

/**
 * Converts the workspace viewport into the range of canvas coordinates whose
 * handles can be drawn on screen. The canvas is centered in the viewport, so a
 * coordinate maps to `coord * scale` CSS pixels from the viewport center.
 *
 * Returns null when the viewport has not been measured yet or the scale is
 * degenerate, which callers treat as "do not pin anything".
 */
export function getVisibleHandleBounds(
  viewport: Viewport,
  scale: number,
  insets: ViewportInsets
): HandleBounds | null {
  if (!(scale > 0) || viewport.width <= 0 || viewport.height <= 0) return null;

  const minX = (-viewport.width / 2 + insets.left) / scale;
  const maxX = (viewport.width / 2 - insets.right) / scale;
  const minY = (-viewport.height / 2 + insets.top) / scale;
  const maxY = (viewport.height / 2 - insets.bottom) / scale;

  // A window small enough for the insets to overlap leaves no usable range;
  // collapse to the midpoint rather than emitting inverted bounds.
  return {
    minX: Math.min(minX, (minX + maxX) / 2),
    maxX: Math.max(maxX, (minX + maxX) / 2),
    minY: Math.min(minY, (minY + maxY) / 2),
    maxY: Math.max(maxY, (minY + maxY) / 2)
  };
}

export function clampHandleToBounds(
  point: PolygonPoint,
  bounds: HandleBounds | null
): HandlePlacement {
  if (!bounds) return { x: point.x, y: point.y, pinned: false };
  const x = Math.min(Math.max(point.x, bounds.minX), bounds.maxX);
  const y = Math.min(Math.max(point.y, bounds.minY), bounds.maxY);
  return { x, y, pinned: x !== point.x || y !== point.y };
}

/** True when the point falls outside the rendered frame. */
export function isPointOutsideCanvas(
  point: PolygonPoint,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  return Math.abs(point.x) > canvasWidth / 2 || Math.abs(point.y) > canvasHeight / 2;
}
