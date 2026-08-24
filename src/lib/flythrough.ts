import { FlythroughAsset, FlythroughConfig } from '../types';
import { applyMotion } from './motion';

export interface FlythroughParticle {
  index: number;
  asset: FlythroughAsset;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  rotation: number;
}

const NEAR_DISTANCE = 60;

function fract(value: number): number {
  return value - Math.floor(value);
}

// Small integer hash with stable cross-renderer output. Keeping this pure and
// index-based means increasing the particle count never reshuffles old paths.
export function flythroughRandom(index: number, channel: number, seed: number): number {
  const x = Math.sin((index + 1) * 12.9898 + channel * 78.233 + seed * 37.719) * 43758.5453;
  return fract(x);
}

export function resolveFlythroughParticles(
  assets: FlythroughAsset[],
  config: FlythroughConfig,
  t: number
): FlythroughParticle[] {
  if (assets.length === 0 || config.particleCount <= 0) return [];

  const depth = Math.max(100, config.depth);
  const speed = Math.max(0, applyMotion(config.speed, config.motionSpeed, t));
  const globalX = applyMotion(0, config.motionDriftX, t);
  const globalY = applyMotion(0, config.motionDriftY, t);
  const globalRotation = applyMotion(0, config.motionRotation, t);
  const scale = Math.max(0.05, applyMotion(1, config.motionScale, t));
  const count = Math.min(300, Math.max(0, Math.round(config.particleCount)));

  return Array.from({ length: count }, (_, index) => {
    const asset = assets[Math.floor(flythroughRandom(index, 0, config.seed) * assets.length) % assets.length];
    const phase = flythroughRandom(index, 1, config.seed) * depth;
    const distance = NEAR_DISTANCE + fract((phase - speed * t) / depth) * depth;
    const size = (config.minSize + flythroughRandom(index, 4, config.seed) * (config.maxSize - config.minSize)) * scale;
    const sourceWidth = asset.gifData?.width ?? asset.width;
    const sourceHeight = asset.gifData?.height ?? asset.height;
    const aspect = sourceWidth && sourceHeight && sourceHeight > 0
      ? sourceWidth / sourceHeight
      : 1;

    return {
      index,
      asset,
      x: (flythroughRandom(index, 2, config.seed) - 0.5) * config.spreadX + globalX,
      y: (flythroughRandom(index, 3, config.seed) - 0.5) * config.spreadY + globalY,
      z: -distance,
      width: size * aspect,
      height: size,
      rotation: (flythroughRandom(index, 5, config.seed) - 0.5) * 50 + globalRotation
    };
  });
}
