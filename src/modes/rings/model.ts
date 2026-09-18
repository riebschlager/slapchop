import type { GifData } from '../../types';

export interface RingsAsset {
  id: string;
  name: string;
  src: string;
  gifData?: GifData;
  width?: number;
  height?: number;
}

export interface RingsConfig {
  speed: number;
  gifsPerRing: number;
  ringCount: number;
  radius: number;
  spacing: number;
  gifSize: number;
  twist: number;
  rotationSpeed: number;
  radialOrientation: boolean;
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
  gifSize: 320, twist: 8, rotationSpeed: 6, radialOrientation: false,
  fov: 74, cameraX: 0, cameraY: 0, cameraRoll: 0,
  gifSpeed: 1, ringPhase: 0, shuffle: false, seed: 1,
  fog: 0.00015, backgroundColor: '#03040a'
};

const LIMITS: Partial<Record<keyof RingsConfig, [number, number]>> = {
  speed: [-2400, 2400], gifsPerRing: [1, 48], ringCount: [4, 48],
  radius: [100, 2400], spacing: [100, 2400], gifSize: [20, 1600],
  twist: [-180, 180], rotationSpeed: [-90, 90], fov: [30, 120],
  cameraX: [-1600, 1600], cameraY: [-1600, 1600], cameraRoll: [-180, 180],
  gifSpeed: [0, 4], ringPhase: [0, 1], seed: [0, 100000], fog: [0, 0.001]
};

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
    const w = c.gifSize * Math.min(1, aspect) * scale;
    const h = c.gifSize * Math.min(1, 1 / aspect) * scale;
    // Fade the last spacing interval to avoid popping when the horizon recycles.
    const horizon = Math.min(1, Math.max(0, (c.ringCount * c.spacing - depth) / c.spacing));
    const alpha = Math.exp(-Math.pow(depth * c.fog, 2)) * horizon;
    const sourceTime = t * c.gifSpeed + mod(ringIndex * c.ringPhase, 1) * (asset.gifData?.totalDurationMs ?? 0) / 1000;
    for (let i = 0; i < c.gifsPerRing; i++) {
      const angle = i * Math.PI * 2 / c.gifsPerRing + radians(ringIndex * c.twist + t * c.rotationSpeed);
      const x = (Math.cos(angle) * c.radius - c.cameraX) * scale;
      const y = (Math.sin(angle) * c.radius - c.cameraY) * scale;
      sprites.push({ ringIndex, asset, x: x * Math.cos(roll) - y * Math.sin(roll),
        y: x * Math.sin(roll) + y * Math.cos(roll), width: w, height: h,
        rotation: (c.radialOrientation ? angle + Math.PI / 2 : 0) + roll, alpha, sourceTime });
    }
  }
  return sprites;
}
