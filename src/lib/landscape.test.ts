import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDSCAPE } from '../types';
import { applyMotion } from './motion';
import {
  landscapeAssetIndex,
  landscapeHeight,
  landscapeSkyAssetIndex,
  landscapeTravelDistance,
  resolveLandscapeCells,
  resolveLandscapeFrame
} from './landscape';

describe('GIF Landscape procedural scene', () => {
  it('resolves identical terrain for an identical document time', () => {
    const first = resolveLandscapeCells(DEFAULT_LANDSCAPE, 1.25, 7);
    expect(first).toEqual(resolveLandscapeCells(DEFAULT_LANDSCAPE, 1.25, 7));
    expect(first).toHaveLength(DEFAULT_LANDSCAPE.meshColumns * DEFAULT_LANDSCAPE.meshRows);
  });

  it('advances terrain rows without repeating the sampled height field', () => {
    const cellDepth = DEFAULT_LANDSCAPE.terrainDepth / DEFAULT_LANDSCAPE.meshRows;
    const later = resolveLandscapeCells(DEFAULT_LANDSCAPE, cellDepth / DEFAULT_LANDSCAPE.flightSpeed, 4);
    const initial = resolveLandscapeCells(DEFAULT_LANDSCAPE, 0, 4);
    expect(later[0].row).toBe(initial[0].row + 1);
    expect(later[0].corners[0].y).not.toBe(initial[0].corners[0].y);
  });

  it('uses ridge and plateau shaping deterministically', () => {
    const smooth = landscapeHeight(330, -1200, { ...DEFAULT_LANDSCAPE, ridgeAmount: 0, plateauAmount: 0 });
    const shaped = landscapeHeight(330, -1200, { ...DEFAULT_LANDSCAPE, ridgeAmount: 1, plateauAmount: 1 });
    expect(shaped).not.toBe(smooth);
    expect(shaped).toBe(landscapeHeight(330, -1200, { ...DEFAULT_LANDSCAPE, ridgeAmount: 1, plateauAmount: 1 }));
  });

  it('can preserve order or use a seeded shuffle for GIF assignment', () => {
    const ordered = { ...DEFAULT_LANDSCAPE, terrainShuffle: false, meshColumns: 4 };
    expect(landscapeAssetIndex(0, 0, 3, ordered)).toBe(0);
    expect(landscapeAssetIndex(0, 1, 3, ordered)).toBe(1);
    expect(landscapeAssetIndex(2, 3, 3, ordered)).toBe(2);
    expect(landscapeAssetIndex(8, 4, 5, DEFAULT_LANDSCAPE)).toBe(
      landscapeAssetIndex(8, 4, 5, DEFAULT_LANDSCAPE)
    );
  });

  it('assigns one GIF to each sky ring and advances within its source folder', () => {
    expect(landscapeSkyAssetIndex(0, 2, 3)).toBe(0);
    expect(landscapeSkyAssetIndex(1, 2, 4)).toBe(0);
    expect(landscapeSkyAssetIndex(2, 2, 3)).toBe(1);
    expect(landscapeSkyAssetIndex(4, 2, 3)).toBe(2);
    expect(landscapeSkyAssetIndex(6, 2, 3)).toBe(0);
    expect(landscapeSkyAssetIndex(0, 0, 3)).toBe(-1);
    expect(landscapeSkyAssetIndex(0, 2, 0)).toBe(-1);
  });

  it('resolves continuous terrain, camera, and sky motion with safe bounds', () => {
    const frame = resolveLandscapeFrame({
      ...DEFAULT_LANDSCAPE,
      motionHeightScale: { type: 'sine', speed: 1, amplitude: 4000, phase: 0 },
      motionCameraX: { type: 'sine', speed: 1, amplitude: 3000, phase: 0 },
      motionFov: { type: 'sine', speed: 1, amplitude: 100, phase: Math.PI },
      motionSkyRingWidth: { type: 'sine', speed: 1, amplitude: 400, phase: 0 }
    }, [], 0.25);

    expect(frame.config.heightScale).toBe(3200);
    expect(frame.config.cameraX).toBe(1800);
    expect(frame.config.fov).toBe(30);
    expect(frame.config.skyRingWidth).toBe(420);
  });

  it('preserves unmodulated document values without reinterpretation', () => {
    const config = { ...DEFAULT_LANDSCAPE, cameraX: 2400, fov: 120 };
    const source = {
      id: 'sky-static',
      name: 'Static sky',
      assets: [],
      textureScale: 4,
      textureOffsetX: 3,
      textureOffsetY: -3,
      textureRotation: 540,
      gifSpeed: 1
    };
    const frame = resolveLandscapeFrame(config, [source], 2);

    expect(frame.config.cameraX).toBe(2400);
    expect(frame.config.fov).toBe(120);
    expect(frame.skySources[0]).toMatchObject({
      textureScale: 4,
      textureOffsetX: 3,
      textureOffsetY: -3,
      textureRotation: 540
    });
  });

  it('resolves each sky folder motion independently', () => {
    const source = {
      id: 'sky-1',
      name: 'Sky',
      assets: [],
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureRotation: 170,
      gifSpeed: 1,
      motionTextureScale: { type: 'sine' as const, speed: 1, amplitude: 0.5, phase: 0 },
      motionTextureRotation: { type: 'sine' as const, speed: 1, amplitude: 30, phase: 0 }
    };
    const frame = resolveLandscapeFrame(DEFAULT_LANDSCAPE, [source], 0.25);

    expect(frame.skySources[0].textureScale).toBeCloseTo(1.5);
    expect(frame.skySources[0].textureRotation).toBe(-160);
    expect(source.textureScale).toBe(1);
    expect(source.textureRotation).toBe(170);
  });

  it('integrates speed modulation into continuous deterministic travel', () => {
    const sineConfig = {
      ...DEFAULT_LANDSCAPE,
      motionFlightSpeed: { type: 'sine' as const, speed: 1, amplitude: 200, phase: 0 }
    };
    expect(landscapeTravelDistance(sineConfig, 0)).toBe(0);
    expect(landscapeTravelDistance(sineConfig, 1)).toBeCloseTo(DEFAULT_LANDSCAPE.flightSpeed);
    expect(landscapeTravelDistance(sineConfig, 0.5)).toBeCloseTo(
      DEFAULT_LANDSCAPE.flightSpeed * 0.5 + 200 / Math.PI
    );

    const noiseConfig = {
      ...DEFAULT_LANDSCAPE,
      motionFlightSpeed: { type: 'noise' as const, speed: 0.7, amplitude: 300, phase: 0.4 }
    };
    const t = 1.3;
    const delta = 0.00001;
    const derivative = (
      landscapeTravelDistance(noiseConfig, t + delta)
      - landscapeTravelDistance(noiseConfig, t - delta)
    ) / (delta * 2);
    expect(derivative).toBeCloseTo(
      applyMotion(noiseConfig.flightSpeed, noiseConfig.motionFlightSpeed, t),
      3
    );
  });
});
