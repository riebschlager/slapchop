import SymmetryEditor from '../../../controls/SymmetryEditor';
import { PolygonLayer } from '../../../../types';
import { POLYGON_PATTERN_OPTIONS } from './options';

export default function PolygonPatternTab({ polygon, onChange }: { polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void }) {
  const pattern = polygon.symmetry ?? 'none';
  return (
    <div className="space-y-3">
      {pattern === 'voronoi' && (
        <div className="text-[11px] leading-relaxed text-gray-500">
          Voronoi partitions this polygon into deterministic texture shards. It is a Polygon-mode effect, not a layer symmetry.
        </div>
      )}
      <SymmetryEditor
        symmetry={pattern}
        radialSegments={polygon.radialSegments ?? 6}
        symmetryParams={polygon.symmetryParams}
        options={POLYGON_PATTERN_OPTIONS}
        selectLabel="Polygon Pattern"
        originHint="Drag the amber origin handle on canvas to re-center this pattern."
        onChange={onChange}
      />
    </div>
  );
}
