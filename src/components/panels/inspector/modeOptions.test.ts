import { describe, expect, it } from 'vitest';
import { POLYGON_PATTERN_OPTIONS } from './polygon/options';
import { getSymmetryModeOptions, SYMMETRY_MODE_OPTIONS } from './symmetry/options';

describe('mode-owned pattern choices', () => {
  it('offers Voronoi only as a Polygon-mode pattern', () => {
    expect(SYMMETRY_MODE_OPTIONS.map(option => option.value)).not.toContain('voronoi');
    expect(POLYGON_PATTERN_OPTIONS).toContainEqual({ value: 'voronoi', label: 'Voronoi Partition' });
  });

  it('keeps an active legacy layer value visible but unavailable for new selection', () => {
    const options = getSymmetryModeOptions('voronoi');
    expect(options[0]).toMatchObject({ value: 'voronoi', disabled: true });
    expect(getSymmetryModeOptions('radial')).toBe(SYMMETRY_MODE_OPTIONS);
  });
});
