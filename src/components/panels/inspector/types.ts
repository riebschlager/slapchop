import { Layer, PolygonLayer } from '../../../types';

// One tab component (Style/Symmetry/Motion) serves both Symmetry-layer and
// Polygon-tile selections instead of duplicating near-identical JSX per
// mode. `onChange` stays typed to the subject's own shape rather than a
// lowest-common-denominator object, so each tab still gets full field
// checking for the fields unique to its kind.
export type InspectorSubject =
  | { kind: 'layer'; layer: Layer; onChange: (updates: Partial<Layer>) => void }
  | { kind: 'polygon'; polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void };
