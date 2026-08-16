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
}


export type SymmetryType = 'none' | 'mirror-x' | 'mirror-y' | 'quad' | 'radial';

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
  blendMode: BlendMode; 
  opacity: number;
  hidden?: boolean;
  motionX?: MotionConfig;
  motionY?: MotionConfig;
  motionRotation?: MotionConfig;
  motionScale?: MotionConfig;
}
