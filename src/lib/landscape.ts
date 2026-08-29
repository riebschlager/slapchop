import { LandscapeConfig, LandscapeSkySource, MotionConfig } from '../types';
import { applyMotion } from './motion';

export interface LandscapePoint {
  x: number;
  y: number;
  z: number;
}

export interface LandscapeCell {
  row: number;
  column: number;
  assetIndex: number;
  corners: [LandscapePoint, LandscapePoint, LandscapePoint, LandscapePoint];
}

export interface ResolvedLandscapeFrame {
  config: LandscapeConfig;
  skySources: LandscapeSkySource[];
  travel: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function resolveBoundedMotion(
  baseValue: number,
  motion: MotionConfig | undefined,
  t: number,
  min: number,
  max: number
): number {
  if (!motion || motion.type === 'none') return baseValue;
  return clamp(applyMotion(baseValue, motion, t), min, max);
}

function integratedCos(rate: number, phase: number, t: number): number {
  if (Math.abs(rate) < 0.000001) return Math.cos(phase) * t;
  return (Math.sin(rate * t + phase) - Math.sin(phase)) / rate;
}

/**
 * Integrate the configured velocity from zero to t so a speed pulse produces
 * continuous travel. Multiplying the instantaneous velocity by t would make
 * the apparent pulse grow with the project duration and jump during scrubbing.
 */
export function landscapeTravelDistance(config: LandscapeConfig, t: number): number {
  const elapsed = Math.max(0, t);
  const baseTravel = config.flightSpeed * elapsed;
  const motion = config.motionFlightSpeed;
  if (!motion || motion.type === 'none') return baseTravel;

  let modulationTravel = 0;
  if (motion.type === 'sine') {
    const rate = motion.speed * Math.PI * 2;
    modulationTravel = Math.abs(rate) < 0.000001
      ? Math.sin(motion.phase) * elapsed
      : (Math.cos(motion.phase) - Math.cos(rate * elapsed + motion.phase)) / rate;
  } else if (motion.type === 'noise') {
    // applyMotion's deterministic pseudo-noise is a product of three waves.
    // Product-to-sum gives an exact antiderivative and keeps long exports O(1).
    const speed = motion.speed;
    const phase = motion.phase;
    modulationTravel = 0.25 * (
      integratedCos(-1.5 * speed, 0.7 * phase, elapsed)
      + integratedCos(2.9 * speed, -1.3 * phase, elapsed)
      - integratedCos(0.1 * speed, 3.3 * phase, elapsed)
      - integratedCos(4.5 * speed, 1.3 * phase, elapsed)
    );
  }
  return baseTravel + modulationTravel * motion.amplitude;
}

function resolveSkySource(source: LandscapeSkySource, t: number): LandscapeSkySource {
  return {
    ...source,
    textureScale: resolveBoundedMotion(source.textureScale, source.motionTextureScale, t, 0.35, 3),
    textureOffsetX: resolveBoundedMotion(source.textureOffsetX, source.motionTextureOffsetX, t, -2, 2),
    textureOffsetY: resolveBoundedMotion(source.textureOffsetY, source.motionTextureOffsetY, t, -2, 2),
    textureRotation: source.motionTextureRotation && source.motionTextureRotation.type !== 'none'
      ? wrapDegrees(applyMotion(source.textureRotation, source.motionTextureRotation, t))
      : source.textureRotation
  };
}

/** Resolve every continuous Landscape parameter once for both renderers. */
export function resolveLandscapeFrame(
  config: LandscapeConfig,
  skySources: LandscapeSkySource[],
  t: number
): ResolvedLandscapeFrame {
  return {
    config: {
      ...config,
      heightScale: resolveBoundedMotion(config.heightScale, config.motionHeightScale, t, 0, 3200),
      flightSpeed: resolveBoundedMotion(config.flightSpeed, config.motionFlightSpeed, t, 0, 2600),
      cameraHeight: resolveBoundedMotion(config.cameraHeight, config.motionCameraHeight, t, 120, 3200),
      cameraX: resolveBoundedMotion(config.cameraX, config.motionCameraX, t, -1800, 1800),
      lookAhead: resolveBoundedMotion(config.lookAhead, config.motionLookAhead, t, 500, 8000),
      fov: resolveBoundedMotion(config.fov, config.motionFov, t, 30, 110),
      skyCenterX: resolveBoundedMotion(config.skyCenterX, config.motionSkyCenterX, t, -540, 540),
      skyCenterY: resolveBoundedMotion(config.skyCenterY, config.motionSkyCenterY, t, -960, 960),
      skyRingWidth: resolveBoundedMotion(config.skyRingWidth, config.motionSkyRingWidth, t, 40, 420)
    },
    skySources: skySources.map(source => resolveSkySource(source, t)),
    travel: landscapeTravelDistance(config, t)
  };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash2(x: number, y: number, seed: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return (top + (bottom - top) * ty) * 2 - 1;
}

/** Deterministic height field shared by live rendering and offline export. */
export function landscapeHeight(x: number, z: number, config: LandscapeConfig): number {
  let amplitude = 1;
  let frequency = Math.max(0.000001, config.noiseScale);
  let total = 0;
  let weight = 0;
  const octaves = Math.max(1, Math.round(config.noiseOctaves));
  for (let octave = 0; octave < octaves; octave++) {
    const noise = valueNoise(x * frequency, z * frequency, config.seed + octave * 19);
    const ridged = 1 - Math.abs(noise);
    const shaped = noise * (1 - config.ridgeAmount) + (ridged * 2 - 1) * config.ridgeAmount;
    total += shaped * amplitude;
    weight += amplitude;
    amplitude *= 0.52;
    frequency *= 2.03;
  }
  let normalized = total / Math.max(weight, 0.0001);
  if (config.plateauAmount > 0) {
    const steps = 7;
    const terraced = Math.round(normalized * steps) / steps;
    normalized += (terraced - normalized) * config.plateauAmount;
  }
  return normalized * config.heightScale;
}

export function landscapeAssetIndex(
  row: number,
  column: number,
  assetCount: number,
  config: LandscapeConfig
): number {
  if (assetCount <= 0) return -1;
  if (!config.terrainShuffle) return ((row * Math.round(config.meshColumns) + column) % assetCount + assetCount) % assetCount;
  return Math.floor(hash2(column, row, config.seed + 911) * assetCount) % assetCount;
}

/**
 * Resolve the moving grid in camera space. Rows wrap one cell at a time while
 * their world-space noise coordinates keep advancing, producing an endless
 * deterministic flyover without a wall-clock-dependent simulation.
 */
export function resolveLandscapeCells(
  config: LandscapeConfig,
  t: number,
  assetCount: number,
  resolvedTravel?: number
): LandscapeCell[] {
  const columns = Math.max(2, Math.round(config.meshColumns));
  const rows = Math.max(4, Math.round(config.meshRows));
  const cellWidth = config.terrainWidth / columns;
  const cellDepth = config.terrainDepth / rows;
  const travel = resolvedTravel ?? Math.max(0, t) * config.flightSpeed;
  const rowAdvance = Math.floor(travel / cellDepth);
  const rowOffset = travel - rowAdvance * cellDepth;
  const nearZ = 820;
  const points: LandscapePoint[][] = [];

  for (let row = 0; row <= rows; row++) {
    const globalRow = rowAdvance + row;
    const z = nearZ - row * cellDepth + rowOffset;
    const worldZ = -globalRow * cellDepth;
    const pointRow: LandscapePoint[] = [];
    for (let column = 0; column <= columns; column++) {
      const x = -config.terrainWidth / 2 + column * cellWidth;
      pointRow.push({ x, y: landscapeHeight(x, worldZ, config), z });
    }
    points.push(pointRow);
  }

  const cells: LandscapeCell[] = [];
  for (let row = 0; row < rows; row++) {
    const globalRow = rowAdvance + row;
    for (let column = 0; column < columns; column++) {
      cells.push({
        row: globalRow,
        column,
        assetIndex: landscapeAssetIndex(globalRow, column, assetCount, config),
        corners: [
          points[row][column],
          points[row][column + 1],
          points[row + 1][column + 1],
          points[row + 1][column]
        ]
      });
    }
  }
  return cells;
}
