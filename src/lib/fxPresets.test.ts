import { describe, it, expect } from 'vitest';
import { FX_PRESETS, createCleanMasterFx } from './fxPresets';
import { DEFAULT_MASTER_FX } from '../types';
import { hexToRgb01 } from '../renderer/filters/duotoneFilter';

describe('fxPresets', () => {
  it('provides default clean master FX with enabled: false', () => {
    const clean = createCleanMasterFx();
    expect(clean.enabled).toBe(false);
    expect(clean).toEqual(DEFAULT_MASTER_FX);
  });

  it('contains valid curated presets with unique IDs', () => {
    const ids = new Set<string>();
    expect(FX_PRESETS.length).toBeGreaterThanOrEqual(5);

    for (const preset of FX_PRESETS) {
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.config.enabled).toBe(true);
    }
  });

  it('correctly converts 3-char and 6-char hex colors to normalized [0, 1] RGB', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb01('#00ff00')).toEqual([0, 1, 0]);
    expect(hexToRgb01('#0000ff')).toEqual([0, 0, 1]);

    // 3-character hex
    expect(hexToRgb01('#fff')).toEqual([1, 1, 1]);
    expect(hexToRgb01('#000')).toEqual([0, 0, 0]);
  });
});
