import React, { useEffect, useRef } from 'react';
import { Image as ImageIcon, Shapes, PenTool, Sparkles, Undo2, Redo2, Save, FolderOpen, Layers, PanelLeftOpen, Box, Rocket, FolderInput, Trash2 } from 'lucide-react';
import { redo, undo, useStore } from '../../store';
import { cn } from '../../lib/utils';
import { openProject, saveProject } from '../../lib/project';
import { isNative, openProjectViaDialog, pickGifFolder } from '../../lib/native';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import ModePicker, { ModeOption } from '../controls/ModePicker';
import ResizeHandle from '../controls/ResizeHandle';
import { usePanelState } from '../../hooks/usePanelState';
import LayerRow from './LayerRow';
import PolygonRow from './PolygonRow';
import Mesh3dRow from './Mesh3dRow';
import { AppMode, Mesh3dPrimitive } from '../../types';
import { MESH3D_PRIMITIVE_EMOJI } from '../../lib/mesh3dUtils';

const STACK_PANEL_DEFAULTS = { storageKey: 'slapchop:panel:stack', defaultWidth: 264, minWidth: 200, maxWidth: 420, side: 'left' as const };

const MODE_OPTIONS: ModeOption<AppMode>[] = [
  { value: 'symmetry', label: 'Symmetry', description: 'Layered mirrors & radial repeats', icon: Sparkles },
  { value: 'polygon', label: 'Tiled GIF', description: 'Texture-filled polygon mosaics', icon: Shapes },
  { value: '3d', label: '3D Space', description: 'Textured meshes & camera depth', icon: Box },
  { value: 'flythrough', label: 'GIF Flythrough', description: 'Folder-fed planes rushing through space', icon: Rocket }
];

// [primitive, label] for the "Add Mesh" grid below. Kept as a plain preset
// list (like the polygon shape presets above it) rather than a full geometry
// picker UI, which belongs to the 3D inspector's Geometry tab. Emoji come
// from the shared MESH3D_PRIMITIVE_EMOJI map so this grid and Mesh3dRow's
// thumbnail stay visually consistent.
const MESH3D_PRESETS: [Mesh3dPrimitive, string][] = [
  ['plane', 'Plane'],
  ['box', 'Box'],
  ['cylinder', 'Cylinder'],
  ['torus', 'Torus'],
  ['sphere', 'Sphere'],
  ['ribbon', 'Ribbon'],
  ['extruded-polygon', 'Extruded']
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
  const onDuplicateMesh3d = useStore(s => s.duplicateMesh3d);
  const onReorderMesh3d = useStore(s => s.reorderMesh3d);
  const onUploadMesh3dTexture = useStore(s => s.uploadMesh3dTexture);
  const flythroughAssets = useStore(s => s.flythroughAssets);
  const onReplaceFlythroughAssets = useStore(s => s.replaceFlythroughAssets);
  const onRemoveFlythroughAsset = useStore(s => s.removeFlythroughAsset);
  const onClearFlythroughAssets = useStore(s => s.clearFlythroughAssets);

  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const flythroughFolderInputRef = useRef<HTMLInputElement>(null);
  const flythroughFilesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = flythroughFolderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

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

  const handleDragEndMesh3d = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderMesh3d(active.id as string, over.id as string);
    }
  };

  // Selecting is a synchronous store write, so by the time the async
  // uploadMesh3dTexture reads selectedMesh3dId back out of the store (after
  // the file read and GIF parse), it sees this row's id rather than
  // whatever was selected when the file dialog opened.
  const handleMesh3dRowTextureUpload = (id: string, file: File) => {
    onSelectMesh3d(id);
    onUploadMesh3dTexture(file);
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

  const handleFlythroughFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) void onReplaceFlythroughAssets(files);
  };

  const handleChooseFlythroughFolder = async () => {
    if (!isNative()) {
      flythroughFolderInputRef.current?.click();
      return;
    }
    const files = await pickGifFolder();
    if (files) await onReplaceFlythroughAssets(files);
  };

  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);
  const isSceneActive = appMode === 'symmetry'
    ? !selectedLayerId
    : appMode === 'polygon'
      ? !selectedPolygonId
      : appMode === '3d' ? !selectedMesh3dId : true;
  const selectScene = () => {
    if (appMode === 'symmetry') onSelectLayer(null);
    else if (appMode === 'polygon') onSelectPolygon(null);
    else if (appMode === '3d') onSelectMesh3d(null);
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

         <ModePicker
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

      {/* MODE 3: 3D MESH SPACE */}
      {appMode === '3d' && (
        <>
          <div className="p-3 border-b border-gray-800 space-y-3 shrink-0">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Add Mesh</label>
              <div className="grid grid-cols-4 gap-1">
                {MESH3D_PRESETS.map(([primitive, label]) => (
                  <button
                    key={primitive}
                    onClick={() => onAddMesh3dPreset(primitive)}
                    className="py-1.5 px-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-[11px] border border-gray-700 flex flex-col items-center gap-1"
                    title={label}
                  >
                    <span className="text-xs">{MESH3D_PRIMITIVE_EMOJI[primitive]}</span>
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndMesh3d}
              >
                <SortableContext items={mesh3dLayers.map(m => m.id)} strategy={verticalListSortingStrategy}>
                  {mesh3dLayers.map((mesh) => (
                    <Mesh3dRow
                      key={mesh.id}
                      mesh={mesh}
                      selectedMesh3dId={selectedMesh3dId}
                      onSelectMesh3d={onSelectMesh3d}
                      onUpdateMesh3d={onUpdateMesh3d}
                      onDeleteMesh3d={onDeleteMesh3d}
                      onDuplicateMesh3d={onDuplicateMesh3d}
                      onUploadTexture={handleMesh3dRowTextureUpload}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {mesh3dLayers.length === 0 && (
                <div className="p-4 text-center text-xs text-gray-500">No meshes yet. Add a primitive above to start.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* MODE 4: GIF FLYTHROUGH */}
      {appMode === 'flythrough' && (
        <>
          <div className="p-3 border-b border-cyan-950/80 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.1),transparent_62%)] shrink-0">
            <button
              type="button"
              onClick={() => void handleChooseFlythroughFolder()}
              className="group relative w-full overflow-hidden rounded-lg border border-cyan-800/70 bg-cyan-950/35 px-3 py-3 text-left hover:bg-cyan-950/55 hover:border-cyan-600/80 transition-all"
            >
              <div className="absolute inset-y-0 left-0 w-0.5 bg-cyan-400" />
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-cyan-400/10 text-cyan-300 group-hover:text-cyan-200">
                  <FolderInput className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-cyan-100">Choose GIF folder</div>
                  <div className="text-[10px] text-cyan-700 mt-0.5">Replaces the current flight library</div>
                </div>
              </div>
            </button>
            <input ref={flythroughFolderInputRef} type="file" multiple accept="image/gif,.gif" className="hidden" onChange={handleFlythroughFolderChange} />
            <button
              type="button"
              onClick={() => flythroughFilesInputRef.current?.click()}
              className="w-full mt-2 py-1 text-[10px] text-gray-500 hover:text-cyan-300 transition-colors"
            >
              Or choose individual GIF files
            </button>
            <input ref={flythroughFilesInputRef} type="file" multiple accept="image/gif,.gif" className="hidden" onChange={handleFlythroughFolderChange} />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 relative">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm px-4 py-2 border-b border-gray-800 z-10 flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Flight Library ({flythroughAssets.length})</label>
              {flythroughAssets.length > 0 && (
                <button type="button" onClick={onClearFlythroughAssets} className="text-[10px] text-gray-500 hover:text-red-300 transition-colors">Clear</button>
              )}
            </div>
            <div className="p-2 space-y-1">
              {flythroughAssets.map((asset, index) => (
                <div key={asset.id} className="group flex items-center gap-2 p-1.5 rounded border border-transparent hover:border-gray-700 hover:bg-gray-800/60">
                  <div className="relative w-10 h-10 rounded bg-black overflow-hidden border border-gray-800 shrink-0">
                    <img src={asset.src} alt="" className="w-full h-full object-contain" />
                    <span className="absolute bottom-0 right-0 px-1 bg-black/80 text-[8px] font-mono text-cyan-300">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-gray-200 truncate" title={asset.name}>{asset.name}</div>
                    <div className="text-[9px] font-mono text-gray-600">
                      {asset.width ?? asset.gifData?.width ?? '?'}×{asset.height ?? asset.gifData?.height ?? '?'}
                    </div>
                  </div>
                  <button type="button" onClick={() => onRemoveFlythroughAsset(asset.id)} className="p-1 text-gray-600 hover:text-red-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all" title={`Remove ${asset.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {flythroughAssets.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <Rocket className="w-6 h-6 mx-auto text-cyan-900 mb-2" />
                  <p className="text-xs text-gray-500">Point Slapchop at a folder of GIFs to launch the field.</p>
                </div>
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
