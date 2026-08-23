import { SelectOption } from '../../../controls/Select';
import { SymmetryType } from '../../../../types';

export const SYMMETRY_MODE_OPTIONS: readonly SelectOption<SymmetryType>[] = [
  { value: 'none', label: 'None' },
  { value: 'mirror-x', label: 'Horizontal Mirror' },
  { value: 'mirror-y', label: 'Vertical Mirror' },
  { value: 'quad', label: 'Quadrant' },
  { value: 'radial', label: 'Radial (Kaleidoscope)' },
  { value: 'spiral', label: 'Spiral (Droste)' },
  { value: 'wallpaper', label: 'Wallpaper Tiling' },
  { value: 'poincare', label: 'Poincaré Disk' }
];

const LEGACY_VORONOI_OPTION: SelectOption<SymmetryType> = {
  value: 'voronoi',
  label: 'Voronoi Shards (Legacy)',
  disabled: true
};

export function getSymmetryModeOptions(current: SymmetryType): readonly SelectOption<SymmetryType>[] {
  return current === 'voronoi'
    ? [LEGACY_VORONOI_OPTION, ...SYMMETRY_MODE_OPTIONS]
    : SYMMETRY_MODE_OPTIONS;
}
