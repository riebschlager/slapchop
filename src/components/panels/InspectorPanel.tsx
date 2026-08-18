import { useState } from 'react';
import { Trash2, Copy, ChevronUp, ChevronDown, Eye, EyeOff, Film, Download, Video, Loader2, Radio } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store';
import { BLEND_MODES } from '../../lib/blendModes';
import MotionControl from '../controls/MotionControl';
import SymmetryEditor from '../controls/SymmetryEditor';
import Segmented, { SegmentedOption } from '../controls/Segmented';
import Select from '../controls/Select';
import Slider from '../controls/Slider';
import ExportModal from '../modals/ExportModal';
import LiveOutputModal from '../modals/LiveOutputModal';
import { ExportApi } from '../../hooks/useExport';
import { LiveOutputApi } from '../../hooks/useLiveOutput';

type LayerTab = 'transform' | 'style' | 'motion';
type PolygonTab = 'texture' | 'style' | 'symmetry' | 'motion';

const LAYER_TABS: SegmentedOption<LayerTab>[] = [
  { value: 'transform', label: 'Transform' },
  { value: 'style', label: 'Style' },
  { value: 'motion', label: 'Motion' }
];

const POLYGON_TABS: SegmentedOption<PolygonTab>[] = [
  { value: 'texture', label: 'Texture' },
  { value: 'style', label: 'Style' },
  { value: 'symmetry', label: 'Symmetry' },
  { value: 'motion', label: 'Motion' }
];

export default function InspectorPanel({ exportApi, liveOutputApi }: { exportApi: ExportApi; liveOutputApi: LiveOutputApi }) {
  const appMode = useStore(s => s.appMode);
  const layers = useStore(s => s.layers);
  const selectedLayerId = useStore(s => s.selectedLayerId);
  const onUpdateLayer = useStore(s => s.updateLayer);
  const onDeleteLayer = useStore(s => s.deleteLayer);
  const onDuplicateLayer = useStore(s => s.duplicateLayer);
  const onMoveLayerUp = useStore(s => s.moveLayerUp);
  const onMoveLayerDown = useStore(s => s.moveLayerDown);
  const polygonLayers = useStore(s => s.polygonLayers);
  const selectedPolygonId = useStore(s => s.selectedPolygonId);
  const onUpdatePolygon = useStore(s => s.updatePolygon);
  const onDeletePolygon = useStore(s => s.deletePolygon);
  const onDuplicatePolygon = useStore(s => s.duplicatePolygon);
  const onMovePolygonUp = useStore(s => s.movePolygonUp);
  const onMovePolygonDown = useStore(s => s.movePolygonDown);

  const [activeTab, setActiveTab] = useState<LayerTab>('transform');
  const [polyTab, setPolyTab] = useState<PolygonTab>('texture');

  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);

  const { liveOutputStreaming, liveOutputConnected, liveOutputBusy, showLiveOutputModal, setShowLiveOutputModal } = liveOutputApi;

  return (
    <div className="w-84 bg-gray-900 border-l border-gray-800 flex flex-col h-screen text-gray-200 shrink-0">
      <div className="flex-1 overflow-y-auto min-h-0">
        {appMode === 'symmetry' && (
          selectedLayer ? (
            <div className="p-3 flex flex-col">
              {/* Layer Header & Quick Action Bar */}
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
                <input
                  type="text"
                  value={selectedLayer.name}
                  onChange={(e) => onUpdateLayer(selectedLayer.id, { name: e.target.value })}
                  className="bg-transparent text-xs font-semibold text-gray-200 border-b border-transparent hover:border-gray-700 focus:border-indigo-500 focus:bg-gray-950 px-1 py-0.5 outline-none rounded truncate flex-1 mr-2"
                  title="Click to rename layer"
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => onUpdateLayer(selectedLayer.id, { hidden: !selectedLayer.hidden })}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title={selectedLayer.hidden ? "Show Layer" : "Hide Layer"}
                  >
                    {selectedLayer.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => onDuplicateLayer(selectedLayer.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title="Duplicate Layer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMoveLayerUp(selectedLayer.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title="Move Up in Order"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMoveLayerDown(selectedLayer.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title="Move Down in Order"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteLayer(selectedLayer.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete Layer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <Segmented
                label="Layer properties"
                className="mb-3 border-b border-gray-800 pb-2"
                value={activeTab}
                onChange={setActiveTab}
                options={LAYER_TABS}
              />

              <div>
                {activeTab === 'transform' && (
                  <div className="space-y-3">
                    <Slider
                      label="Scale"
                      display={selectedLayer.scaleX.toFixed(2)}
                      value={Math.abs(selectedLayer.scaleX)}
                      min={0.1} max={5} step={0.05}
                      onChange={(s) => onUpdateLayer(selectedLayer.id, {
                        scaleX: Math.sign(selectedLayer.scaleX) * s || s,
                        scaleY: Math.sign(selectedLayer.scaleY) * s || s
                      })}
                    />
                    <Slider
                      label="Rotation"
                      display={`${Math.round(selectedLayer.rotation)}°`}
                      value={selectedLayer.rotation}
                      min={-180} max={180} step={1}
                      onChange={(rotation) => onUpdateLayer(selectedLayer.id, { rotation })}
                    />
                    <div className="pt-2 border-t border-gray-800 space-y-3">
                       <SymmetryEditor
                         symmetry={selectedLayer.symmetry}
                         radialSegments={selectedLayer.radialSegments}
                         symmetryParams={selectedLayer.symmetryParams}
                         onChange={(updates) => onUpdateLayer(selectedLayer.id, updates)}
                       />
                    </div>
                  </div>
                )}

                {activeTab === 'style' && (
                  <div className="space-y-3">
                    <Slider
                      label="Opacity"
                      display={`${Math.round(selectedLayer.opacity * 100)}%`}
                      value={selectedLayer.opacity}
                      min={0} max={1} step={0.01}
                      onChange={(opacity) => onUpdateLayer(selectedLayer.id, { opacity })}
                    />
                    <Select
                      label="Blend Mode"
                      className="pt-2 border-t border-gray-800"
                      value={selectedLayer.blendMode}
                      options={BLEND_MODES}
                      onChange={(blendMode) => onUpdateLayer(selectedLayer.id, { blendMode })}
                    />

                    {selectedLayer.gifData && (
                      <div className="pt-2 border-t border-gray-800 space-y-2">
                        <Slider
                          label={<><Film className="w-3.5 h-3.5" /> GIF Speed</>}
                          headerClassName="mb-2"
                          labelClassName="font-semibold text-indigo-400 flex items-center gap-1"
                          displayClassName="text-gray-300"
                          display={`${(selectedLayer.gifSpeed ?? 1).toFixed(2)}x`}
                          value={selectedLayer.gifSpeed ?? 1}
                          min={0} max={5} step={0.1}
                          onChange={(gifSpeed) => onUpdateLayer(selectedLayer.id, { gifSpeed })}
                        />
                        <div className="grid grid-cols-5 gap-1 pt-1">
                          {[0.25, 0.5, 1.0, 2.0, 3.0].map((spd) => (
                            <button
                              key={spd}
                              onClick={() => onUpdateLayer(selectedLayer.id, { gifSpeed: spd })}
                              className={cn(
                                "py-1 text-[10px] rounded font-mono transition-colors border",
                                (selectedLayer.gifSpeed ?? 1) === spd
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
                  </div>
                )}

                {activeTab === 'motion' && (
                  <div className="space-y-2 pb-1">
                     <MotionControl label="X-Axis" config={selectedLayer.motionX} onChange={c => onUpdateLayer(selectedLayer.id, { motionX: c })} maxAmplitude={500} stepAmplitude={5} />
                     <MotionControl label="Y-Axis" config={selectedLayer.motionY} onChange={c => onUpdateLayer(selectedLayer.id, { motionY: c })} maxAmplitude={500} stepAmplitude={5} />
                     <MotionControl label="Rotation" config={selectedLayer.motionRotation} onChange={c => onUpdateLayer(selectedLayer.id, { motionRotation: c })} maxAmplitude={360} stepAmplitude={1} />
                     <MotionControl label="Scale" config={selectedLayer.motionScale} onChange={c => onUpdateLayer(selectedLayer.id, { motionScale: c })} maxAmplitude={3} stepAmplitude={0.05} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-gray-500">Select a layer to edit its properties.</div>
          )
        )}

        {appMode === 'polygon' && (
          selectedPolygon ? (
            <div className="p-3 flex flex-col">
              {/* Polygon Header & Layer Action Bar */}
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
                <input
                  type="text"
                  value={selectedPolygon.name}
                  onChange={(e) => onUpdatePolygon(selectedPolygon.id, { name: e.target.value })}
                  className="bg-transparent text-xs font-semibold text-gray-200 border-b border-transparent hover:border-gray-700 focus:border-indigo-500 focus:bg-gray-950 px-1 py-0.5 outline-none rounded truncate flex-1 mr-2"
                  title="Click to rename layer"
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => onUpdatePolygon(selectedPolygon.id, { hidden: !selectedPolygon.hidden })}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title={selectedPolygon.hidden ? "Show Polygon" : "Hide Polygon"}
                  >
                    {selectedPolygon.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => onDuplicatePolygon(selectedPolygon.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title="Duplicate Polygon"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMovePolygonUp(selectedPolygon.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title="Move Up in Order"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMovePolygonDown(selectedPolygon.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                    title="Move Down in Order"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeletePolygon(selectedPolygon.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete Polygon"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <Segmented
                label="Polygon properties"
                className="mb-3 border-b border-gray-800 pb-2"
                value={polyTab}
                onChange={setPolyTab}
                options={POLYGON_TABS}
              />

              <div>
                {polyTab === 'texture' && (
                  <div className="space-y-3">
                    {/* Texture Scale Slider & Quick Presets */}
                    <div>
                      <Slider
                        label="Texture Scale"
                        labelClassName="font-semibold text-indigo-300"
                        displayClassName="text-indigo-400 font-bold"
                        display={`${selectedPolygon.textureScale.toFixed(2)}x`}
                        trackClassName="h-1.5"
                        value={selectedPolygon.textureScale}
                        min={0.05} max={5.0} step={0.05}
                        onChange={(textureScale) => onUpdatePolygon(selectedPolygon.id, { textureScale })}
                      />
                      <div className="grid grid-cols-5 gap-1 mt-1.5">
                        {[0.25, 0.5, 1.0, 2.0, 4.0].map((sVal) => (
                          <button
                            key={sVal}
                            onClick={() => onUpdatePolygon(selectedPolygon.id, { textureScale: sVal })}
                            className={cn(
                              "py-1 text-[10px] rounded font-mono border transition-colors",
                              selectedPolygon.textureScale === sVal
                                ? "bg-indigo-600 text-white border-indigo-400 font-bold"
                                : "bg-gray-950 text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200"
                            )}
                          >
                            {sVal}x
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* GIF Speed */}
                    <div className="pt-2 border-t border-gray-800">
                      <Slider
                        label={<><Film className="w-3.5 h-3.5 text-indigo-400" /> Animated GIF Speed</>}
                        labelClassName="text-gray-300 flex items-center gap-1"
                        displayClassName="text-gray-300"
                        display={`${(selectedPolygon.gifSpeed ?? 1).toFixed(2)}x`}
                        value={selectedPolygon.gifSpeed ?? 1}
                        min={0} max={5} step={0.1}
                        onChange={(gifSpeed) => onUpdatePolygon(selectedPolygon.id, { gifSpeed })}
                      />
                      <div className="grid grid-cols-5 gap-1 mt-1">
                        {[0.25, 0.5, 1.0, 2.0, 3.0].map((spd) => (
                          <button
                            key={spd}
                            onClick={() => onUpdatePolygon(selectedPolygon.id, { gifSpeed: spd })}
                            className={cn(
                              "py-1 text-[10px] rounded font-mono border transition-colors",
                              (selectedPolygon.gifSpeed ?? 1) === spd
                                ? "bg-indigo-600 text-white border-indigo-400 font-bold"
                                : "bg-gray-950 text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200"
                            )}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Texture Rotation */}
                    <Slider
                      label="Texture Rotation"
                      className="pt-2 border-t border-gray-800"
                      display={`${Math.round(selectedPolygon.textureRotation)}°`}
                      value={selectedPolygon.textureRotation}
                      min={0} max={360} step={1}
                      onChange={(textureRotation) => onUpdatePolygon(selectedPolygon.id, { textureRotation })}
                    />

                    {/* Texture Offset X & Y */}
                    <div className="pt-2 border-t border-gray-800 grid grid-cols-2 gap-2">
                      <Slider
                        size="sm"
                        label="Offset X"
                        display={`${Math.round(selectedPolygon.textureOffsetX)}px`}
                        value={selectedPolygon.textureOffsetX}
                        min={-500} max={500} step={5}
                        onChange={(textureOffsetX) => onUpdatePolygon(selectedPolygon.id, { textureOffsetX })}
                      />
                      <Slider
                        size="sm"
                        label="Offset Y"
                        display={`${Math.round(selectedPolygon.textureOffsetY)}px`}
                        value={selectedPolygon.textureOffsetY}
                        min={-500} max={500} step={5}
                        onChange={(textureOffsetY) => onUpdatePolygon(selectedPolygon.id, { textureOffsetY })}
                      />
                    </div>
                  </div>
                )}

                {polyTab === 'style' && (
                  <div className="space-y-3">
                    {/* Opacity */}
                    <Slider
                      label="Opacity"
                      display={`${Math.round(selectedPolygon.opacity * 100)}%`}
                      value={selectedPolygon.opacity}
                      min={0} max={1} step={0.01}
                      onChange={(opacity) => onUpdatePolygon(selectedPolygon.id, { opacity })}
                    />

                    {/* Blend Mode */}
                    <Select
                      label="Blend Mode"
                      className="pt-2 border-t border-gray-800"
                      value={selectedPolygon.blendMode}
                      options={BLEND_MODES}
                      onChange={(blendMode) => onUpdatePolygon(selectedPolygon.id, { blendMode })}
                    />

                    {/* Stroke Color & Width */}
                    <div className="pt-2 border-t border-gray-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-gray-400">Stroke Border</label>
                        <input
                          type="color"
                          value={selectedPolygon.strokeColor === 'transparent' ? '#ffffff' : selectedPolygon.strokeColor}
                          onChange={(e) => onUpdatePolygon(selectedPolygon.id, { strokeColor: e.target.value })}
                          className="w-6 h-5 rounded cursor-pointer border-0 bg-gray-800 p-0"
                        />
                      </div>

                      <Slider
                        label="Border Width"
                        display={`${selectedPolygon.strokeWidth}px`}
                        value={selectedPolygon.strokeWidth}
                        min={0} max={20} step={1}
                        onChange={(strokeWidth) => onUpdatePolygon(selectedPolygon.id, { strokeWidth })}
                      />
                    </div>

                    {/* Solid Fill Color Fallback */}
                    <div className="pt-2 border-t border-gray-800 flex items-center justify-between">
                      <label className="text-[11px] text-gray-400">Fallback Fill Color</label>
                      <input
                        type="color"
                        value={selectedPolygon.fillColor || '#6366f1'}
                        onChange={(e) => onUpdatePolygon(selectedPolygon.id, { fillColor: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-gray-800 p-0"
                      />
                    </div>
                  </div>
                )}

                {polyTab === 'symmetry' && (
                  <div className="space-y-3">
                    <SymmetryEditor
                      symmetry={selectedPolygon.symmetry ?? 'none'}
                      radialSegments={selectedPolygon.radialSegments ?? 6}
                      symmetryParams={selectedPolygon.symmetryParams}
                      onChange={(updates) => onUpdatePolygon(selectedPolygon.id, updates)}
                    />
                  </div>
                )}

                {polyTab === 'motion' && (
                  <div className="space-y-2 pb-1">
                    <div className="pb-2 mb-1 border-b border-gray-800">
                      <MotionControl
                        label="Vertex Deformation (Jelly)"
                        config={selectedPolygon.vertexNoise}
                        onChange={(c) => onUpdatePolygon(selectedPolygon.id, {
                          vertexNoise: c ? { ...c, incoherence: selectedPolygon.vertexNoise?.incoherence ?? 0.6 } : undefined
                        })}
                        maxAmplitude={150}
                        stepAmplitude={2}
                      />
                      {selectedPolygon.vertexNoise && selectedPolygon.vertexNoise.type !== 'none' && (
                        <Slider
                          size="xs"
                          className="-mt-2 border border-t-0 border-gray-800 p-2 rounded-b bg-gray-800/30"
                          label="Incoherence (desync per vertex)"
                          display={`${Math.round(selectedPolygon.vertexNoise.incoherence * 100)}%`}
                          value={selectedPolygon.vertexNoise.incoherence}
                          min={0} max={1} step={0.05}
                          onChange={(incoherence) => onUpdatePolygon(selectedPolygon.id, {
                            vertexNoise: { ...selectedPolygon.vertexNoise!, incoherence }
                          })}
                        />
                      )}
                    </div>
                    <MotionControl
                      label="Texture Scale Pulse"
                      config={selectedPolygon.motionTextureScale}
                      onChange={c => onUpdatePolygon(selectedPolygon.id, { motionTextureScale: c })}
                      maxAmplitude={2}
                      stepAmplitude={0.05}
                    />
                    <MotionControl
                      label="Texture Spin"
                      config={selectedPolygon.motionTextureRotation}
                      onChange={c => onUpdatePolygon(selectedPolygon.id, { motionTextureRotation: c })}
                      maxAmplitude={360}
                      stepAmplitude={1}
                    />
                    <MotionControl
                      label="Texture Offset X Drift"
                      config={selectedPolygon.motionTextureOffsetX}
                      onChange={c => onUpdatePolygon(selectedPolygon.id, { motionTextureOffsetX: c })}
                      maxAmplitude={500}
                      stepAmplitude={5}
                    />
                    <MotionControl
                      label="Texture Offset Y Drift"
                      config={selectedPolygon.motionTextureOffsetY}
                      onChange={c => onUpdatePolygon(selectedPolygon.id, { motionTextureOffsetY: c })}
                      maxAmplitude={500}
                      stepAmplitude={5}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-gray-500">Select a polygon to edit its properties.</div>
          )
        )}
      </div>

      {/* Output dock: export and live-output triggers, always reachable regardless of selection. */}
      <div className="p-3 border-t border-gray-800 space-y-2 shrink-0">
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Output</label>
        <button
          onClick={() => setShowLiveOutputModal(true)}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors",
            liveOutputStreaming
              ? "bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border-emerald-600/80"
              : liveOutputConnected
                ? "bg-amber-950/90 hover:bg-amber-900 text-amber-200 border-amber-700/80"
                : "bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700"
          )}
        >
          {liveOutputBusy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Radio className="w-3.5 h-3.5" />}
          {liveOutputStreaming ? 'Live' : 'Live Output'}
        </button>
        <button
          onClick={exportApi.handleExportHighRes}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-medium transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export Image
        </button>
        <button
          onClick={exportApi.openExportModal}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all"
        >
          <Video className="w-3.5 h-3.5" />
          Export Animation
        </button>
      </div>

      {showLiveOutputModal && <LiveOutputModal api={liveOutputApi} />}
      {exportApi.showExportModal && <ExportModal api={exportApi} />}
    </div>
  );
}
