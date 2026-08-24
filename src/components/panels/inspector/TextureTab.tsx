import { cn } from '../../../lib/utils';
import { formatRate } from '../../../lib/sliderScale';
import Slider from '../../controls/Slider';
import { Film } from 'lucide-react';
import { PolygonLayer } from '../../../types';

const TEXTURE_SCALE_PRESETS = [0.25, 0.5, 1.0, 2.0, 4.0];
const GIF_SPEED_PRESETS = [0.25, 0.5, 1.0, 2.0, 3.0];

// Polygon-mode texture controls. A polygon's geometry is edited on canvas via
// its points, so this tab owns only its fill texture transform and playback.
export default function TextureTab({ polygon, onChange }: { polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Slider
          label="Texture Scale"
          labelClassName="font-semibold text-indigo-300"
          displayClassName="text-indigo-400 font-bold"
          display={`${polygon.textureScale.toFixed(2)}x`}
          trackClassName="h-1.5"
          value={polygon.textureScale}
          min={0.05} max={5.0} step={0.05}
          onChange={(textureScale) => onChange({ textureScale })}
        />
        <div className="grid grid-cols-5 gap-1 mt-1.5">
          {TEXTURE_SCALE_PRESETS.map((sVal) => (
            <button
              key={sVal}
              onClick={() => onChange({ textureScale: sVal })}
              className={cn(
                "py-1 text-[10px] rounded font-mono border transition-colors",
                polygon.textureScale === sVal
                  ? "bg-indigo-600 text-white border-indigo-400 font-bold"
                  : "bg-gray-950 text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200"
              )}
            >
              {sVal}x
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-gray-800">
        <Slider
          label={<><Film className="w-3.5 h-3.5 text-indigo-400" /> Animated GIF Speed</>}
          labelClassName="text-gray-300 flex items-center gap-1"
          displayClassName="text-gray-300"
          display={`${formatRate(polygon.gifSpeed ?? 1)}x`}
          value={polygon.gifSpeed ?? 1}
          min={0} max={5} step={0.001}
          scale="log" minPositive={0.001}
          onChange={(gifSpeed) => onChange({ gifSpeed })}
        />
        <div className="grid grid-cols-5 gap-1 mt-1">
          {GIF_SPEED_PRESETS.map((spd) => (
            <button
              key={spd}
              onClick={() => onChange({ gifSpeed: spd })}
              className={cn(
                "py-1 text-[10px] rounded font-mono border transition-colors",
                (polygon.gifSpeed ?? 1) === spd
                  ? "bg-indigo-600 text-white border-indigo-400 font-bold"
                  : "bg-gray-950 text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200"
              )}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Texture Rotation"
        className="pt-2 border-t border-gray-800"
        display={`${Math.round(polygon.textureRotation)}°`}
        value={polygon.textureRotation}
        min={0} max={360} step={1}
        onChange={(textureRotation) => onChange({ textureRotation })}
      />

      <div className="pt-2 border-t border-gray-800 grid grid-cols-2 gap-2">
        <Slider
          size="sm"
          label="Offset X"
          display={`${Math.round(polygon.textureOffsetX)}px`}
          value={polygon.textureOffsetX}
          min={-500} max={500} step={5}
          onChange={(textureOffsetX) => onChange({ textureOffsetX })}
        />
        <Slider
          size="sm"
          label="Offset Y"
          display={`${Math.round(polygon.textureOffsetY)}px`}
          value={polygon.textureOffsetY}
          min={-500} max={500} step={5}
          onChange={(textureOffsetY) => onChange({ textureOffsetY })}
        />
      </div>
    </div>
  );
}
