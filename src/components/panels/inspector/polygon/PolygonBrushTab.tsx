import { PolygonBrush, PolygonLayer } from '../../../../types';
import MotionControl from '../../../controls/MotionControl';
import Slider from '../../../controls/Slider';
import BrushSettingsFields from './BrushSettingsFields';

export default function PolygonBrushTab({ brush, onChange }: { brush: PolygonBrush; onChange: (updates: Partial<PolygonLayer>) => void }) {
  const update = (updates: Partial<PolygonBrush>) => onChange({ brush: { ...brush, ...updates } });
  return (
    <div className="space-y-3 pb-1">
      <BrushSettingsFields value={brush} onChange={update} />
      <button
        type="button"
        onClick={() => update({ seed: (brush.seed + 1) % 100000 })}
        className="w-full py-1 rounded border border-ui-border bg-ui-surface hover:bg-ui-surface-raised text-[11px] text-ui-text-muted disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
        disabled={brush.roughness === 0}
        title={brush.roughness === 0 ? 'Raise Roughness to vary the edge' : 'Pick a new roughness pattern'}
      >
        Reseed Roughness
      </button>
      <div className="pt-2 border-t border-ui-border space-y-2">
        <MotionControl label="Size Breathing" config={brush.motionSize} onChange={(motionSize) => update({ motionSize })} maxAmplitude={200} stepAmplitude={1} />
        <Slider
          label="Draw-On Time"
          display={brush.drawOnDuration > 0 ? `${brush.drawOnDuration.toFixed(1)}s` : 'Off'}
          value={brush.drawOnDuration}
          min={0} max={10} step={0.1}
          onChange={(drawOnDuration) => update({ drawOnDuration })}
        />
        {brush.drawOnDuration > 0 && (
          <Slider
            size="sm"
            label="Hold Before Repeat"
            display={`${brush.drawOnHold.toFixed(1)}s`}
            value={brush.drawOnHold}
            min={0} max={10} step={0.1}
            onChange={(drawOnHold) => update({ drawOnHold })}
          />
        )}
      </div>
    </div>
  );
}
