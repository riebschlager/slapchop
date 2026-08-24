import { cn } from '../../../lib/utils';
import { formatRate } from '../../../lib/sliderScale';
import { BLEND_MODES } from '../../../lib/blendModes';
import { Mesh3dLayer, ShadingModel } from '../../../types';
import Select, { SelectOption } from '../../controls/Select';
import Slider from '../../controls/Slider';
import Toggle from '../../controls/Toggle';
import { Image as ImageIcon, Film } from 'lucide-react';

const GIF_SPEED_PRESETS = [0.25, 0.5, 1.0, 2.0, 3.0];

const SHADING_OPTIONS: SelectOption<ShadingModel>[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'flat', label: 'Flat' },
  { value: 'unlit', label: 'Unlit' },
];

// Texture & Style: material/UV fields plus the surface toggles (wireframe,
// double-sided, depth test) the plan groups under the same tab. Upload
// applies to the mesh currently selected in the Stack panel — this tab only
// renders when one is, so store.uploadMesh3dTexture's "apply to selection"
// path always lands on this mesh, same as the Polygon inspector's texture
// upload relying on the current polygon selection.
export default function Texture3dTab({ mesh, onChange, onUploadTexture }: {
  mesh: Mesh3dLayer;
  onChange: (updates: Partial<Mesh3dLayer>) => void;
  onUploadTexture: (file: File) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-center gap-2 w-full py-1.5 bg-gray-800/80 hover:bg-gray-700 rounded-md cursor-pointer transition-colors text-xs text-gray-300 border border-gray-700">
        <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
        {mesh.src ? 'Replace Texture / GIF' : 'Upload Texture / GIF'}
        <input
          type="file" accept="image/*" className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onUploadTexture(file); }}
        />
      </label>

      {!mesh.src && (
        <div className="flex items-center justify-between pb-2 border-b border-gray-800">
          <label className="text-[11px] text-gray-400">Fallback Fill Color</label>
          <input
            type="color"
            value={mesh.fillColor || '#6366f1'}
            onChange={(e) => onChange({ fillColor: e.target.value })}
            className="w-6 h-5 rounded cursor-pointer border-0 bg-gray-800 p-0"
          />
        </div>
      )}

      {mesh.gifData && (
        <div className="pb-2 border-b border-gray-800 space-y-2">
          <Slider
            label={<><Film className="w-3.5 h-3.5" /> GIF Speed</>}
            headerClassName="mb-2"
            labelClassName="font-semibold text-indigo-400 flex items-center gap-1"
            displayClassName="text-gray-300"
            display={`${formatRate(mesh.gifSpeed ?? 1)}x`}
            value={mesh.gifSpeed ?? 1}
            min={0} max={5} step={0.001}
            scale="log" minPositive={0.001}
            onChange={(gifSpeed) => onChange({ gifSpeed })}
          />
          <div className="grid grid-cols-5 gap-1">
            {GIF_SPEED_PRESETS.map((spd) => (
              <button
                key={spd}
                onClick={() => onChange({ gifSpeed: spd })}
                className={cn(
                  "py-1 text-[10px] rounded font-mono transition-colors border",
                  (mesh.gifSpeed ?? 1) === spd
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

      <div className="grid grid-cols-2 gap-2">
        <Slider size="sm" label="UV Scale" display={mesh.uvScale.toFixed(2)} value={mesh.uvScale} min={0.05} max={5} step={0.05} onChange={(uvScale) => onChange({ uvScale })} />
        <Slider size="sm" label="UV Rotation" display={`${Math.round(mesh.uvRotation)}°`} value={mesh.uvRotation} min={0} max={360} step={1} onChange={(uvRotation) => onChange({ uvRotation })} />
        <Slider size="sm" label="UV Offset X" display={mesh.uvOffsetX.toFixed(2)} value={mesh.uvOffsetX} min={-2} max={2} step={0.05} onChange={(uvOffsetX) => onChange({ uvOffsetX })} />
        <Slider size="sm" label="UV Offset Y" display={mesh.uvOffsetY.toFixed(2)} value={mesh.uvOffsetY} min={-2} max={2} step={0.05} onChange={(uvOffsetY) => onChange({ uvOffsetY })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-gray-400">Repeat UV (tile)</label>
        <Toggle checked={mesh.uvRepeat} onChange={(uvRepeat) => onChange({ uvRepeat })} title="Repeat UV" />
      </div>

      <Select
        label="Blend Mode"
        className="pt-2 border-t border-gray-800"
        value={mesh.blendMode}
        options={BLEND_MODES}
        onChange={(blendMode) => onChange({ blendMode })}
      />
      <Select
        label="Shading Model"
        value={mesh.shadingModel}
        options={SHADING_OPTIONS}
        onChange={(shadingModel) => onChange({ shadingModel })}
      />

      <div className="pt-2 border-t border-gray-800 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-gray-400">Double-Sided</label>
          <Toggle checked={mesh.doubleSided} onChange={(doubleSided) => onChange({ doubleSided })} title="Double-Sided" />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-gray-400">Depth Test</label>
          <Toggle checked={mesh.depthTest} onChange={(depthTest) => onChange({ depthTest })} title="Depth Test" />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-gray-400">Wireframe</label>
          <Toggle checked={mesh.wireframe} onChange={(wireframe) => onChange({ wireframe })} title="Wireframe" />
        </div>
        {mesh.wireframe && (
          <div className="grid grid-cols-2 gap-2 items-end">
            <Slider size="sm" label="Line Width" display={`${mesh.wireframeWidth}px`} value={mesh.wireframeWidth} min={1} max={10} step={1} onChange={(wireframeWidth) => onChange({ wireframeWidth })} />
            <div className="flex items-center justify-between pb-1.5">
              <label className="text-[10px] text-gray-400">Color</label>
              <input
                type="color"
                value={mesh.wireframeColor}
                onChange={(e) => onChange({ wireframeColor: e.target.value })}
                className="w-6 h-5 rounded cursor-pointer border-0 bg-gray-800 p-0"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
