import { LandscapeConfig } from '../types';

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
  assetCount: number
): LandscapeCell[] {
  const columns = Math.max(2, Math.round(config.meshColumns));
  const rows = Math.max(4, Math.round(config.meshRows));
  const cellWidth = config.terrainWidth / columns;
  const cellDepth = config.terrainDepth / rows;
  const travel = Math.max(0, t) * config.flightSpeed;
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
