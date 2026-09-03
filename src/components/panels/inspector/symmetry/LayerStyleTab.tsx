import { Film } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { formatRate } from '../../../../lib/sliderScale';
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
        className="pt-2 border-t border-ui-border"
        value={layer.blendMode}
        options={BLEND_MODES}
        onChange={(blendMode) => onChange({ blendMode })}
      />

      {layer.gifData && (
        <div className="pt-2 border-t border-ui-border space-y-2">
          <Slider
            label={<><Film className="w-3.5 h-3.5" /> GIF Speed</>}
            headerClassName="mb-2"
            labelClassName="font-semibold text-ui-text flex items-center gap-1"
            displayClassName="text-ui-text"
            display={`${formatRate(layer.gifSpeed ?? 1)}x`}
            value={layer.gifSpeed ?? 1}
            min={0} max={5} step={0.001}
            scale="log" minPositive={0.001}
            onChange={(gifSpeed) => onChange({ gifSpeed })}
          />
          <div className="grid grid-cols-5 gap-1 pt-1">
            {GIF_SPEED_PRESETS.map((speed) => (
              <button
                key={speed}
                onClick={() => onChange({ gifSpeed: speed })}
                className={cn(
                  'py-1 text-[10px] rounded font-mono transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel',
                  (layer.gifSpeed ?? 1) === speed
                    ? 'bg-ui-accent text-ui-accent-contrast border-ui-accent-strong font-bold'
                    : 'bg-ui-canvas text-ui-text-muted border-ui-border hover:border-ui-border-strong hover:text-ui-text'
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
