export type AppMode = 'symmetry' | 'polygon';

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface PolygonLayer {
  id: string;
  name: string;
  points: PolygonPoint[];
  src?: string;
  gifData?: GifData;
  gifSpeed?: number;
  textureScale: number;
  textureRotation: number;
  textureOffsetX: number;
  textureOffsetY: number;
  opacity: number;
  blendMode: BlendMode;
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  hidden?: boolean;
  motionTextureScale?: MotionConfig;
  motionTextureRotation?: MotionConfig;
  motionTextureOffsetX?: MotionConfig;
  motionTextureOffsetY?: MotionConfig;
  // Symmetry is shared with Layer: same field names/shapes so a single
  // <SymmetryEditor> UI and the shared getSymmetryTransforms() engine work
  // for both. Optional so old saved polygons (which predate this feature)
  // default cleanly to 'none' instead of requiring a file migration.
  symmetry?: SymmetryType;
  radialSegments?: number;
  symmetryParams?: SymmetryParams;
  // Per-vertex "jelly"/breathing deformation, applied before symmetry.
  // incoherence (0..1) desyncs each vertex's phase so they don't pulse in
  // unison; reuses MotionConfig/applyMotion rather than a new time system.
  vertexNoise?: MotionConfig & { incoherence: number };
}


export type SymmetryType =
  | 'none' | 'mirror-x' | 'mirror-y' | 'quad' | 'radial'
  | 'spiral' | 'wallpaper' | 'poincare' | 'voronoi';

export type WallpaperLattice = 'p3' | 'p4m' | 'p6';

// Extra per-mode knobs shared by every symmetry type on both Layer and
// PolygonLayer. originX/originY re-center all modes on a draggable anchor
// instead of the canvas origin. Fields are grouped by the mode that reads
// them; unused fields for the active mode are simply ignored.
export interface SymmetryParams {
  originX: number;
  originY: number;
  spiralGrowth: number;
  spiralAngleStep: number;
  spiralInstances: number;
  wallpaperLattice: WallpaperLattice;
  wallpaperCellSize: number;
  poincareRings: number;
  poincareRadius: number;
  voronoiCells: number;
  voronoiSeed: number;
  voronoiPhaseVariation: number;
}

export const DEFAULT_SYMMETRY_PARAMS: SymmetryParams = {
  originX: 0,
  originY: 0,
  spiralGrowth: 0.85,
  spiralAngleStep: 25,
  spiralInstances: 10,
  wallpaperLattice: 'p6',
  wallpaperCellSize: 260,
  poincareRings: 4,
  poincareRadius: 480,
  voronoiCells: 16,
  voronoiSeed: 1,
  voronoiPhaseVariation: 0.4
};

export type BlendMode = 
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' 
  | 'lighten' | 'color-dodge' | 'color-burn' | 'difference' 
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export type MotionType = 'none' | 'sine' | 'noise';

export interface MotionConfig {
  type: MotionType;
  speed: number;
  amplitude: number;
  phase: number;
}

export interface GifFrameData {
  image: CanvasImageSource;
  delayMs: number;
  startTimeMs: number;
  endTimeMs: number;
}

export interface GifData {
  frames: GifFrameData[];
  totalDurationMs: number;
  width: number;
  height: number;
}

export interface Layer {
  id: string;
  name: string;
  src: string; // Data URL or object URL
  gifData?: GifData;
  gifSpeed?: number; // Speed multiplier for GIF playback (default 1)
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  symmetry: SymmetryType;
  radialSegments: number;
  symmetryParams?: SymmetryParams;
  blendMode: BlendMode;
  opacity: number;
  hidden?: boolean;
  motionX?: MotionConfig;
  motionY?: MotionConfig;
  motionRotation?: MotionConfig;
  motionScale?: MotionConfig;
}

export interface MasterFxConfig {
  enabled: boolean;

  // 1. Chromatic Aberration / RGB Split
  rgbSplitEnabled: boolean;
  rgbSplitOffset: number;
  rgbSplitAngle: number;
  motionRgbSplitOffset?: MotionConfig;

  // 2. Duotone / Color Gradient Map
  duotoneEnabled: boolean;
  duotoneShadowColor: string;
  duotoneHighlightColor: string;
  duotoneIntensity: number;

  // 3. Film Grain / Noise
  noiseEnabled: boolean;
  noiseAmount: number;
  noiseSpeed: number;

  // 4. CRT Scanlines
  scanlinesEnabled: boolean;
  scanlinesCount: number;
  scanlinesOpacity: number;
  scanlinesSpeed: number;

  // 5. Bloom / Soft Glow
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomQuality: number;

  // 6. Color Adjustments
  colorAdjustEnabled: boolean;
  brightness: number; // -1 to 1 (0 = neutral)
  contrast: number;   // -1 to 1 (0 = neutral)
  saturation: number; // -1 to 1 (0 = neutral)
  hueRotate: number;  // 0 to 360 deg
  motionHueRotate?: MotionConfig;
}

export const DEFAULT_MASTER_FX: MasterFxConfig = {
  enabled: false,
  rgbSplitEnabled: false,
  rgbSplitOffset: 12,
  rgbSplitAngle: 0,
  duotoneEnabled: false,
  duotoneShadowColor: '#180033',
  duotoneHighlightColor: '#00ffcc',
  duotoneIntensity: 1,
  noiseEnabled: false,
  noiseAmount: 0.15,
  noiseSpeed: 1,
  scanlinesEnabled: false,
  scanlinesCount: 360,
  scanlinesOpacity: 0.25,
  scanlinesSpeed: 0.5,
  bloomEnabled: false,
  bloomStrength: 4,
  bloomQuality: 3,
  colorAdjustEnabled: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hueRotate: 0,
};

