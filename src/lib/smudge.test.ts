import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_FX, MasterFxConfig } from '../types';
import {
  applySmudgePixels,
  hashCell,
  quantizeSmudge,
  resolveSmudgeParams,
  smudgeVector
} from './smudge';

const fx = (overrides: Partial<MasterFxConfig> = {}): MasterFxConfig => ({
  ...DEFAULT_MASTER_FX,
  enabled: true,
  smudgeEnabled: true,
  ...overrides
});

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7) & 255;
      data[i + 1] = (y * 5) & 255;
      data[i + 2] = (x * y) & 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('hashCell', () => {
  it('is deterministic and stays within [0, 1)', () => {
    for (let i = -20; i < 20; i++) {
      const h = hashCell(i, i * 3, 7, 4);
      expect(h).toBe(hashCell(i, i * 3, 7, 4));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(hashCell(1, 2, 3, 4)).not.toBe(hashCell(2, 1, 3, 4));
  });
});

describe('quantizeSmudge', () => {
  it('snaps to 2^(bits-1) levels per side and keeps zero', () => {
    expect(quantizeSmudge(0.3, 1)).toBe(0);
    expect(quantizeSmudge(0.6, 1)).toBe(1);
    expect(quantizeSmudge(-0.6, 1)).toBe(-1);
    expect(quantizeSmudge(0.3, 4)).toBe(0.25);
    expect(quantizeSmudge(0, 128)).toBe(0);
  });
});

describe('smudgeVector', () => {
  it('holds one vector per cell in blocky mode', () => {
    const p = resolveSmudgeParams(fx({ smudgeSoftness: 0, smudgeCellSize: 40, smudgeBitDepth: 8 }), 1.3, 1080);
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 0];
    smudgeVector(40.5, 80.5, p, a);
    smudgeVector(79.5, 119.5, p, b);
    expect(b).toEqual(a);
  });

  it('scales cell boundaries and amount with output width', () => {
    const config = fx({ smudgeSoftness: 0, smudgeCellSize: 40 });
    const small = resolveSmudgeParams(config, 2, 540);
    const large = resolveSmudgeParams(config, 2, 1080);
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 0];
    smudgeVector(30.5, 50.5, small, a);
    smudgeVector(61, 101, large, b);
    expect(b[0]).toBeCloseTo(a[0] * 2);
    expect(b[1]).toBeCloseTo(a[1] * 2);
  });

  it('aligns every vector with the flow direction at full flow', () => {
    const p = resolveSmudgeParams(fx({ smudgeFlow: 1, smudgeAngle: 0, smudgeBitDepth: 8 }), 0.5, 1080);
    const v: [number, number] = [0, 0];
    for (let i = 0; i < 20; i++) {
      smudgeVector(i * 37.5, i * 91.5, p, v);
      expect(v[1]).toBeCloseTo(0);
      expect(v[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('holds the field between stutter ticks', () => {
    const config = fx({ smudgeStutter: 4, smudgeSpeed: 1 });
    expect(resolveSmudgeParams(config, 1.26, 1080)).toEqual(resolveSmudgeParams(config, 1.49, 1080));
    expect(resolveSmudgeParams(config, 1.26, 1080)).not.toEqual(resolveSmudgeParams(config, 1.51, 1080));
  });
});

describe('applySmudgePixels', () => {
  const width = 48;
  const height = 64;

  it('leaves pixels untouched at zero amount or zero coverage', () => {
    for (const overrides of [{ smudgeAmount: 0 }, { smudgeCoverage: 0 }]) {
      const data = gradient(width, height);
      applySmudgePixels(data, width, height, resolveSmudgeParams(fx(overrides), 1, width));
      expect(data).toEqual(gradient(width, height));
    }
  });

  it('is a deterministic function of time', () => {
    const config = fx({ smudgeAmount: 400, smudgeCellSize: 200, smudgeSmear: 3 });
    const a = gradient(width, height);
    const b = gradient(width, height);
    applySmudgePixels(a, width, height, resolveSmudgeParams(config, 2.5, width));
    applySmudgePixels(b, width, height, resolveSmudgeParams(config, 2.5, width));
    expect(a).toEqual(b);
    expect(a).not.toEqual(gradient(width, height));
  });
});
