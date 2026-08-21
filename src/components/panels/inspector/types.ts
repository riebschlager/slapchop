import { Layer, PolygonLayer } from '../../../types';

// One tab component (Style/Symmetry/Motion) serves both Symmetry-layer and
// Polygon-tile selections instead of duplicating near-identical JSX per
// mode. `onChange` stays typed to the subject's own shape rather than a
// lowest-common-denominator object, so each tab still gets full field
// checking for the fields unique to its kind.
//
// 3D mode's Mesh3dLayer selection deliberately isn't a third member here:
// its fields don't line up with the 2D ones Style/Symmetry/Motion were
// built for, so it gets its own dedicated tab set in InspectorPanel instead
// of forcing those three shared tabs to branch a third way.
export type InspectorSubject =
  | { kind: 'layer'; layer: Layer; onChange: (updates: Partial<Layer>) => void }
  | { kind: 'polygon'; polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void };
