import { SymmetryType } from '../types';

// Compact labels for list-row badges, distinct from SymmetryEditor's verbose
// <select> option text (e.g. "Radial (Kaleidoscope)") — rows need something
// that fits a small pill without truncating.
const SYMMETRY_SHORT_LABELS: Record<SymmetryType, string> = {
  none: 'Single',
  'mirror-x': 'Mirror X',
  'mirror-y': 'Mirror Y',
  quad: 'Quad',
  radial: 'Radial',
  spiral: 'Spiral',
  wallpaper: 'Wallpaper',
  poincare: 'Poincaré',
  voronoi: 'Voronoi'
};

// PolygonLayer.symmetry is optional (old saved polygons predate the field),
// so this accepts undefined and defaults it to 'none' the same way the
// renderer and SymmetryEditor already do.
export function symmetryBadgeLabel(symmetry: SymmetryType | undefined): string {
  return SYMMETRY_SHORT_LABELS[symmetry ?? 'none'];
}
