import React, { useRef } from 'react';
import { Image as ImageIcon, Shapes, PenTool, Sparkles, Undo2, Redo2, Save, FolderOpen, Layers, PanelLeftOpen, Box, Eye, EyeOff, Trash2 } from 'lucide-react';
import { redo, undo, useStore } from '../../store';
import { cn } from '../../lib/utils';
import { openProject, saveProject } from '../../lib/project';
import { isNative, openProjectViaDialog } from '../../lib/native';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Segmented, { SegmentedOption } from '../controls/Segmented';
import ResizeHandle from '../controls/ResizeHandle';
import { usePanelState } from '../../hooks/usePanelState';
import LayerRow from './LayerRow';
import PolygonRow from './PolygonRow';
import { Mesh3dPrimitive } from '../../types';

const STACK_PANEL_DEFAULTS = { storageKey: 'slapchop:panel:stack', defaultWidth: 264, minWidth: 200, maxWidth: 420, side: 'left' as const };

type AppModeValue = 'symmetry' | 'polygon' | '3d';

const MODE_OPTIONS: SegmentedOption<AppModeValue>[] = [
  { value: 'symmetry', label: <><Sparkles className="w-3.5 h-3.5" />Symmetry</> },
  { value: 'polygon', label: <><Shapes className="w-3.5 h-3.5" />Tiled GIF</> },
  { value: '3d', label: <><Box className="w-3.5 h-3.5" />3D Space</> }
];

// [primitive, emoji, label] for the "Add Mesh" grid below. Kept as a plain
// preset list (like the polygon shape presets above it) rather than a full
// geometry picker UI, which belongs to the 3D inspector's Geometry tab.
const MESH3D_PRESETS: [Mesh3dPrimitive, string, string][] = [
  ['plane', '▭', 'Plane'],
  ['box', '🧊', 'Box'],
  ['cylinder', '🥫', 'Cylinder'],
  ['torus', '🍩', 'Torus'],
  ['sphere', '🔮', 'Sphere'],
  ['ribbon', '🎀', 'Ribbon'],
  ['extruded-polygon', '⬡', 'Extruded']
];

export default function StackPanel() {
  const appMode = useStore(s => s.appMode);
  const onModeChange = useStore(s => s.setAppMode);
  const layers = useStore(s => s.layers);
  const selectedLayerId = useStore(s => s.selectedLayerId);
  const onSelectLayer = useStore(s => s.selectLayer);
  const onUpdateLayer = useStore(s => s.updateLayer);
  const onDeleteLayer = useStore(s => s.deleteLayer);
  const onDuplicateLayer = useStore(s => s.duplicateLayer);
  const onReorderLayers = useStore(s => s.reorderLayers);
  const onAddLayer = useStore(s => s.addLayerFromFile);
  const polygonLayers = useStore(s => s.polygonLayers);
  const selectedPolygonId = useStore(s => s.selectedPolygonId);
  const onSelectPolygon = useStore(s => s.selectPolygon);
  const onUpdatePolygon = useStore(s => s.updatePolygon);
  const onDeletePolygon = useStore(s => s.deletePolygon);
  const onDuplicatePolygon = useStore(s => s.duplicatePolygon);
  const onReorderPolygons = useStore(s => s.reorderPolygons);
  const onAddPresetPolygon = useStore(s => s.addPresetPolygon);
  const isDrawingPolygon = useStore(s => s.isDrawingPolygon);
  const onToggleDrawPolygon = useStore(s => s.toggleDrawPolygon);
  const onUploadPolygonTexture = useStore(s => s.uploadPolygonTexture);
  const mesh3dLayers = useStore(s => s.mesh3dLayers);
  const selectedMesh3dId = useStore(s => s.selectedMesh3dId);
  const onSelectMesh3d = useStore(s => s.selectMesh3d);
  const onAddMesh3dPreset = useStore(s => s.addMesh3dPreset);
  const onUpdateMesh3d = useStore(s => s.updateMesh3d);
  const onDeleteMesh3d = useStore(s => s.deleteMesh3d);

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

  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);
  const isSceneActive = appMode === 'symmetry' ? !selectedLayerId : appMode === 'polygon' ? !selectedPolygonId : !selectedMesh3dId;
  const selectScene = () => {
    if (appMode === 'symmetry') onSelectLayer(null);
    else if (appMode === 'polygon') onSelectPolygon(null);
    else onSelectMesh3d(null);
  };

  const { width, collapsed, toggleCollapsed, startResize } = usePanelState(STACK_PANEL_DEFAULTS);

  if (collapsed) {
    return (
      <div className="w-11 bg-gray-900 border-r border-gray-800 flex flex-col items-center h-screen shrink-0 pt-4">
        <button
          onClick={toggleCollapsed}
          className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
          title="Expand Stack panel"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-gray-900 border-r border-gray-800 flex flex-col h-screen text-gray-200 shrink-0" style={{ width }}>
      {/* Header & Mode Switcher */}
      <div className="p-4 border-b border-gray-800 shrink-0">
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
         <Segmented
           variant="mode"
           label="Editing mode"
           className="mt-3"
           value={appMode}
           onChange={onModeChange}
           options={MODE_OPTIONS}
         />
      </div>

      {/* MODE 1: SYMMETRY LAYERS */}
      {appMode === 'symmetry' && (
        <>
          <div className="p-4 border-b border-gray-800 shrink-0">
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
                    <LayerRow
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
        </>
      )}

      {/* MODE 2: POLYGON GIF TILER */}
      {appMode === 'polygon' && (
        <>
          {/* Polygon Creation Controls */}
          <div className="p-3 border-b border-gray-800 space-y-3 shrink-0">
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
                    <PolygonRow
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
        </>
      )}

      {/* MODE 3: 3D MESH SPACE. This is a minimal preset-add + select/hide/
          delete list to make the renderer reachable and smoke-testable;
          the full row (drag reorder, duplicate, texture upload per-row) and
          the 3D inspector tabs are Component 4 of the 3D mode plan, not yet
          built. */}
      {appMode === '3d' && (
        <>
          <div className="p-3 border-b border-gray-800 space-y-3 shrink-0">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Add Mesh</label>
              <div className="grid grid-cols-4 gap-1">
                {MESH3D_PRESETS.map(([primitive, emoji, label]) => (
                  <button
                    key={primitive}
                    onClick={() => onAddMesh3dPreset(primitive)}
                    className="py-1.5 px-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-[11px] border border-gray-700 flex flex-col items-center gap-1"
                    title={label}
                  >
                    <span className="text-xs">{emoji}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 relative">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm px-4 py-2 border-b border-gray-800 z-10 flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Meshes ({mesh3dLayers.length})</label>
            </div>

            <div className="p-2 space-y-1">
              {mesh3dLayers.map((mesh) => (
                <div
                  key={mesh.id}
                  onClick={() => onSelectMesh3d(mesh.id)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer border",
                    selectedMesh3dId === mesh.id ? "bg-indigo-900/30 border-indigo-700 text-indigo-200" : "border-transparent hover:bg-gray-800 text-gray-300"
                  )}
                >
                  <span className="flex-1 truncate">{mesh.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onUpdateMesh3d(mesh.id, { hidden: !mesh.hidden }); }}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                    title={mesh.hidden ? 'Show' : 'Hide'}
                  >
                    {mesh.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteMesh3d(mesh.id); }}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {mesh3dLayers.length === 0 && (
                <div className="p-4 text-center text-xs text-gray-500">No meshes yet. Add a primitive above to start.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Docked Scene row: Scene is a selection, not a section — clicking it
          deselects the current layer/polygon and points the Inspector at
          its Scene tab, which now holds the document-wide controls
          (background, Master FX) this row used to render inline above the
          list, permanently shrinking it. */}
      <div className="shrink-0 border-t border-gray-800">
        <button
          onClick={selectScene}
          className={cn(
            "w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors",
            isSceneActive ? "text-indigo-300 bg-indigo-900/20" : "text-gray-400 hover:bg-gray-800/60"
          )}
        >
          <Layers className="w-3.5 h-3.5" />
          Scene
        </button>
      </div>

      <ResizeHandle side="left" panelLabel="Stack panel" onResizeStart={startResize} onCollapse={toggleCollapsed} />
    </div>
  );
}
