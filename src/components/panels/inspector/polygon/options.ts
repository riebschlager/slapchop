import { SelectOption } from '../../../controls/Select';
import { SymmetryType } from '../../../../types';

// These labels belong to Polygon mode. The persisted field remains `symmetry`
// until a later project-format migration, but the UI no longer treats parity
// with the Symmetry canvas as a product requirement.
export const POLYGON_PATTERN_OPTIONS: readonly SelectOption<SymmetryType>[] = [
  { value: 'none', label: 'Single Shape' },
  { value: 'mirror-x', label: 'Horizontal Mirror' },
  { value: 'mirror-y', label: 'Vertical Mirror' },
  { value: 'quad', label: 'Quadrant Repeat' },
  { value: 'radial', label: 'Radial Repeat' },
  { value: 'spiral', label: 'Spiral Repeat' },
  { value: 'wallpaper', label: 'Wallpaper Tiling' },
  { value: 'poincare', label: 'Poincaré Repeat' },
  { value: 'voronoi', label: 'Voronoi Partition' }
];
