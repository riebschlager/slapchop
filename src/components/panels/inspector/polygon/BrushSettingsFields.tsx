import { BrushShapeSettings } from '../../../../types';
import Slider from '../../../controls/Slider';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Stroke-shape controls shared by the brush tool (settings for the next
 * stroke) and a painted stroke's Brush tab (edits that stroke after the fact).
 */
export default function BrushSettingsFields({
  value,
  onChange,
  size = 'md'
}: {
  value: BrushShapeSettings;
  onChange: (updates: Partial<BrushShapeSettings>) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="space-y-3">
      <Slider size={size} label="Size" display={`${Math.round(value.size)}px`} value={value.size} min={1} max={400} step={1} scale="log" onChange={(v) => onChange({ size: v })} />
      <Slider size={size} label="Pressure Thinning" display={pct(value.thinning)} value={value.thinning} min={0} max={1} step={0.01} onChange={(thinning) => onChange({ thinning })} />
      <div className="grid grid-cols-2 gap-2">
        <Slider size="sm" label="Taper Start" display={pct(value.taperStart)} value={value.taperStart} min={0} max={1} step={0.01} onChange={(taperStart) => onChange({ taperStart })} />
        <Slider size="sm" label="Taper End" display={pct(value.taperEnd)} value={value.taperEnd} min={0} max={1} step={0.01} onChange={(taperEnd) => onChange({ taperEnd })} />
      </div>
      <Slider size={size} label="Roughness" display={pct(value.roughness)} value={value.roughness} min={0} max={1} step={0.01} onChange={(roughness) => onChange({ roughness })} />
      <div className="grid grid-cols-2 gap-2">
        <Slider size="sm" label="Nib Roundness" display={pct(value.nibRoundness)} value={value.nibRoundness} min={0.05} max={1} step={0.01} onChange={(nibRoundness) => onChange({ nibRoundness })} />
        {value.nibRoundness < 1 && (
          <Slider size="sm" label="Nib Angle" display={`${Math.round(value.nibAngle)}°`} value={value.nibAngle} min={-90} max={90} step={1} onChange={(nibAngle) => onChange({ nibAngle })} />
        )}
      </div>
    </div>
  );
}
