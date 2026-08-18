import SymmetryEditor from '../../controls/SymmetryEditor';
import { SymmetryParams, SymmetryType } from '../../../types';
import { InspectorSubject } from './types';

// Shared: symmetry field names/shapes are identical on Layer and
// PolygonLayer by design (see types.ts), which is what lets this be a
// single tab instead of the old split where Symmetry-layer mode buried its
// symmetry editor inside Transform while Polygon mode gave it a dedicated
// tab. Both modes now land on the same tab position.
export default function SymmetryTab({ subject }: { subject: InspectorSubject }) {
  const symmetry = subject.kind === 'layer' ? subject.layer.symmetry : subject.polygon.symmetry ?? 'none';
  const radialSegments = subject.kind === 'layer' ? subject.layer.radialSegments : subject.polygon.radialSegments ?? 6;
  const symmetryParams = subject.kind === 'layer' ? subject.layer.symmetryParams : subject.polygon.symmetryParams;

  const apply = (updates: { symmetry?: SymmetryType; radialSegments?: number; symmetryParams?: SymmetryParams }) => {
    if (subject.kind === 'layer') subject.onChange(updates);
    else subject.onChange(updates);
  };

  return (
    <div className="space-y-3">
      <SymmetryEditor
        symmetry={symmetry}
        radialSegments={radialSegments}
        symmetryParams={symmetryParams}
        onChange={apply}
      />
    </div>
  );
}
