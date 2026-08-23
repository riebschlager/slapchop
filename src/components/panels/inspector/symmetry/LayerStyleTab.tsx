import { Film } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { BLEND_MODES } from '../../../../lib/blendModes';
import { Layer } from '../../../../types';
import Select from '../../../controls/Select';
import Slider from '../../../controls/Slider';

const GIF_SPEED_PRESETS = [0.25, 0.5, 1.0, 2.0, 3.0];

export default function LayerStyleTab({ layer, onChange }: { layer: Layer; onChange: (updates: Partial<Layer>) => void }) {
  return (
    <div className="space-y-3">
      <Slider
        label="Opacity"
        display={`${Math.round(layer.opacity * 100)}%`}
        value={layer.opacity}
        min={0} max={1} step={0.01}
        onChange={(opacity) => onChange({ opacity })}
      />
      <Select
        label="Blend Mode"
        className="pt-2 border-t border-gray-800"
        value={layer.blendMode}
        options={BLEND_MODES}
        onChange={(blendMode) => onChange({ blendMode })}
      />

      {layer.gifData && (
        <div className="pt-2 border-t border-gray-800 space-y-2">
          <Slider
            label={<><Film className="w-3.5 h-3.5" /> GIF Speed</>}
            headerClassName="mb-2"
            labelClassName="font-semibold text-indigo-400 flex items-center gap-1"
            displayClassName="text-gray-300"
            display={`${(layer.gifSpeed ?? 1).toFixed(2)}x`}
            value={layer.gifSpeed ?? 1}
            min={0} max={5} step={0.1}
            onChange={(gifSpeed) => onChange({ gifSpeed })}
          />
          <div className="grid grid-cols-5 gap-1 pt-1">
            {GIF_SPEED_PRESETS.map((speed) => (
              <button
                key={speed}
                onClick={() => onChange({ gifSpeed: speed })}
                className={cn(
                  'py-1 text-[10px] rounded font-mono transition-colors border',
                  (layer.gifSpeed ?? 1) === speed
                    ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                    : 'bg-gray-950 text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200'
                )}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
