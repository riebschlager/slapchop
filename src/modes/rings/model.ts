import type { GifData } from '../../types';

export interface RingsAsset {
  id: string;
  name: string;
  src: string;
  gifData?: GifData;
  width?: number;
  height?: number;
}

// Animated GIF card size, in the same world units as `gifSize`. The sweep
// oscillates each ring between `min` and `max`, stepping its phase by
// `ringSpread` cycles per ring so a non-zero spread travels down the corridor.
// Noise is per card and layers over either the sweep or the static size;
// `noisePeriod` is seconds between noise keys.
export interface RingsSizeMotion {
  sweep: boolean;
  min: number;
  max: number;
  speed: number;
  ringSpread: number;
  noise: boolean;
  noiseAmplitude: number;
  noisePeriod: number;
}

export const DEFAULT_RINGS_SIZE_MOTION: RingsSizeMotion = {
  sweep: false, min: 200, max: 520, speed: 0.25, ringSpread: 0.08,
  noise: false, noiseAmplitude: 80, noisePeriod: 1.5
};

// Smooth X/Y jitter of each card's ring position, in world units before
// perspective. `period` is the noise wavelength in world units, sampled at the
// card's home spot in the corridor, so a long period moves neighboring cards
// and rings together while a short one scatters them; `speed` is noise cycles
// per second.
export interface RingsPositionNoise {
  enabled: boolean;
  amplitude: number;
  period: number;
  speed: number;
}

export const DEFAULT_RINGS_POSITION_NOISE: RingsPositionNoise = {
  enabled: false, amplitude: 120, period: 900, speed: 0.4
};

export interface RingsConfig {
  speed: number;
  gifsPerRing: number;
  ringCount: number;
  radius: number;
  spacing: number;
  gifSize: number;
  sizeMotion: RingsSizeMotion;
  positionNoise: RingsPositionNoise;
  twist: number;
  rotationSpeed: number;
  radialOrientation: boolean;
  gifRotation: number;
  fov: number;
  cameraX: number;
  cameraY: number;
  cameraRoll: number;
  gifSpeed: number;
  ringPhase: number;
  shuffle: boolean;
  seed: number;
  fog: number;
  backgroundColor: string;
}

export const DEFAULT_RINGS: RingsConfig = {
  speed: 900, gifsPerRing: 12, ringCount: 24, radius: 850, spacing: 700,
  gifSize: 320, sizeMotion: DEFAULT_RINGS_SIZE_MOTION, positionNoise: DEFAULT_RINGS_POSITION_NOISE, twist: 8, rotationSpeed: 6, radialOrientation: false, gifRotation: 0,
  fov: 74, cameraX: 0, cameraY: 0, cameraRoll: 0,
  gifSpeed: 1, ringPhase: 0, shuffle: false, seed: 1,
  fog: 0.00015, backgroundColor: '#03040a'
};

const LIMITS: Partial<Record<keyof RingsConfig, [number, number]>> = {
  speed: [-2400, 2400], gifsPerRing: [1, 48], ringCount: [4, 48],
  radius: [100, 2400], spacing: [100, 2400], gifSize: [20, 1600],
  twist: [-180, 180], rotationSpeed: [-90, 90], gifRotation: [-180, 180], fov: [30, 120],
  cameraX: [-1600, 1600], cameraY: [-1600, 1600], cameraRoll: [-180, 180],
  gifSpeed: [0, 4], ringPhase: [0, 1], seed: [0, 100000], fog: [0, 0.001]
};

const SIZE_MOTION_LIMITS: Record<Exclude<keyof RingsSizeMotion, 'sweep' | 'noise'>, [number, number]> = {
  min: [20, 1600], max: [20, 1600], speed: [0, 10], ringSpread: [-0.5, 0.5],
  noiseAmplitude: [0, 800], noisePeriod: [0.05, 10]
};

function normalizeSizeMotion(input: Partial<RingsSizeMotion> | undefined): RingsSizeMotion {
  const result = { ...DEFAULT_RINGS_SIZE_MOTION };
  if (!input || typeof input !== 'object') return result;
  for (const key of Object.keys(SIZE_MOTION_LIMITS) as (keyof typeof SIZE_MOTION_LIMITS)[]) {
    const value = input[key];
    const range = SIZE_MOTION_LIMITS[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(range[0], Math.min(range[1], value));
  }
  for (const key of ['sweep', 'noise'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  return result;
}

const POSITION_NOISE_LIMITS: Record<Exclude<keyof RingsPositionNoise, 'enabled'>, [number, number]> = {
  amplitude: [0, 1600], period: [50, 5000], speed: [0, 10]
};

function normalizePositionNoise(input: Partial<RingsPositionNoise> | undefined): RingsPositionNoise {
  const result = { ...DEFAULT_RINGS_POSITION_NOISE };
  if (!input || typeof input !== 'object') return result;
  for (const key of Object.keys(POSITION_NOISE_LIMITS) as (keyof typeof POSITION_NOISE_LIMITS)[]) {
    const value = input[key];
    const range = POSITION_NOISE_LIMITS[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(range[0], Math.min(range[1], value));
  }
  if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
  return result;
}

/** Validate this mode's persisted values before they reach allocation or projection. */
export function normalizeRings(input: Partial<RingsConfig> = {}): RingsConfig {
  const result = { ...DEFAULT_RINGS };
  for (const key of Object.keys(LIMITS) as (keyof RingsConfig)[]) {
    const value = input[key];
    const range = LIMITS[key]!;
    if (typeof value === 'number' && Number.isFinite(value)) {
      Object.assign(result, { [key]: Math.max(range[0], Math.min(range[1], value)) });
    }
  }
  for (const key of ['gifsPerRing', 'ringCount', 'seed'] as const) result[key] = Math.round(result[key]);
  for (const key of ['shuffle', 'radialOrientation'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  result.sizeMotion = normalizeSizeMotion(input.sizeMotion);
  result.positionNoise = normalizePositionNoise(input.positionNoise);
  if (typeof input.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.backgroundColor)) {
    result.backgroundColor = input.backgroundColor;
  }
  return result;
}

export interface RingSprite {
  ringIndex: number;
  asset: RingsAsset;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  alpha: number;
  sourceTime: number;
}

const mod = (n: number, d: number) => ((n % d) + d) % d;
const radians = (degrees: number) => degrees * Math.PI / 180;

// Smooth 1D value noise in [-1, 1]. `key` decorrelates cards so each one
// drifts independently while staying a pure function of time.
function valueNoise(x: number, key: number, seed: number): number {
  const cell = Math.floor(x);
  const f = x - cell;
  const eased = f * f * (3 - 2 * f);
  const hash = (n: number) => mod(Math.sin((n + key * 1013 + 1) * 12.9898 + seed * 78.233) * 43758.5453, 1);
  const a = hash(cell);
  return (a + (hash(cell + 1) - a) * eased) * 2 - 1;
}

// gifsPerRing is capped at 48, so a fixed stride keeps card keys stable when
// the count changes instead of reshuffling every card's noise.
const CARD_KEY_STRIDE = 64;

/** World-unit size of one card before perspective; expects a normalized config. */
export function ringCardSize(c: RingsConfig, ringIndex: number, cardIndex: number, t: number): number {
  const motion = c.sizeMotion;
  let size = c.gifSize;
  if (motion.sweep) {
    const wave = Math.sin((t * motion.speed - ringIndex * motion.ringSpread) * Math.PI * 2);
    size = motion.min + (motion.max - motion.min) * (wave * 0.5 + 0.5);
  }
  if (motion.noise && motion.noiseAmplitude !== 0) {
    size += valueNoise(t / motion.noisePeriod, ringIndex * CARD_KEY_STRIDE + cardIndex, c.seed) * motion.noiseAmplitude;
  }
  return Math.max(1, size);
}

// Smooth 3D value noise in [-1, 1], trilinear over hashed lattice corners.
function valueNoise3(x: number, y: number, z: number, key: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const ease = (f: number) => f * f * (3 - 2 * f);
  const fx = ease(x - ix), fy = ease(y - iy), fz = ease(z - iz);
  const hash = (a: number, b: number, d: number) =>
    mod(Math.sin(a * 127.1 + b * 311.7 + d * 74.7 + key * 1013 + seed * 78.233) * 43758.5453, 1);
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const plane = (d: number) => lerp(
    lerp(hash(ix, iy, d), hash(ix + 1, iy, d), fx),
    lerp(hash(ix, iy + 1, d), hash(ix + 1, iy + 1, d), fx), fy);
  return lerp(plane(iz), plane(iz + 1), fz) * 2 - 1;
}

/** World-unit X/Y jitter of one card; expects a normalized config.
 * Samples at the card's home position (ring rotation over time excluded) so
 * the distortion rides with the card instead of the card sliding through it.
 */
export function ringCardOffset(c: RingsConfig, ringIndex: number, cardIndex: number, t: number): { x: number; y: number } {
  const noise = c.positionNoise;
  if (!noise.enabled || noise.amplitude === 0) return { x: 0, y: 0 };
  const angle = cardIndex * Math.PI * 2 / c.gifsPerRing + radians(ringIndex * c.twist);
  const px = Math.cos(angle) * c.radius / noise.period;
  const py = Math.sin(angle) * c.radius / noise.period;
  const pz = ringIndex * c.spacing / noise.period + t * noise.speed;
  return {
    x: valueNoise3(px, py, pz, 1, c.seed) * noise.amplitude,
    y: valueNoise3(px, py, pz, 2, c.seed) * noise.amplitude
  };
}

/** Camera-parallel cards in perspective; both renderers use these exact projections.
 * Absolute ring IDs keep asset choice and twist stable when a ring passes the camera.
 */
export function resolveRings(assets: RingsAsset[], input: RingsConfig, t: number): RingSprite[] {
  if (!assets.length) return [];
  const c = normalizeRings(input);
  const travel = c.speed * t;
  const first = Math.floor(travel / c.spacing) + 1;
  const focal = 960 / Math.tan(radians(c.fov) / 2);
  const roll = radians(c.cameraRoll);
  const gifRotation = radians(c.gifRotation);
  const sprites: RingSprite[] = [];
  for (let row = c.ringCount - 1; row >= 0; row--) {
    const ringIndex = first + row;
    const depth = ringIndex * c.spacing - travel;
    if (depth < 1) continue;
    const random = Math.sin(ringIndex * 12.9898 + c.seed * 78.233) * 43758.5453;
    const assetIndex = c.shuffle ? Math.floor(mod(random, 1) * assets.length) : mod(ringIndex - 1, assets.length);
    const asset = assets[assetIndex];
    const scale = focal / depth;
    const aspect = Math.max(1, asset.gifData?.width ?? asset.width ?? 1) / Math.max(1, asset.gifData?.height ?? asset.height ?? 1);
    // Fade the last spacing interval to avoid popping when the horizon recycles.
    const horizon = Math.min(1, Math.max(0, (c.ringCount * c.spacing - depth) / c.spacing));
    const alpha = Math.exp(-Math.pow(depth * c.fog, 2)) * horizon;
    const sourceTime = t * c.gifSpeed + mod(ringIndex * c.ringPhase, 1) * (asset.gifData?.totalDurationMs ?? 0) / 1000;
    for (let i = 0; i < c.gifsPerRing; i++) {
      const angle = i * Math.PI * 2 / c.gifsPerRing + radians(ringIndex * c.twist + t * c.rotationSpeed);
      const offset = ringCardOffset(c, ringIndex, i, t);
      const x = (Math.cos(angle) * c.radius + offset.x - c.cameraX) * scale;
      const y = (Math.sin(angle) * c.radius + offset.y - c.cameraY) * scale;
      const size = ringCardSize(c, ringIndex, i, t) * scale;
      const w = size * Math.min(1, aspect);
      const h = size * Math.min(1, 1 / aspect);
      sprites.push({ ringIndex, asset, x: x * Math.cos(roll) - y * Math.sin(roll),
        y: x * Math.sin(roll) + y * Math.cos(roll), width: w, height: h,
        rotation: (c.radialOrientation ? angle + Math.PI / 2 : 0) + gifRotation + roll, alpha, sourceTime });
    }
  }
  return sprites;
}
