import TextureTilingControl from '../../controls/TextureTilingControl';
import { cn } from '../../../lib/utils';
import { formatRate } from '../../../lib/sliderScale';
import Slider from '../../controls/Slider';
import { Film, Shuffle } from 'lucide-react';
import { useStore } from '../../../store';
import { PolygonLayer, PolygonTextureFolder } from '../../../types';

const TEXTURE_SCALE_PRESETS = [0.25, 0.5, 1.0, 2.0, 4.0];
const GIF_SPEED_PRESETS = [0.25, 0.5, 1.0, 2.0, 3.0];

// Polygon-mode texture controls. A polygon's geometry is edited on canvas via
// its points, so this tab owns only its fill texture transform and playback.
export default function TextureTab({ polygon, onChange }: { polygon: PolygonLayer; onChange: (updates: Partial<PolygonLayer>) => void }) {
  const textureFolder = useStore(s => s.polygonTextureFolder);
  return (
    <div className="space-y-3">
      {textureFolder && <FolderTexturePicker folder={textureFolder} polygon={polygon} onChange={onChange} />}
      <TextureTilingControl value={polygon.textureTiling} onChange={textureTiling => onChange({ textureTiling })} />
      <div>
        <Slider
          label="Texture Scale"
          labelClassName="font-semibold text-ui-text"
          displayClassName="text-ui-text font-bold"
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
                "py-1 text-[10px] rounded font-mono border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel",
                polygon.textureScale === sVal
                  ? "bg-ui-accent text-ui-accent-contrast border-ui-accent-strong font-bold"
                  : "bg-ui-canvas text-ui-text-muted border-ui-border hover:border-ui-border-strong hover:text-ui-text"
              )}
            >
              {sVal}x
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-ui-border">
        <Slider
          label={<><Film className="w-3.5 h-3.5" /> Animated GIF Speed</>}
          labelClassName="text-ui-text flex items-center gap-1"
          displayClassName="text-ui-text"
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
                "py-1 text-[10px] rounded font-mono border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-1 focus-visible:ring-offset-ui-panel",
                (polygon.gifSpeed ?? 1) === spd
                  ? "bg-ui-accent text-ui-accent-contrast border-ui-accent-strong font-bold"
                  : "bg-ui-canvas text-ui-text-muted border-ui-border hover:border-ui-border-strong hover:text-ui-text"
              )}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Texture Rotation"
        className="pt-2 border-t border-ui-border"
        display={`${Math.round(polygon.textureRotation)}°`}
        value={polygon.textureRotation}
        min={0} max={360} step={1}
        onChange={(textureRotation) => onChange({ textureRotation })}
      />

      <div className="pt-2 border-t border-ui-border grid grid-cols-2 gap-2">
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

// Swaps this shape's texture for another from the loaded folder. The pick is a
// plain src/gifData update, so it undoes like any other texture change.
function FolderTexturePicker({ folder, polygon, onChange }: {
  folder: PolygonTextureFolder;
  polygon: PolygonLayer;
  onChange: (updates: Partial<PolygonLayer>) => void;
}) {
  const onShuffle = useStore(s => s.shufflePolygonTexture);
  return (
    <div className="pb-2 border-b border-ui-border space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ui-text truncate" title={folder.name}>From {folder.name}</span>
        <button
          type="button"
          onClick={() => onShuffle(polygon.id)}
          disabled={folder.assets.length < 2 && polygon.src === folder.assets[0]?.src}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-ui-border bg-ui-canvas text-ui-text-muted hover:text-ui-text hover:border-ui-border-strong disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent"
          title="Pick a different random texture from the folder"
        >
          <Shuffle className="w-3 h-3" /> Shuffle
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1 max-h-32 overflow-y-auto">
        {folder.assets.map(asset => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onChange({ src: asset.src, gifData: asset.gifData })}
            aria-pressed={polygon.src === asset.src}
            title={asset.name}
            className={cn(
              "aspect-square rounded overflow-hidden border bg-ui-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent",
              polygon.src === asset.src ? "border-ui-accent ring-1 ring-ui-accent" : "border-ui-border hover:border-ui-border-strong"
            )}
          >
            <img src={asset.src} alt={asset.name} loading="lazy" draggable={false} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
