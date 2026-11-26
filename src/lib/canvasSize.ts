// The output surface is one of a few fixed presets. The short side stays at
// 1080 so pixel density and export cost match the original portrait frame.
// Design coordinates are center-origin, so switching presets re-frames the
// document without rewriting any mode's data.

export type CanvasAspect = '9:16' | '16:9' | '1:1';
export type ExportResolution = 'full' | 'hd' | 'compact';

export interface CanvasSize {
  width: number;
  height: number;
}

export const DEFAULT_CANVAS_ASPECT: CanvasAspect = '9:16';

export const CANVAS_ASPECTS: readonly CanvasAspect[] = ['9:16', '16:9', '1:1'];

const SHORT_SIDE = 1080;

const CANVAS_SIZES: Record<CanvasAspect, CanvasSize> = {
  '9:16': { width: SHORT_SIDE, height: 1920 },
  '16:9': { width: 1920, height: SHORT_SIDE },
  '1:1': { width: SHORT_SIDE, height: SHORT_SIDE }
};

/** The original portrait frame, which pre-V15 documents were authored in. */
const REFERENCE_SIZE = CANVAS_SIZES['9:16'];

/**
 * Half-height of the portrait frame. Projections that map world units to
 * design pixels (3D Space, GIF Rings) keep this focal reference so content
 * keeps its scale when the frame changes shape.
 */
export const REFERENCE_HALF_HEIGHT = REFERENCE_SIZE.height / 2;

/** Largest half-extent any preset allows, for validating persisted coordinates. */
export const MAX_HALF_EXTENT = {
  x: Math.max(...Object.values(CANVAS_SIZES).map(size => size.width)) / 2,
  y: Math.max(...Object.values(CANVAS_SIZES).map(size => size.height)) / 2
};

// hd is 2/3 and compact is 1/2 of the design size; both stay even for every
// preset, which H.264/HEVC/ProRes encoders require.
const EXPORT_SCALES: Record<ExportResolution, number> = {
  full: 1,
  hd: 2 / 3,
  compact: 1 / 2
};

export function isCanvasAspect(value: unknown): value is CanvasAspect {
  return typeof value === 'string' && (CANVAS_ASPECTS as readonly string[]).includes(value);
}

export function getCanvasSize(aspect: CanvasAspect | undefined): CanvasSize {
  return CANVAS_SIZES[aspect ?? DEFAULT_CANVAS_ASPECT];
}

export function getExportSize(aspect: CanvasAspect | undefined, resolution: ExportResolution): CanvasSize {
  const { width, height } = getCanvasSize(aspect);
  const scale = EXPORT_SCALES[resolution];
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Design frame recovered from an output size. Every output is a uniform scale
 * of its design frame and every frame's short side is 1080 units, so renderers
 * that only receive output pixels (GIF Paint's raster caches, the 3D camera)
 * can recover the exact design frame without a separate parameter.
 */
export function getDesignSizeForOutput(width: number, height: number): CanvasSize {
  const scale = Math.min(width, height) / SHORT_SIDE;
  return { width: Math.round(width / scale), height: Math.round(height / scale) };
}

/**
 * Offset from the frame's top-left to the portrait frame's top-left, in design
 * units. Polygon texture patterns anchor there so a re-frame never slides them.
 */
export function getPatternAnchor(design: CanvasSize): { x: number; y: number } {
  return { x: (design.width - REFERENCE_SIZE.width) / 2, y: (design.height - REFERENCE_SIZE.height) / 2 };
}
