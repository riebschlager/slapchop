import React, { useRef, useState } from 'react';
import { Layer, PolygonLayer, SymmetryType, SymmetryParams, WallpaperLattice, DEFAULT_SYMMETRY_PARAMS, BlendMode, MotionConfig, MotionType } from '../types';
import { Trash2, Image as ImageIcon, GripVertical, Film, Sparkles, Shapes, PenTool, Eye, EyeOff, Copy, ChevronUp, ChevronDown, Undo2, Redo2, Save, FolderOpen, Wand2, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { redo, undo, useStore } from '../store';
import { openProject, saveProject } from '../lib/project';
import { isNative, openProjectViaDialog } from '../lib/native';
import { FX_PRESETS } from '../lib/fxPresets';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function MotionControl({ label, config, onChange, maxAmplitude = 1000, stepAmplitude = 10 }: { label: string, config?: MotionConfig, onChange: (c: MotionConfig | undefined) => void, maxAmplitude?: number, stepAmplitude?: number }) {
  const isEnabled = config && config.type !== 'none';
  return (
    <div className="mb-2 border border-gray-800 p-2 rounded bg-gray-800/30">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold text-gray-300">{label}</label>
        <select 
          value={config?.type || 'none'}
          onChange={(e) => {
             const type = e.target.value as MotionType;
             if (type === 'none') {
               onChange(undefined);
             } else {
               onChange({ type, speed: config?.speed || 1, amplitude: config?.amplitude || (maxAmplitude / 10), phase: config?.phase || 0 });
             }
          }}
          className="bg-gray-900 text-[10px] text-gray-300 border border-gray-700 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="none">None</option>
          <option value="sine">Sine</option>
          <option value="noise">Noise</option>
        </select>
      </div>
      {isEnabled && (
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-800/50">
           <div>
             <div className="flex justify-between text-[9px] text-gray-400 mb-1">
               <span>Spd</span><span>{config!.speed.toFixed(1)}</span>
             </div>
             <input type="range" min="0.1" max="10" step="0.1" value={config!.speed} 
                onChange={e => onChange({ ...config!, speed: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 h-1" />
           </div>
           <div>
             <div className="flex justify-between text-[9px] text-gray-400 mb-1">
               <span>Amp</span><span>{config!.amplitude.toFixed(stepAmplitude < 1 ? 1 : 0)}</span>
             </div>
             <input type="range" min={stepAmplitude} max={maxAmplitude} step={stepAmplitude} value={config!.amplitude} 
                onChange={e => onChange({ ...config!, amplitude: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 h-1" />
           </div>
           <div>
             <div className="flex justify-between text-[9px] text-gray-400 mb-1">
               <span>Phs</span><span>{config!.phase.toFixed(1)}</span>
             </div>
             <input type="range" min="0" max={Math.PI * 2} step="0.1" value={config!.phase} 
                onChange={e => onChange({ ...config!, phase: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 h-1" />
           </div>
        </div>
      )}
    </div>
  );
}

const SYMMETRY_OPTIONS: { value: SymmetryType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'mirror-x', label: 'Horizontal Mirror' },
  { value: 'mirror-y', label: 'Vertical Mirror' },
  { value: 'quad', label: 'Quadrant' },
  { value: 'radial', label: 'Radial (Kaleidoscope)' },
  { value: 'spiral', label: 'Spiral (Droste)' },
  { value: 'wallpaper', label: 'Wallpaper Tiling' },
  { value: 'poincare', label: 'Poincaré Disk' },
  { value: 'voronoi', label: 'Voronoi Shards' },
];

const WALLPAPER_LATTICE_OPTIONS: { value: WallpaperLattice; label: string }[] = [
  { value: 'p3', label: 'P3 — Triangular' },
  { value: 'p4m', label: 'P4M — Square + Mirror' },
  { value: 'p6', label: 'P6 — Hexagonal' },
];

/**
 * Shared symmetry controls, reused by both the Layer and PolygonLayer
 * inspectors — same field names on both document types (see types.ts), so
 * one editor + one onChange shape works for either via updateLayer/
 * updatePolygon. Each mode's extra knobs live in symmetryParams.
 */
function SymmetryEditor({
  symmetry, radialSegments, symmetryParams, onChange
}: {
  symmetry: SymmetryType;
  radialSegments: number;
  symmetryParams?: SymmetryParams;
  onChange: (updates: Partial<{ symmetry: SymmetryType; radialSegments: number; symmetryParams: SymmetryParams }>) => void;
}) {
  const params = { ...DEFAULT_SYMMETRY_PARAMS, ...symmetryParams };
  const updateParams = (p: Partial<SymmetryParams>) => onChange({ symmetryParams: { ...params, ...p } });

  return (
    <>
      <div>
        <label className="text-[11px] text-gray-400 mb-1 block">Symmetry Engine</label>
        <select
          value={symmetry}
          onChange={(e) => onChange({ symmetry: e.target.value as SymmetryType })}
          className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {SYMMETRY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>

      {symmetry === 'radial' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-gray-400">Radial Segments</label>
            <span className="text-[11px] font-mono">{radialSegments}</span>
          </div>
          <input type="range" min="2" max="24" step="1" value={radialSegments}
            onChange={(e) => onChange({ radialSegments: parseInt(e.target.value) })}
            className="w-full accent-indigo-500 h-1" />
        </div>
      )}

      {symmetry === 'spiral' && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Copies</label>
              <span className="text-[11px] font-mono">{params.spiralInstances}</span>
            </div>
            <input type="range" min="2" max="30" step="1" value={params.spiralInstances}
              onChange={(e) => updateParams({ spiralInstances: parseInt(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Angle Step</label>
              <span className="text-[11px] font-mono">{params.spiralAngleStep.toFixed(0)}&deg;</span>
            </div>
            <input type="range" min="1" max="90" step="1" value={params.spiralAngleStep}
              onChange={(e) => updateParams({ spiralAngleStep: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Growth (shrink / grow per copy)</label>
              <span className="text-[11px] font-mono">{params.spiralGrowth.toFixed(2)}</span>
            </div>
            <input type="range" min="0.5" max="1.3" step="0.01" value={params.spiralGrowth}
              onChange={(e) => updateParams({ spiralGrowth: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
        </div>
      )}

      {symmetry === 'wallpaper' && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">Lattice Type</label>
            <select
              value={params.wallpaperLattice}
              onChange={(e) => updateParams({ wallpaperLattice: e.target.value as WallpaperLattice })}
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {WALLPAPER_LATTICE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Cell Size</label>
              <span className="text-[11px] font-mono">{Math.round(params.wallpaperCellSize)}px</span>
            </div>
            <input type="range" min="60" max="600" step="10" value={params.wallpaperCellSize}
              onChange={(e) => updateParams({ wallpaperCellSize: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
        </div>
      )}

      {symmetry === 'poincare' && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Copies per Ring</label>
              <span className="text-[11px] font-mono">{radialSegments}</span>
            </div>
            <input type="range" min="2" max="24" step="1" value={radialSegments}
              onChange={(e) => onChange({ radialSegments: parseInt(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Rings</label>
              <span className="text-[11px] font-mono">{params.poincareRings}</span>
            </div>
            <input type="range" min="1" max="8" step="1" value={params.poincareRings}
              onChange={(e) => updateParams({ poincareRings: parseInt(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Boundary Radius</label>
              <span className="text-[11px] font-mono">{Math.round(params.poincareRadius)}px</span>
            </div>
            <input type="range" min="100" max="900" step="10" value={params.poincareRadius}
              onChange={(e) => updateParams({ poincareRadius: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
        </div>
      )}

      {symmetry === 'voronoi' && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Shard Count</label>
              <span className="text-[11px] font-mono">{params.voronoiCells}</span>
            </div>
            <input type="range" min="5" max="50" step="1" value={params.voronoiCells}
              onChange={(e) => updateParams({ voronoiCells: parseInt(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Seed</label>
              <span className="text-[11px] font-mono">{params.voronoiSeed}</span>
            </div>
            <input type="range" min="1" max="999" step="1" value={params.voronoiSeed}
              onChange={(e) => updateParams({ voronoiSeed: parseInt(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-gray-400">Phase Variation</label>
              <span className="text-[11px] font-mono">{Math.round(params.voronoiPhaseVariation * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.05" value={params.voronoiPhaseVariation}
              onChange={(e) => updateParams({ voronoiPhaseVariation: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1" />
          </div>
        </div>
      )}

      {symmetry !== 'none' && symmetry !== 'voronoi' && (
        <div className="pt-1 text-[10px] text-gray-500">
          Drag the amber origin handle on canvas to re-center this symmetry.
        </div>
      )}
    </>
  );
}

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'screen', label: 'Screen' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'color-dodge', label: 'Color Dodge' },
];

function SortableLayerItem({ layer, selectedLayerId, onSelectLayer, onUpdateLayer, onDeleteLayer, onDuplicateLayer }: { 
  key?: string,
  layer: Layer, 
  selectedLayerId: string | null, 
  onSelectLayer: (id: string) => void, 
  onUpdateLayer?: (id: string, updates: Partial<Layer>) => void,
  onDeleteLayer: (id: string) => void,
  onDuplicateLayer?: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: layer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div 
      ref={setNodeRef} style={style}
      onClick={() => onSelectLayer(layer.id)}
      className={cn(
        "flex items-center gap-2 p-1.5 rounded cursor-pointer group transition-colors",
        layer.hidden ? "opacity-50 grayscale" : "",
        selectedLayerId === layer.id ? "bg-indigo-900/40 border border-indigo-500/50" : "hover:bg-gray-800 border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-gray-700">
         <img src={layer.src} className="w-full h-full object-contain" />
       </div>
       <div className="flex-1 truncate pl-1">
         <div className="text-[13px] font-medium text-gray-200 truncate">{layer.name}</div>
         <div className="text-[10px] text-gray-500">{layer.symmetry.replace('-', ' ')}</div>
       </div>
       
       <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
         {onUpdateLayer && (
           <button 
             onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { hidden: !layer.hidden }); }}
             className="p-1 hover:text-white text-gray-400"
             title={layer.hidden ? "Show Layer" : "Hide Layer"}
           >
             {layer.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicateLayer && (
           <button 
             onClick={(e) => { e.stopPropagation(); onDuplicateLayer(layer.id); }}
             className="p-1 hover:text-white text-gray-400"
             title="Duplicate Layer"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }} className="p-1 hover:text-red-400 text-gray-400" title="Delete Layer">
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}

function SortablePolygonItem({ polygon, selectedPolygonId, onSelectPolygon, onUpdatePolygon, onDeletePolygon, onDuplicatePolygon }: { 
  key?: string,
  polygon: PolygonLayer, 
  selectedPolygonId: string | null, 
  onSelectPolygon: (id: string) => void, 
  onUpdatePolygon?: (id: string, updates: Partial<PolygonLayer>) => void,
  onDeletePolygon: (id: string) => void,
  onDuplicatePolygon?: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: polygon.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div 
      ref={setNodeRef} style={style}
      onClick={() => onSelectPolygon(polygon.id)}
      className={cn(
        "flex items-center gap-2 p-1.5 rounded cursor-pointer group transition-colors",
        polygon.hidden ? "opacity-50 grayscale" : "",
        selectedPolygonId === polygon.id ? "bg-indigo-900/40 border border-indigo-500/50" : "hover:bg-gray-800 border border-transparent"
      )}
    >
       <div {...attributes} {...listeners} className="p-0.5 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300">
         <GripVertical className="w-3.5 h-3.5" />
       </div>
       <div className="w-8 h-8 rounded-sm overflow-hidden bg-black/50 shrink-0 border border-gray-700 flex items-center justify-center">
         {polygon.src ? (
           <img src={polygon.src} className="w-full h-full object-cover" />
         ) : (
           <div className="w-4 h-4 rounded-sm border" style={{ backgroundColor: polygon.fillColor || '#6366f1' }} />
         )}
       </div>
       <div className="flex-1 truncate pl-1">
         <div className="text-[13px] font-medium text-gray-200 truncate">{polygon.name}</div>
         <div className="text-[10px] text-gray-500">{polygon.points.length} vertices &bull; Scale {(polygon.textureScale ?? 1).toFixed(2)}x</div>
       </div>
       
       <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
         {onUpdatePolygon && (
           <button 
             onClick={(e) => { e.stopPropagation(); onUpdatePolygon(polygon.id, { hidden: !polygon.hidden }); }}
             className="p-1 hover:text-white text-gray-400"
             title={polygon.hidden ? "Show Polygon" : "Hide Polygon"}
           >
             {polygon.hidden ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
           </button>
         )}
         {onDuplicatePolygon && (
           <button 
             onClick={(e) => { e.stopPropagation(); onDuplicatePolygon(polygon.id); }}
             className="p-1 hover:text-white text-gray-400"
             title="Duplicate Polygon"
           >
             <Copy className="w-3.5 h-3.5" />
           </button>
         )}
         <button onClick={(e) => { e.stopPropagation(); onDeletePolygon(polygon.id); }} className="p-1 hover:text-red-400 text-gray-400" title="Delete Polygon">
           <Trash2 className="w-3.5 h-3.5" />
         </button>
       </div>
    </div>
  );
}

function MasterFxPanel() {
  const masterFx = useStore(s => s.masterFx);
  const onUpdateFx = useStore(s => s.updateMasterFx);
  const onApplyPreset = useStore(s => s.applyFxPreset);
  const onResetFx = useStore(s => s.resetMasterFx);

  const [isExpanded, setIsExpanded] = useState(false);
  const [openSection, setOpenSection] = useState<'color' | 'rgb' | 'duotone' | 'scanlines' | 'noise' | 'bloom' | null>(null);

  const toggleSection = (section: 'color' | 'rgb' | 'duotone' | 'scanlines' | 'noise' | 'bloom') => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <div className="border-b border-gray-800 bg-gray-950/40">
      {/* Header Bar */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <Wand2 className={cn("w-4 h-4 transition-colors", masterFx.enabled ? "text-indigo-400" : "text-gray-500")} />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Master FX & Shaders</span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Master Enable/Disable Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={masterFx.enabled}
            onClick={() => onUpdateFx({ enabled: !masterFx.enabled })}
            className={cn(
              "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              masterFx.enabled ? "bg-indigo-600" : "bg-gray-700"
            )}
            title={masterFx.enabled ? "Disable Master FX" : "Enable Master FX"}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                masterFx.enabled ? "translate-x-3" : "translate-x-0"
              )}
            />
          </button>
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-gray-200 p-0.5"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Controls */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Aesthetic Presets</label>
              <button
                onClick={() => onResetFx()}
                className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
                title="Reset all FX to default"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {FX_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onApplyPreset(preset.config)}
                  className="text-[10px] px-2 py-1 bg-gray-800/80 hover:bg-indigo-600/80 hover:text-white text-gray-300 rounded border border-gray-700/60 transition-colors font-medium"
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Module 1: Color Grading */}
          <div className="border border-gray-800 rounded-md overflow-hidden bg-gray-900/60">
            <div 
              onClick={() => toggleSection('color')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.colorAdjustEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ colorAdjustEnabled: e.target.checked }); }}
                  className="rounded border-gray-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-gray-800 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-200">Color Grading</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 transition-transform", openSection === 'color' && "rotate-180")} />
            </div>

            {openSection === 'color' && (
              <div className="p-3 pt-1 space-y-2 border-t border-gray-800/60 bg-gray-950/30">
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Contrast</span>
                    <span>{masterFx.contrast > 0 ? `+${(masterFx.contrast * 100).toFixed(0)}%` : `${(masterFx.contrast * 100).toFixed(0)}%`}</span>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.05"
                    value={masterFx.contrast}
                    onChange={(e) => onUpdateFx({ contrast: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Saturation</span>
                    <span>{masterFx.saturation > 0 ? `+${(masterFx.saturation * 100).toFixed(0)}%` : `${(masterFx.saturation * 100).toFixed(0)}%`}</span>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.05"
                    value={masterFx.saturation}
                    onChange={(e) => onUpdateFx({ saturation: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Brightness</span>
                    <span>{masterFx.brightness > 0 ? `+${(masterFx.brightness * 100).toFixed(0)}%` : `${(masterFx.brightness * 100).toFixed(0)}%`}</span>
                  </div>
                  <input
                    type="range"
                    min="-0.8"
                    max="0.8"
                    step="0.05"
                    value={masterFx.brightness}
                    onChange={(e) => onUpdateFx({ brightness: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Hue Rotation</span>
                    <span>{masterFx.hueRotate.toFixed(0)}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    value={masterFx.hueRotate}
                    onChange={(e) => onUpdateFx({ hueRotate: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <MotionControl
                  label="Hue Motion Modulation"
                  config={masterFx.motionHueRotate}
                  onChange={(c) => onUpdateFx({ motionHueRotate: c })}
                  maxAmplitude={180}
                  stepAmplitude={5}
                />
              </div>
            )}
          </div>

          {/* Module 2: Chromatic Aberration / RGB Split */}
          <div className="border border-gray-800 rounded-md overflow-hidden bg-gray-900/60">
            <div 
              onClick={() => toggleSection('rgb')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.rgbSplitEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ rgbSplitEnabled: e.target.checked }); }}
                  className="rounded border-gray-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-gray-800 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-200">Chromatic Aberration (RGB Split)</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 transition-transform", openSection === 'rgb' && "rotate-180")} />
            </div>

            {openSection === 'rgb' && (
              <div className="p-3 pt-1 space-y-2 border-t border-gray-800/60 bg-gray-950/30">
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Shift Distance</span>
                    <span>{masterFx.rgbSplitOffset.toFixed(0)} px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={masterFx.rgbSplitOffset}
                    onChange={(e) => onUpdateFx({ rgbSplitOffset: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Shift Angle</span>
                    <span>{masterFx.rgbSplitAngle.toFixed(0)}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="5"
                    value={masterFx.rgbSplitAngle}
                    onChange={(e) => onUpdateFx({ rgbSplitAngle: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <MotionControl
                  label="Distance Motion Modulation"
                  config={masterFx.motionRgbSplitOffset}
                  onChange={(c) => onUpdateFx({ motionRgbSplitOffset: c })}
                  maxAmplitude={30}
                  stepAmplitude={1}
                />
              </div>
            )}
          </div>

          {/* Module 3: Duotone / Gradient Map */}
          <div className="border border-gray-800 rounded-md overflow-hidden bg-gray-900/60">
            <div 
              onClick={() => toggleSection('duotone')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.duotoneEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ duotoneEnabled: e.target.checked }); }}
                  className="rounded border-gray-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-gray-800 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-200">Duotone / Gradient Map</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 transition-transform", openSection === 'duotone' && "rotate-180")} />
            </div>

            {openSection === 'duotone' && (
              <div className="p-3 pt-1 space-y-2 border-t border-gray-800/60 bg-gray-950/30">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Shadow Color</label>
                    <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded p-1">
                      <input
                        type="color"
                        value={masterFx.duotoneShadowColor}
                        onChange={(e) => onUpdateFx({ duotoneShadowColor: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="text-[10px] font-mono text-gray-300">{masterFx.duotoneShadowColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Highlight Color</label>
                    <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded p-1">
                      <input
                        type="color"
                        value={masterFx.duotoneHighlightColor}
                        onChange={(e) => onUpdateFx({ duotoneHighlightColor: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="text-[10px] font-mono text-gray-300">{masterFx.duotoneHighlightColor}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Blend Intensity</span>
                    <span>{(masterFx.duotoneIntensity * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={masterFx.duotoneIntensity}
                    onChange={(e) => onUpdateFx({ duotoneIntensity: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Module 4: CRT Scanlines */}
          <div className="border border-gray-800 rounded-md overflow-hidden bg-gray-900/60">
            <div 
              onClick={() => toggleSection('scanlines')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.scanlinesEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ scanlinesEnabled: e.target.checked }); }}
                  className="rounded border-gray-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-gray-800 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-200">CRT Scanlines</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 transition-transform", openSection === 'scanlines' && "rotate-180")} />
            </div>

            {openSection === 'scanlines' && (
              <div className="p-3 pt-1 space-y-2 border-t border-gray-800/60 bg-gray-950/30">
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Line Count</span>
                    <span>{masterFx.scanlinesCount}</span>
                  </div>
                  <input
                    type="range"
                    min="80"
                    max="720"
                    step="20"
                    value={masterFx.scanlinesCount}
                    onChange={(e) => onUpdateFx({ scanlinesCount: parseInt(e.target.value, 10) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Line Opacity</span>
                    <span>{(masterFx.scanlinesOpacity * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={masterFx.scanlinesOpacity}
                    onChange={(e) => onUpdateFx({ scanlinesOpacity: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Roll Speed</span>
                    <span>{masterFx.scanlinesSpeed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={masterFx.scanlinesSpeed}
                    onChange={(e) => onUpdateFx({ scanlinesSpeed: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Module 5: Film Grain & Noise */}
          <div className="border border-gray-800 rounded-md overflow-hidden bg-gray-900/60">
            <div 
              onClick={() => toggleSection('noise')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.noiseEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ noiseEnabled: e.target.checked }); }}
                  className="rounded border-gray-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-gray-800 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-200">Film Grain & Noise</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 transition-transform", openSection === 'noise' && "rotate-180")} />
            </div>

            {openSection === 'noise' && (
              <div className="p-3 pt-1 space-y-2 border-t border-gray-800/60 bg-gray-950/30">
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Noise Intensity</span>
                    <span>{(masterFx.noiseAmount * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.02"
                    max="0.5"
                    step="0.02"
                    value={masterFx.noiseAmount}
                    onChange={(e) => onUpdateFx({ noiseAmount: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Animation Speed</span>
                    <span>{masterFx.noiseSpeed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.2"
                    value={masterFx.noiseSpeed}
                    onChange={(e) => onUpdateFx({ noiseSpeed: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Module 6: Bloom & Soft Glow */}
          <div className="border border-gray-800 rounded-md overflow-hidden bg-gray-900/60">
            <div 
              onClick={() => toggleSection('bloom')}
              className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={masterFx.bloomEnabled}
                  onChange={(e) => { e.stopPropagation(); onUpdateFx({ bloomEnabled: e.target.checked }); }}
                  className="rounded border-gray-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-gray-800 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-200">Bloom & Soft Glow</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 transition-transform", openSection === 'bloom' && "rotate-180")} />
            </div>

            {openSection === 'bloom' && (
              <div className="p-3 pt-1 space-y-2 border-t border-gray-800/60 bg-gray-950/30">
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Glow Radius</span>
                    <span>{masterFx.bloomStrength.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    step="0.5"
                    value={masterFx.bloomStrength}
                    onChange={(e) => onUpdateFx({ bloomStrength: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const appMode = useStore(s => s.appMode);
  const onModeChange = useStore(s => s.setAppMode);
  const layers = useStore(s => s.layers);
  const selectedLayerId = useStore(s => s.selectedLayerId);
  const onSelectLayer = useStore(s => s.selectLayer);
  const onUpdateLayer = useStore(s => s.updateLayer);
  const onDeleteLayer = useStore(s => s.deleteLayer);
  const onDuplicateLayer = useStore(s => s.duplicateLayer);
  const onMoveLayerUp = useStore(s => s.moveLayerUp);
  const onMoveLayerDown = useStore(s => s.moveLayerDown);
  const onReorderLayers = useStore(s => s.reorderLayers);
  const onAddLayer = useStore(s => s.addLayerFromFile);
  const polygonLayers = useStore(s => s.polygonLayers);
  const selectedPolygonId = useStore(s => s.selectedPolygonId);
  const onSelectPolygon = useStore(s => s.selectPolygon);
  const onUpdatePolygon = useStore(s => s.updatePolygon);
  const onDeletePolygon = useStore(s => s.deletePolygon);
  const onDuplicatePolygon = useStore(s => s.duplicatePolygon);
  const onMovePolygonUp = useStore(s => s.movePolygonUp);
  const onMovePolygonDown = useStore(s => s.movePolygonDown);
  const onReorderPolygons = useStore(s => s.reorderPolygons);
  const onAddPresetPolygon = useStore(s => s.addPresetPolygon);
  const isDrawingPolygon = useStore(s => s.isDrawingPolygon);
  const onToggleDrawPolygon = useStore(s => s.toggleDrawPolygon);
  const onUploadPolygonTexture = useStore(s => s.uploadPolygonTexture);
  const canvasBg = useStore(s => s.canvasBg);
  const onUpdateCanvasBg = useStore(s => s.setCanvasBg);

  const [activeTab, setActiveTab] = useState<'transform' | 'style' | 'motion'>('transform');
  const [polyTab, setPolyTab] = useState<'texture' | 'style' | 'symmetry' | 'motion'>('texture');
  const projectFileInputRef = useRef<HTMLInputElement>(null);

  const handleProjectFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await openProject(file);
    } catch (err) {
      console.error('Failed to open project:', err);
      alert(err instanceof Error ? err.message : 'Failed to open project file.');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEndSymmetry = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderLayers(active.id as string, over.id as string);
    }
  };

  const handleDragEndPolygon = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderPolygons(active.id as string, over.id as string);
    }
  };

  const handleSymmetryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const fileList: File[] = Array.from(e.target.files);
      fileList.forEach((file: File) => {
        onAddLayer(file, 0, 0);
      });
      e.target.value = '';
    }
  };

  const handlePolygonTextureFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      onUploadPolygonTexture(file);
      e.target.value = '';
    }
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-screen text-gray-200 overflow-y-auto shrink-0">
      {/* Header & Mode Switcher */}
      <div className="p-4 border-b border-gray-800">
         <div className="flex items-start justify-between">
           <div>
             <h1 className="text-xl font-bold text-white tracking-tight">slapchop</h1>
             <p className="text-xs text-gray-400 mt-0.5">Generative Motion Studio</p>
           </div>
           <div className="flex items-center gap-0.5">
             <button onClick={() => undo()} className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors" title="Undo (⌘Z)">
               <Undo2 className="w-4 h-4" />
             </button>
             <button onClick={() => redo()} className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors" title="Redo (⇧⌘Z)">
               <Redo2 className="w-4 h-4" />
             </button>
             <button onClick={() => saveProject()} className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors" title="Save Project (⌘S)">
               <Save className="w-4 h-4" />
             </button>
             <button onClick={() => isNative() ? openProjectViaDialog() : projectFileInputRef.current?.click()} className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors" title="Open Project (⌘O)">
               <FolderOpen className="w-4 h-4" />
             </button>
             <input
               ref={projectFileInputRef}
               type="file"
               accept=".slapchop,application/json"
               className="hidden"
               onChange={handleProjectFileChange}
             />
           </div>
         </div>

         {/* Mode Switcher Buttons */}
         <div className="mt-3 grid grid-cols-2 gap-1 p-1 bg-gray-950 rounded-lg border border-gray-800">
           <button
             onClick={() => onModeChange('symmetry')}
             className={cn(
               "flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all",
               appMode === 'symmetry'
                 ? "bg-indigo-600 text-white shadow"
                 : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
             )}
           >
             <Sparkles className="w-3.5 h-3.5" />
             Symmetry
           </button>
           <button
             onClick={() => onModeChange('polygon')}
             className={cn(
               "flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all",
               appMode === 'polygon'
                 ? "bg-indigo-600 text-white shadow"
                 : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
             )}
           >
             <Shapes className="w-3.5 h-3.5" />
             Tiled GIF
           </button>
         </div>
      </div>

      {/* Canvas Background Color */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Canvas Background</label>
        <input 
          type="color" 
          value={canvasBg}
          onChange={(e) => onUpdateCanvasBg(e.target.value)}
          className="w-8 h-6 rounded cursor-pointer border-0 bg-gray-800 p-0"
        />
      </div>

      {/* Master Post-Processing FX & Shaders */}
      <MasterFxPanel />

      {/* MODE 1: SYMMETRY LAYERS */}
      {appMode === 'symmetry' && (
        <>
          <div className="p-4 border-b border-gray-800">
            <label className="flex items-center justify-center gap-2 w-full py-2 bg-gray-800 hover:bg-gray-700 rounded-md cursor-pointer transition-colors text-xs font-medium border border-gray-700">
              <ImageIcon className="w-4 h-4 text-indigo-400" />
              Upload Media / GIF
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleSymmetryFileChange} />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 relative">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm px-4 py-2 border-b border-gray-800 z-10 flex items-center justify-between">
               <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Layers ({layers.length})</label>
            </div>
            
            <div className="p-2 space-y-1">
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndSymmetry}
              >
                <SortableContext items={layers.map(l => l.id)} strategy={verticalListSortingStrategy}>
                  {layers.map((layer) => (
                    <SortableLayerItem 
                      key={layer.id}
                      layer={layer}
                      selectedLayerId={selectedLayerId}
                      onSelectLayer={onSelectLayer}
                      onUpdateLayer={onUpdateLayer}
                      onDeleteLayer={onDeleteLayer}
                      onDuplicateLayer={onDuplicateLayer}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {layers.length === 0 && (
                 <div className="p-4 text-center text-xs text-gray-500">No layers added yet. Upload an image or GIF to start.</div>
              )}
            </div>
          </div>

          {selectedLayer && (
            <div className="p-3 border-t border-gray-800 bg-gray-900/80 flex flex-col min-h-[280px]">
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
                   {onDuplicateLayer && (
                     <button
                       onClick={() => onDuplicateLayer(selectedLayer.id)}
                       className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                       title="Duplicate Layer"
                     >
                       <Copy className="w-3.5 h-3.5" />
                     </button>
                   )}
                   {onMoveLayerUp && (
                     <button
                       onClick={() => onMoveLayerUp(selectedLayer.id)}
                       className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                       title="Move Up in Order"
                     >
                       <ChevronUp className="w-3.5 h-3.5" />
                     </button>
                   )}
                   {onMoveLayerDown && (
                     <button
                       onClick={() => onMoveLayerDown(selectedLayer.id)}
                       className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                       title="Move Down in Order"
                     >
                       <ChevronDown className="w-3.5 h-3.5" />
                     </button>
                   )}
                   <button
                     onClick={() => onDeleteLayer(selectedLayer.id)}
                     className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors"
                     title="Delete Layer"
                   >
                     <Trash2 className="w-3.5 h-3.5" />
                   </button>
                 </div>
               </div>

               <div className="flex items-center gap-1 mb-3 border-b border-gray-800 pb-2">
                 <button onClick={() => setActiveTab('transform')} className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", activeTab === 'transform' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}>Transform</button>
                 <button onClick={() => setActiveTab('style')} className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", activeTab === 'style' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}>Style</button>
                 <button onClick={() => setActiveTab('motion')} className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", activeTab === 'motion' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}>Motion</button>
               </div>
               
               <div className="flex-1 overflow-y-auto pr-1">
                 {activeTab === 'transform' && (
                   <div className="space-y-3">
                     <div>
                        <div className="flex items-center justify-between mb-1">
                           <span className="text-[11px] text-gray-400">Scale</span>
                           <span className="text-[11px] font-mono">{selectedLayer.scaleX.toFixed(2)}</span>
                        </div>
                        <input type="range" min="0.1" max="5" step="0.05" value={Math.abs(selectedLayer.scaleX)} 
                           onChange={(e) => {
                              const s = parseFloat(e.target.value);
                              onUpdateLayer(selectedLayer.id, { scaleX: Math.sign(selectedLayer.scaleX) * s || s, scaleY: Math.sign(selectedLayer.scaleY) * s || s });
                           }} 
                           className="w-full accent-indigo-500 h-1" 
                        />
                     </div>
                     <div>
                        <div className="flex items-center justify-between mb-1">
                           <span className="text-[11px] text-gray-400">Rotation</span>
                           <span className="text-[11px] font-mono">{Math.round(selectedLayer.rotation)}&deg;</span>
                        </div>
                        <input type="range" min="-180" max="180" step="1" value={selectedLayer.rotation} 
                           onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: parseFloat(e.target.value) })} 
                           className="w-full accent-indigo-500 h-1" 
                        />
                     </div>
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
                     <div>
                        <div className="flex items-center justify-between mb-1">
                           <span className="text-[11px] text-gray-400">Opacity</span>
                           <span className="text-[11px] font-mono">{Math.round(selectedLayer.opacity * 100)}%</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.01" value={selectedLayer.opacity} 
                           onChange={(e) => onUpdateLayer(selectedLayer.id, { opacity: parseFloat(e.target.value) })} 
                           className="w-full accent-indigo-500 h-1" 
                        />
                     </div>
                     <div className="pt-2 border-t border-gray-800">
                        <label className="text-[11px] text-gray-400 mb-1 block">Blend Mode</label>
                        <select 
                          value={selectedLayer.blendMode} 
                          onChange={(e) => onUpdateLayer(selectedLayer.id, { blendMode: e.target.value as BlendMode })}
                          className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                           {BLEND_MODES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                     </div>

                     {selectedLayer.gifData && (
                       <div className="pt-2 border-t border-gray-800 space-y-2">
                         <div className="flex items-center justify-between">
                           <label className="text-[11px] font-semibold text-indigo-400 flex items-center gap-1">
                             <Film className="w-3.5 h-3.5" /> GIF Speed
                           </label>
                           <span className="text-[11px] font-mono text-gray-300">
                             {(selectedLayer.gifSpeed ?? 1).toFixed(2)}x
                           </span>
                         </div>
                         <input
                           type="range"
                           min="0"
                           max="5"
                           step="0.1"
                           value={selectedLayer.gifSpeed ?? 1}
                           onChange={(e) => onUpdateLayer(selectedLayer.id, { gifSpeed: parseFloat(e.target.value) })}
                           className="w-full accent-indigo-500 h-1"
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
          )}
        </>
      )}

      {/* MODE 2: POLYGON GIF TILER */}
      {appMode === 'polygon' && (
        <>
          {/* Polygon Creation Controls */}
          <div className="p-3 border-b border-gray-800 space-y-3">
            <div>
              <button
                onClick={onToggleDrawPolygon}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2 rounded-md font-semibold text-xs transition-all border",
                  isDrawingPolygon
                    ? "bg-amber-600 text-white border-amber-500 animate-pulse"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500"
                )}
              >
                <PenTool className="w-4 h-4" />
                {isDrawingPolygon ? "Click Canvas to Draw Points..." : "Draw Custom Polygon"}
              </button>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Add Shape Presets</label>
              <div className="grid grid-cols-4 gap-1">
                <button
                  onClick={() => onAddPresetPolygon('triangle')}
                  className="py-1.5 px-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-[11px] border border-gray-700 flex flex-col items-center gap-1"
                  title="Triangle"
                >
                  <span className="text-xs">🔺</span>
                  Triangle
                </button>
                <button
                  onClick={() => onAddPresetPolygon('rectangle')}
                  className="py-1.5 px-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-[11px] border border-gray-700 flex flex-col items-center gap-1"
                  title="Rectangle"
                >
                  <span className="text-xs">🟩</span>
                  Square
                </button>
                <button
                  onClick={() => onAddPresetPolygon('hexagon')}
                  className="py-1.5 px-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-[11px] border border-gray-700 flex flex-col items-center gap-1"
                  title="Hexagon"
                >
                  <span className="text-xs">🔷</span>
                  Hexagon
                </button>
                <button
                  onClick={() => onAddPresetPolygon('star')}
                  className="py-1.5 px-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-[11px] border border-gray-700 flex flex-col items-center gap-1"
                  title="Star"
                >
                  <span className="text-xs">⭐</span>
                  Star
                </button>
              </div>
            </div>

            <div>
              <label className="flex items-center justify-center gap-2 w-full py-1.5 bg-gray-800/80 hover:bg-gray-700 rounded-md cursor-pointer transition-colors text-xs text-gray-300 border border-gray-700">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                {selectedPolygon ? "Upload Texture for Selected Shape" : "Upload GIF / Texture"}
                <input type="file" accept="image/*" className="hidden" onChange={handlePolygonTextureFileChange} />
              </label>
            </div>
          </div>

          {/* Polygon Layers List */}
          <div className="flex-1 overflow-y-auto min-h-0 relative">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm px-4 py-2 border-b border-gray-800 z-10 flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Polygons ({polygonLayers.length})</label>
            </div>

            <div className="p-2 space-y-1">
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndPolygon}
              >
                <SortableContext items={polygonLayers.map(p => p.id)} strategy={verticalListSortingStrategy}>
                  {polygonLayers.map((polygon) => (
                    <SortablePolygonItem 
                      key={polygon.id}
                      polygon={polygon}
                      selectedPolygonId={selectedPolygonId}
                      onSelectPolygon={onSelectPolygon}
                      onUpdatePolygon={onUpdatePolygon}
                      onDeletePolygon={onDeletePolygon}
                      onDuplicatePolygon={onDuplicatePolygon}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {polygonLayers.length === 0 && (
                <div className="p-4 text-center text-xs text-gray-500">
                  No polygons created. Click "Draw Custom Polygon" or pick a shape preset above!
                </div>
              )}
            </div>
          </div>

          {/* Selected Polygon Controls */}
          {selectedPolygon && (
            <div className="p-3 border-t border-gray-800 bg-gray-900/90 flex flex-col min-h-[300px]">
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
                  {onDuplicatePolygon && (
                    <button
                      onClick={() => onDuplicatePolygon(selectedPolygon.id)}
                      className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                      title="Duplicate Polygon"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onMovePolygonUp && (
                    <button
                      onClick={() => onMovePolygonUp(selectedPolygon.id)}
                      className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                      title="Move Up in Order"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onMovePolygonDown && (
                    <button
                      onClick={() => onMovePolygonDown(selectedPolygon.id)}
                      className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                      title="Move Down in Order"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => onDeletePolygon(selectedPolygon.id)}
                    className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete Polygon"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1 mb-3 border-b border-gray-800 pb-2">
                <button
                  onClick={() => setPolyTab('texture')}
                  className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", polyTab === 'texture' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}
                >
                  Texture
                </button>
                <button
                  onClick={() => setPolyTab('style')}
                  className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", polyTab === 'style' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}
                >
                  Style
                </button>
                <button
                  onClick={() => setPolyTab('symmetry')}
                  className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", polyTab === 'symmetry' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}
                >
                  Symmetry
                </button>
                <button
                  onClick={() => setPolyTab('motion')}
                  className={cn("flex-1 text-[11px] font-medium py-1 rounded transition-colors", polyTab === 'motion' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200')}
                >
                  Motion
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1">
                {polyTab === 'texture' && (
                  <div className="space-y-3">
                    {/* Texture Scale Slider & Quick Presets */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-indigo-300">Texture Scale</span>
                        <span className="text-[11px] font-mono text-indigo-400 font-bold">{selectedPolygon.textureScale.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="5.0"
                        step="0.05"
                        value={selectedPolygon.textureScale}
                        onChange={(e) => onUpdatePolygon(selectedPolygon.id, { textureScale: parseFloat(e.target.value) })}
                        className="w-full accent-indigo-500 h-1.5"
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
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-300 flex items-center gap-1">
                          <Film className="w-3.5 h-3.5 text-indigo-400" /> Animated GIF Speed
                        </span>
                        <span className="text-[11px] font-mono text-gray-300">{(selectedPolygon.gifSpeed ?? 1).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="5"
                        step="0.1"
                        value={selectedPolygon.gifSpeed ?? 1}
                        onChange={(e) => onUpdatePolygon(selectedPolygon.id, { gifSpeed: parseFloat(e.target.value) })}
                        className="w-full accent-indigo-500 h-1"
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
                    <div className="pt-2 border-t border-gray-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-400">Texture Rotation</span>
                        <span className="text-[11px] font-mono">{Math.round(selectedPolygon.textureRotation)}&deg;</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        step="1"
                        value={selectedPolygon.textureRotation}
                        onChange={(e) => onUpdatePolygon(selectedPolygon.id, { textureRotation: parseFloat(e.target.value) })}
                        className="w-full accent-indigo-500 h-1"
                      />
                    </div>

                    {/* Texture Offset X & Y */}
                    <div className="pt-2 border-t border-gray-800 grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                          <span>Offset X</span>
                          <span>{Math.round(selectedPolygon.textureOffsetX)}px</span>
                        </div>
                        <input
                          type="range"
                          min="-500"
                          max="500"
                          step="5"
                          value={selectedPolygon.textureOffsetX}
                          onChange={(e) => onUpdatePolygon(selectedPolygon.id, { textureOffsetX: parseFloat(e.target.value) })}
                          className="w-full accent-indigo-500 h-1"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                          <span>Offset Y</span>
                          <span>{Math.round(selectedPolygon.textureOffsetY)}px</span>
                        </div>
                        <input
                          type="range"
                          min="-500"
                          max="500"
                          step="5"
                          value={selectedPolygon.textureOffsetY}
                          onChange={(e) => onUpdatePolygon(selectedPolygon.id, { textureOffsetY: parseFloat(e.target.value) })}
                          className="w-full accent-indigo-500 h-1"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {polyTab === 'style' && (
                  <div className="space-y-3">
                    {/* Opacity */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-400">Opacity</span>
                        <span className="text-[11px] font-mono">{Math.round(selectedPolygon.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedPolygon.opacity}
                        onChange={(e) => onUpdatePolygon(selectedPolygon.id, { opacity: parseFloat(e.target.value) })}
                        className="w-full accent-indigo-500 h-1"
                      />
                    </div>

                    {/* Blend Mode */}
                    <div className="pt-2 border-t border-gray-800">
                      <label className="text-[11px] text-gray-400 mb-1 block">Blend Mode</label>
                      <select
                        value={selectedPolygon.blendMode}
                        onChange={(e) => onUpdatePolygon(selectedPolygon.id, { blendMode: e.target.value as BlendMode })}
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        {BLEND_MODES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>

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

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-gray-400">Border Width</span>
                          <span className="text-[11px] font-mono">{selectedPolygon.strokeWidth}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="20"
                          step="1"
                          value={selectedPolygon.strokeWidth}
                          onChange={(e) => onUpdatePolygon(selectedPolygon.id, { strokeWidth: parseInt(e.target.value) })}
                          className="w-full accent-indigo-500 h-1"
                        />
                      </div>
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
                        <div className="-mt-2 border border-t-0 border-gray-800 p-2 rounded-b bg-gray-800/30">
                          <div className="flex justify-between text-[9px] text-gray-400 mb-1">
                            <span>Incoherence (desync per vertex)</span>
                            <span>{Math.round(selectedPolygon.vertexNoise.incoherence * 100)}%</span>
                          </div>
                          <input
                            type="range" min="0" max="1" step="0.05"
                            value={selectedPolygon.vertexNoise.incoherence}
                            onChange={(e) => onUpdatePolygon(selectedPolygon.id, {
                              vertexNoise: { ...selectedPolygon.vertexNoise!, incoherence: parseFloat(e.target.value) }
                            })}
                            className="w-full accent-indigo-500 h-1"
                          />
                        </div>
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
          )}
        </>
      )}
    </div>
  );
}
