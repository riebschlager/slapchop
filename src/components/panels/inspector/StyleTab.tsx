import { cn } from '../../../lib/utils';
import { BLEND_MODES } from '../../../lib/blendModes';
import { BlendMode } from '../../../types';
import Select from '../../controls/Select';
import Slider from '../../controls/Slider';
import { Film } from 'lucide-react';
import { InspectorSubject } from './types';

const GIF_SPEED_PRESETS = [0.25, 0.5, 1.0, 2.0, 3.0];

// Shared across both selection kinds: Opacity and Blend Mode are identical
// fields on Layer and PolygonLayer, so this is the tab where "one component
// serves both" pays off most directly. Everything past the shared pair
// branches, since a layer's GIF speed and a polygon's stroke/fill fallback
// don't have equivalents on the other kind.
export default function StyleTab({ subject }: { subject: InspectorSubject }) {
  const opacity = subject.kind === 'layer' ? subject.layer.opacity : subject.polygon.opacity;
  const blendMode = subject.kind === 'layer' ? subject.layer.blendMode : subject.polygon.blendMode;

  // Opacity/blendMode are the same field name and type on both Layer and
  // PolygonLayer, so a single narrowed call covers either branch.
  const apply = (updates: { opacity?: number; blendMode?: BlendMode }) => {
    if (subject.kind === 'layer') subject.onChange(updates);
    else subject.onChange(updates);
  };

  return (
    <div className="space-y-3">
      <Slider
        label="Opacity"
        display={`${Math.round(opacity * 100)}%`}
        value={opacity}
        min={0} max={1} step={0.01}
        onChange={(opacity) => apply({ opacity })}
      />
      <Select
        label="Blend Mode"
        className="pt-2 border-t border-gray-800"
        value={blendMode}
        options={BLEND_MODES}
        onChange={(blendMode) => apply({ blendMode })}
      />

      {subject.kind === 'layer' && subject.layer.gifData && (
        <div className="pt-2 border-t border-gray-800 space-y-2">
          <Slider
            label={<><Film className="w-3.5 h-3.5" /> GIF Speed</>}
            headerClassName="mb-2"
            labelClassName="font-semibold text-indigo-400 flex items-center gap-1"
            displayClassName="text-gray-300"
            display={`${(subject.layer.gifSpeed ?? 1).toFixed(2)}x`}
            value={subject.layer.gifSpeed ?? 1}
            min={0} max={5} step={0.1}
            onChange={(gifSpeed) => subject.onChange({ gifSpeed })}
          />
          <div className="grid grid-cols-5 gap-1 pt-1">
            {GIF_SPEED_PRESETS.map((spd) => (
              <button
                key={spd}
                onClick={() => subject.onChange({ gifSpeed: spd })}
                className={cn(
                  "py-1 text-[10px] rounded font-mono transition-colors border",
                  (subject.layer.gifSpeed ?? 1) === spd
                    ? "bg-indigo-600 text-white border-indigo-500 font-bold"
                    : "bg-gray-950 text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200"
                )}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      )}

      {subject.kind === 'polygon' && (
        <>
          <div className="pt-2 border-t border-gray-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-gray-400">Stroke Border</label>
              <input
                type="color"
                value={subject.polygon.strokeColor === 'transparent' ? '#ffffff' : subject.polygon.strokeColor}
                onChange={(e) => subject.onChange({ strokeColor: e.target.value })}
                className="w-6 h-5 rounded cursor-pointer border-0 bg-gray-800 p-0"
              />
            </div>

            <Slider
              label="Border Width"
              display={`${subject.polygon.strokeWidth}px`}
              value={subject.polygon.strokeWidth}
              min={0} max={20} step={1}
              onChange={(strokeWidth) => subject.onChange({ strokeWidth })}
            />
          </div>

          <div className="pt-2 border-t border-gray-800 flex items-center justify-between">
            <label className="text-[11px] text-gray-400">Fallback Fill Color</label>
            <input
              type="color"
              value={subject.polygon.fillColor || '#6366f1'}
              onChange={(e) => subject.onChange({ fillColor: e.target.value })}
              className="w-6 h-5 rounded cursor-pointer border-0 bg-gray-800 p-0"
            />
          </div>
        </>
      )}
    </div>
  );
}
