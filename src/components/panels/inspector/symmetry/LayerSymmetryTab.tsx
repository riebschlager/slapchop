import SymmetryEditor from '../../../controls/SymmetryEditor';
import { Layer } from '../../../../types';
import { getSymmetryModeOptions } from './options';

export default function LayerSymmetryTab({ layer, onChange }: { layer: Layer; onChange: (updates: Partial<Layer>) => void }) {
  return (
    <div className="space-y-3">
      {layer.symmetry === 'voronoi' && (
        <div className="rounded border border-amber-800/70 bg-amber-950/30 p-2 text-[11px] leading-relaxed text-amber-200">
          This layer uses the legacy Voronoi effect. It remains renderable and saved, but new Voronoi work belongs in Polygon mode. Choosing another symmetry replaces it.
        </div>
      )}
      <SymmetryEditor
        symmetry={layer.symmetry}
        radialSegments={layer.radialSegments}
        symmetryParams={layer.symmetryParams}
        options={getSymmetryModeOptions(layer.symmetry)}
        selectLabel="Layer Symmetry"
        originHint="Drag the amber origin handle on canvas to re-center this symmetry."
        onChange={onChange}
      />
    </div>
  );
}
