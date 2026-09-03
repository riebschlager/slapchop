import { BLEND_MODES } from '../../../../lib/blendModes';
import { PolygonLayer } from '../../../../types';
import Select from '../../../controls/Select';
import Slider from '../../../controls/Slider';

export default function PolygonStyleTab({ polygon, onChange }: { polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void }) {
  return (
    <div className="space-y-3">
      <Slider
        label="Opacity"
        display={`${Math.round(polygon.opacity * 100)}%`}
        value={polygon.opacity}
        min={0} max={1} step={0.01}
        onChange={(opacity) => onChange({ opacity })}
      />
      <Select
        label="Blend Mode"
        className="pt-2 border-t border-ui-border"
        value={polygon.blendMode}
        options={BLEND_MODES}
        onChange={(blendMode) => onChange({ blendMode })}
      />
      <div className="pt-2 border-t border-ui-border space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-ui-text-muted">Stroke Border</label>
          <input
            type="color"
            value={polygon.strokeColor === 'transparent' ? '#ffffff' : polygon.strokeColor}
            onChange={(e) => onChange({ strokeColor: e.target.value })}
            className="w-6 h-5 rounded cursor-pointer border-0 bg-ui-surface p-0"
          />
        </div>
        <Slider
          label="Border Width"
          display={`${polygon.strokeWidth}px`}
          value={polygon.strokeWidth}
          min={0} max={20} step={1}
          onChange={(strokeWidth) => onChange({ strokeWidth })}
        />
      </div>
      <div className="pt-2 border-t border-ui-border flex items-center justify-between">
        <label className="text-[11px] text-ui-text-muted">Fallback Fill Color</label>
        <input
          type="color"
          value={polygon.fillColor || '#6366f1'}
          onChange={(e) => onChange({ fillColor: e.target.value })}
          className="w-6 h-5 rounded cursor-pointer border-0 bg-ui-surface p-0"
        />
      </div>
    </div>
  );
}
