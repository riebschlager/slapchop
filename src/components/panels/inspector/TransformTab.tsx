import Slider from '../../controls/Slider';
import { Layer } from '../../../types';

// Symmetry-mode layer transform controls. Mode composition lives in
// SymmetryModeInspector; this leaf stays focused on the two transform fields.
export default function TransformTab({ layer, onChange }: { layer: Layer; onChange: (updates: Partial<Layer>) => void }) {
  return (
    <div className="space-y-3">
      <Slider
        label="Scale"
        display={layer.scaleX.toFixed(2)}
        value={Math.abs(layer.scaleX)}
        min={0.1} max={5} step={0.05}
        onChange={(s) => onChange({
          scaleX: Math.sign(layer.scaleX) * s || s,
          scaleY: Math.sign(layer.scaleY) * s || s
        })}
      />
      <Slider
        label="Rotation"
        display={`${Math.round(layer.rotation)}°`}
        value={layer.rotation}
        min={-180} max={180} step={1}
        onChange={(rotation) => onChange({ rotation })}
      />
    </div>
  );
}
