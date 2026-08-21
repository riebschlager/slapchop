export type AppMode = 'symmetry' | 'polygon' | '3d';

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

// ------------------------------------------------------------- 3D mesh mode

export type Mesh3dPrimitive =
  | 'plane' | 'cylinder' | 'torus' | 'sphere' | 'ribbon' | 'box'
  | 'extruded-polygon' | 'custom-mesh';

export type SineWaveAxis = 'x' | 'y' | 'z' | 'radial' | 'uv';

export interface SineWaveDeformerConfig {
  enabled: boolean;
  axis: SineWaveAxis;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  // Exponential falloff of amplitude with distance from the axis origin;
  // 0 disables falloff so the ripple has uniform amplitude everywhere.
  decay: number;
}

export const DEFAULT_SINE_WAVE_DEFORMER: SineWaveDeformerConfig = {
  enabled: false,
  axis: 'y',
  amplitude: 40,
  frequency: 1,
  speed: 0.5,
  phase: 0,
  decay: 0
};

export type NoiseDisplacementMode = 'normal' | 'axis' | 'spherical';

export interface NoiseDeformerConfig {
  enabled: boolean;
  displacementMode: NoiseDisplacementMode;
  amplitude: number;
  // Spatial frequency: higher values shrink the noise "wavelength".
  scale: number;
  octaves: number;
  // Amplitude falloff (persistence) applied per additional octave, 0..1.
  roughness: number;
  speed: number;
  phase: number;
  seed: number;
}

export const DEFAULT_NOISE_DEFORMER: NoiseDeformerConfig = {
  enabled: false,
  displacementMode: 'normal',
  amplitude: 30,
  scale: 1,
  octaves: 3,
  roughness: 0.5,
  speed: 0.3,
  phase: 0,
  seed: 1
};

export type TwistAxis = 'x' | 'y' | 'z';

export interface TwistDeformerConfig {
  enabled: boolean;
  axis: TwistAxis;
  // Total twist, in degrees, applied across the mesh's full extent along axis.
  angle: number;
  speed: number;
  phase: number;
}

export const DEFAULT_TWIST_DEFORMER: TwistDeformerConfig = {
  enabled: false,
  axis: 'y',
  angle: 90,
  speed: 0,
  phase: 0
};

export interface VertexJellyConfig {
  enabled: boolean;
  amplitude: number;
  speed: number;
  phase: number;
  // 0..1, desyncs each vertex's phase so they don't pulse in unison.
  incoherence: number;
}

export const DEFAULT_VERTEX_JELLY: VertexJellyConfig = {
  enabled: false,
  amplitude: 10,
  speed: 1,
  phase: 0,
  incoherence: 0.5
};

export type Symmetry3dType =
  | 'none' | 'mirror-x' | 'mirror-y' | 'mirror-z'
  | 'radial-y' | 'radial-z' | 'helix' | 'cubic-grid' | 'spherical-shell';

// Extra per-mode knobs for Symmetry3dType, mirroring SymmetryParams' role
// for the 2D engine: fields are grouped by the mode that reads them, and
// unused fields for the active mode are simply ignored.
export interface Symmetry3dParams {
  originX: number;
  originY: number;
  originZ: number;
  helixTurns: number;
  helixRise: number;
  helixInstances: number;
  cubicGridCountX: number;
  cubicGridCountY: number;
  cubicGridCountZ: number;
  cubicGridSpacing: number;
  sphericalShellCount: number;
  sphericalShellRadius: number;
}

export const DEFAULT_SYMMETRY3D_PARAMS: Symmetry3dParams = {
  originX: 0,
  originY: 0,
  originZ: 0,
  helixTurns: 2,
  helixRise: 120,
  helixInstances: 12,
  cubicGridCountX: 3,
  cubicGridCountY: 3,
  cubicGridCountZ: 3,
  cubicGridSpacing: 200,
  sphericalShellCount: 24,
  sphericalShellRadius: 400
};

export type ShadingModel = 'unlit' | 'flat' | 'smooth';

export interface Mesh3dLayer {
  id: string;
  name: string;
  hidden?: boolean;

  // Geometry
  primitive: Mesh3dPrimitive;
  width: number;
  height: number;
  depth: number;
  subdivisionX: number;
  subdivisionY: number;
  // Base contour for 'extruded-polygon', in the same center-origin point
  // shape as PolygonLayer so polygon presets/drawings can be reused as-is.
  contour?: PolygonPoint[];
  bevelSize?: number;

  // Material & texture
  src?: string;
  gifData?: GifData;
  gifSpeed?: number;
  uvScale: number;
  uvRotation: number;
  uvOffsetX: number;
  uvOffsetY: number;
  uvRepeat: boolean;
  fillColor?: string;
  wireframe: boolean;
  wireframeWidth: number;
  wireframeColor: string;
  doubleSided: boolean;
  depthTest: boolean;
  blendMode: BlendMode;
  shadingModel: ShadingModel;

  // 3D transform. x/y share the 2D layers' center-origin convention; z is
  // depth, positive toward the camera (see Camera3dConfig).
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  pivotX: number;
  pivotY: number;
  pivotZ: number;

  // Motion modulators, applied before deformers (mirrors getModulatedLayer).
  motionX?: MotionConfig;
  motionY?: MotionConfig;
  motionZ?: MotionConfig;
  motionRotX?: MotionConfig;
  motionRotY?: MotionConfig;
  motionRotZ?: MotionConfig;
  motionScaleX?: MotionConfig;
  motionScaleY?: MotionConfig;
  motionScaleZ?: MotionConfig;

  // Deformers, applied in this fixed order: twist -> sine wave -> noise ->
  // vertex jelly (see deformation3d.ts).
  sineWaveDeformer?: SineWaveDeformerConfig;
  noiseDeformer?: NoiseDeformerConfig;
  twistDeformer?: TwistDeformerConfig;
  vertexJelly?: VertexJellyConfig;

  // 3D symmetry (spatial instancing), applied after deformation.
  symmetry3d?: Symmetry3dType;
  radialSegments3d?: number;
  symmetry3dParams?: Symmetry3dParams;
}

export type ProjectionMode = 'perspective' | 'orthographic';

export interface Camera3dConfig {
  fov: number; // degrees, perspective projection only
  distance: number;
  pitch: number;
  yaw: number;
  roll: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  projection: ProjectionMode;
  motionDistance?: MotionConfig;
  motionPitch?: MotionConfig;
  motionYaw?: MotionConfig;
}

// Coordinate invariant: at the default FOV, a Z=0 plane sized 1080x1920
// fills the viewport at 1:1 with the 2D canvas, so switching to 3D mode
// with a bare plane looks identical to the 2D canvas until the user moves
// the camera or geometry. distance = (viewportHeight/2) / tan(fov/2).
const DEFAULT_CAMERA3D_FOV = 45;
const DEFAULT_CAMERA3D_DISTANCE = 960 / Math.tan((DEFAULT_CAMERA3D_FOV / 2) * (Math.PI / 180));

export const DEFAULT_CAMERA3D: Camera3dConfig = {
  fov: DEFAULT_CAMERA3D_FOV,
  distance: DEFAULT_CAMERA3D_DISTANCE,
  pitch: 0,
  yaw: 0,
  roll: 0,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  projection: 'perspective'
};

