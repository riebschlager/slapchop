import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  AppMode,
  Camera3dConfig,
  DEFAULT_CAMERA3D,
  DEFAULT_FLYTHROUGH,
  DEFAULT_MASTER_FX,
  DEFAULT_TUNNEL,
  FlythroughAsset,
  FlythroughConfig,
  Layer,
  MasterFxConfig,
  Mesh3dLayer,
  Mesh3dPrimitive,
  PolygonLayer,
  PolygonPoint,
  TunnelAsset,
  TunnelConfig
} from './types';
import { parseGifFile } from './lib/gifUtils';
import { createNewPolygonLayer, createPresetPolygonPoints } from './lib/polygonUtils';
import { createMesh3dLayer, createMesh3dPresetName } from './lib/mesh3dUtils';

export interface DocumentState {
  layers: Layer[];
  polygonLayers: PolygonLayer[];
  mesh3dLayers: Mesh3dLayer[];
  camera3d: Camera3dConfig;
  flythroughAssets: FlythroughAsset[];
  flythrough: FlythroughConfig;
  tunnelAssets: TunnelAsset[];
  tunnel: TunnelConfig;
  canvasBg: string;
  masterFx: MasterFxConfig;
}

export interface AppState extends DocumentState {
  appMode: AppMode;
  selectedLayerId: string | null;
  selectedPolygonId: string | null;
  selectedMesh3dId: string | null;
  isDrawingPolygon: boolean;

  setAppMode: (mode: AppMode) => void;
  setCanvasBg: (color: string) => void;
  loadDocument: (doc: DocumentState) => void;

  // Master FX
  updateMasterFx: (updates: Partial<MasterFxConfig>) => void;
  applyFxPreset: (preset: Partial<MasterFxConfig>) => void;
  resetMasterFx: () => void;

  // Symmetry layers
  addLayerFromFile: (file: File, x?: number, y?: number) => Promise<void>;
  selectLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayers: (activeId: string, overId: string) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;

  // Polygon layers
  addPresetPolygon: (type: 'triangle' | 'rectangle' | 'star' | 'hexagon') => void;
  uploadPolygonTexture: (file: File) => Promise<void>;
  finishDrawingPolygon: (points: PolygonPoint[]) => void;
  selectPolygon: (id: string | null) => void;
  updatePolygon: (id: string, updates: Partial<PolygonLayer>) => void;
  deletePolygon: (id: string) => void;
  duplicatePolygon: (id: string) => void;
  reorderPolygons: (activeId: string, overId: string) => void;
  movePolygonUp: (id: string) => void;
  movePolygonDown: (id: string) => void;
  toggleDrawPolygon: () => void;

  // 3D mesh layers
  addMesh3dPreset: (primitive: Mesh3dPrimitive) => void;
  uploadMesh3dTexture: (file: File) => Promise<void>;
  selectMesh3d: (id: string | null) => void;
  updateMesh3d: (id: string, updates: Partial<Mesh3dLayer>) => void;
  deleteMesh3d: (id: string) => void;
  duplicateMesh3d: (id: string) => void;
  reorderMesh3d: (activeId: string, overId: string) => void;
  moveMesh3dUp: (id: string) => void;
  moveMesh3dDown: (id: string) => void;
  updateCamera3d: (updates: Partial<Camera3dConfig>) => void;

  // GIF flythrough library and scene
  replaceFlythroughAssets: (files: File[]) => Promise<void>;
  removeFlythroughAsset: (id: string) => void;
  clearFlythroughAssets: () => void;
  updateFlythrough: (updates: Partial<FlythroughConfig>) => void;
  reseedFlythrough: () => void;

  // GIF tunnel wallpaper library and procedural scene
  replaceTunnelAssets: (files: File[]) => Promise<void>;
  addTunnelAssets: (files: File[]) => Promise<void>;
  removeTunnelAsset: (id: string) => void;
  clearTunnelAssets: () => void;
  reorderTunnelAssets: (activeId: string, overId: string) => void;
  updateTunnel: (updates: Partial<TunnelConfig>) => void;
  reseedTunnel: () => void;
}

function reorder<T extends { id: string }>(items: T[], activeId: string, overId: string): T[] {
  const oldIndex = items.findIndex(item => item.id === activeId);
  const newIndex = items.findIndex(item => item.id === overId);
  if (oldIndex === -1 || newIndex === -1) return items;
  const next = [...items];
  const [removed] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, removed);
  return next;
}

function swap<T>(items: T[], i: number, j: number): T[] {
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

const TUNNEL_IMAGE_EXTENSIONS = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp']);

async function tunnelAssetsFromFiles(files: File[]): Promise<TunnelAsset[]> {
  const images = files.filter(file => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    return file.type.startsWith('image/') || TUNNEL_IMAGE_EXTENSIONS.has(extension);
  });
  return Promise.all(images.map(async (file): Promise<TunnelAsset> => {
    const gifData = await parseGifFile(file);
    let width = gifData?.width;
    let height = gifData?.height;
    if (!width || !height) {
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // Static textures can still load from the object URL. Unknown source
        // dimensions use a square crop until the browser image is available.
      }
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      src: URL.createObjectURL(file),
      gifData: gifData || undefined,
      width,
      height
    };
  }));
}

const INITIAL_POLYGON = createNewPolygonLayer(
  'Hexagon Tile',
  createPresetPolygonPoints('hexagon', 220),
  { textureScale: 0.5, strokeColor: '#818cf8', strokeWidth: 3, fillColor: '#4f46e5' }
);

export const useStore = create<AppState>()(
  temporal(
    (set, get) => ({
      layers: [],
      polygonLayers: [INITIAL_POLYGON],
      mesh3dLayers: [],
      camera3d: { ...DEFAULT_CAMERA3D },
      flythroughAssets: [],
      flythrough: { ...DEFAULT_FLYTHROUGH },
      tunnelAssets: [],
      tunnel: { ...DEFAULT_TUNNEL, palette: [...DEFAULT_TUNNEL.palette] },
      canvasBg: '#000000',
      masterFx: { ...DEFAULT_MASTER_FX },
      appMode: 'symmetry',
      selectedLayerId: null,
      selectedPolygonId: INITIAL_POLYGON.id,
      selectedMesh3dId: null,
      isDrawingPolygon: false,

      setAppMode: (mode) => set({ appMode: mode, isDrawingPolygon: false }),
      setCanvasBg: (color) => set({ canvasBg: color }),
      loadDocument: (doc) => set({
        layers: doc.layers,
        polygonLayers: doc.polygonLayers,
        mesh3dLayers: doc.mesh3dLayers ?? [],
        camera3d: doc.camera3d ? { ...DEFAULT_CAMERA3D, ...doc.camera3d } : { ...DEFAULT_CAMERA3D },
        flythroughAssets: doc.flythroughAssets ?? [],
        flythrough: doc.flythrough ? { ...DEFAULT_FLYTHROUGH, ...doc.flythrough } : { ...DEFAULT_FLYTHROUGH },
        tunnelAssets: doc.tunnelAssets ?? [],
        tunnel: doc.tunnel
          ? { ...DEFAULT_TUNNEL, ...doc.tunnel, palette: [...(doc.tunnel.palette ?? DEFAULT_TUNNEL.palette)] }
          : { ...DEFAULT_TUNNEL, palette: [...DEFAULT_TUNNEL.palette] },
        canvasBg: doc.canvasBg,
        masterFx: doc.masterFx ? { ...DEFAULT_MASTER_FX, ...doc.masterFx } : { ...DEFAULT_MASTER_FX },
        selectedLayerId: null,
        selectedPolygonId: null,
        selectedMesh3dId: null,
        isDrawingPolygon: false
      }),

      updateMasterFx: (updates) => set(s => ({
        masterFx: { ...s.masterFx, ...updates }
      })),
      applyFxPreset: (preset) => set(s => ({
        masterFx: { ...s.masterFx, ...preset }
      })),
      resetMasterFx: () => set({
        masterFx: { ...DEFAULT_MASTER_FX }
      }),

      addLayerFromFile: async (file, x = 0, y = 0) => {
        const url = URL.createObjectURL(file);
        const gifData = await parseGifFile(file);
        const newLayer: Layer = {
          id: crypto.randomUUID(),
          name: file.name,
          src: url,
          gifData: gifData || undefined,
          x, y,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          symmetry: 'none',
          radialSegments: 6,
          blendMode: 'screen',
          opacity: 1
        };
        set(s => ({ layers: [...s.layers, newLayer], selectedLayerId: newLayer.id }));
      },
      selectLayer: (id) => set({ selectedLayerId: id }),
      updateLayer: (id, updates) => set(s => ({
        layers: s.layers.map(l => l.id === id ? { ...l, ...updates } : l)
      })),
      deleteLayer: (id) => set(s => ({
        layers: s.layers.filter(l => l.id !== id),
        selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId
      })),
      duplicateLayer: (id) => {
        const layer = get().layers.find(l => l.id === id);
        if (!layer) return;
        const clone: Layer = {
          ...layer,
          id: crypto.randomUUID(),
          name: `${layer.name} (Copy)`,
          x: layer.x + 40,
          y: layer.y + 40
        };
        set(s => ({ layers: [...s.layers, clone], selectedLayerId: clone.id }));
      },
      reorderLayers: (activeId, overId) => set(s => ({ layers: reorder(s.layers, activeId, overId) })),
      moveLayerUp: (id) => set(s => {
        const i = s.layers.findIndex(l => l.id === id);
        return i <= 0 ? s : { layers: swap(s.layers, i, i - 1) };
      }),
      moveLayerDown: (id) => set(s => {
        const i = s.layers.findIndex(l => l.id === id);
        return i === -1 || i >= s.layers.length - 1 ? s : { layers: swap(s.layers, i, i + 1) };
      }),

      addPresetPolygon: (type) => {
        const pts = createPresetPolygonPoints(type, 200);
        const newPoly = createNewPolygonLayer(
          `${type.charAt(0).toUpperCase() + type.slice(1)} ${get().polygonLayers.length + 1}`,
          pts,
          { textureScale: 0.5, strokeColor: '#818cf8', strokeWidth: 3, fillColor: '#6366f1' }
        );
        set(s => ({ polygonLayers: [...s.polygonLayers, newPoly], selectedPolygonId: newPoly.id }));
      },
      uploadPolygonTexture: async (file) => {
        const url = URL.createObjectURL(file);
        const gifData = await parseGifFile(file);
        const selectedId = get().selectedPolygonId;
        if (selectedId) {
          set(s => ({
            polygonLayers: s.polygonLayers.map(p => p.id === selectedId
              ? { ...p, src: url, gifData: gifData || undefined }
              : p)
          }));
        } else {
          const newPoly = createNewPolygonLayer(
            file.name,
            createPresetPolygonPoints('hexagon', 220),
            { src: url, gifData: gifData || undefined, textureScale: 0.5, strokeColor: '#ffffff', strokeWidth: 2 }
          );
          set(s => ({ polygonLayers: [...s.polygonLayers, newPoly], selectedPolygonId: newPoly.id }));
        }
      },
      finishDrawingPolygon: (points) => {
        if (points.length < 3) return;
        const newPoly = createNewPolygonLayer(
          `Custom Polygon ${get().polygonLayers.length + 1}`,
          points,
          { textureScale: 0.5, strokeColor: '#c084fc', strokeWidth: 3, fillColor: '#8b5cf6' }
        );
        set(s => ({
          polygonLayers: [...s.polygonLayers, newPoly],
          selectedPolygonId: newPoly.id,
          isDrawingPolygon: false
        }));
      },
      selectPolygon: (id) => set({ selectedPolygonId: id }),
      updatePolygon: (id, updates) => set(s => ({
        polygonLayers: s.polygonLayers.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      deletePolygon: (id) => set(s => ({
        polygonLayers: s.polygonLayers.filter(p => p.id !== id),
        selectedPolygonId: s.selectedPolygonId === id ? null : s.selectedPolygonId
      })),
      duplicatePolygon: (id) => {
        const poly = get().polygonLayers.find(p => p.id === id);
        if (!poly) return;
        const clone: PolygonLayer = {
          ...poly,
          id: crypto.randomUUID(),
          name: `${poly.name} (Copy)`,
          points: poly.points.map(pt => ({ x: pt.x + 30, y: pt.y + 30 }))
        };
        set(s => ({ polygonLayers: [...s.polygonLayers, clone], selectedPolygonId: clone.id }));
      },
      reorderPolygons: (activeId, overId) => set(s => ({ polygonLayers: reorder(s.polygonLayers, activeId, overId) })),
      movePolygonUp: (id) => set(s => {
        const i = s.polygonLayers.findIndex(p => p.id === id);
        return i <= 0 ? s : { polygonLayers: swap(s.polygonLayers, i, i - 1) };
      }),
      movePolygonDown: (id) => set(s => {
        const i = s.polygonLayers.findIndex(p => p.id === id);
        return i === -1 || i >= s.polygonLayers.length - 1 ? s : { polygonLayers: swap(s.polygonLayers, i, i + 1) };
      }),
      toggleDrawPolygon: () => set(s => ({ isDrawingPolygon: !s.isDrawingPolygon })),

      addMesh3dPreset: (primitive) => {
        const name = createMesh3dPresetName(primitive, get().mesh3dLayers.length);
        const newMesh = createMesh3dLayer(name, primitive);
        set(s => ({ mesh3dLayers: [...s.mesh3dLayers, newMesh], selectedMesh3dId: newMesh.id }));
      },
      uploadMesh3dTexture: async (file) => {
        const url = URL.createObjectURL(file);
        const gifData = await parseGifFile(file);
        const selectedId = get().selectedMesh3dId;
        if (selectedId) {
          set(s => ({
            mesh3dLayers: s.mesh3dLayers.map(m => m.id === selectedId
              ? { ...m, src: url, gifData: gifData || undefined }
              : m)
          }));
        } else {
          const newMesh = createMesh3dLayer(file.name, 'plane', { src: url, gifData: gifData || undefined });
          set(s => ({ mesh3dLayers: [...s.mesh3dLayers, newMesh], selectedMesh3dId: newMesh.id }));
        }
      },
      selectMesh3d: (id) => set({ selectedMesh3dId: id }),
      updateMesh3d: (id, updates) => set(s => ({
        mesh3dLayers: s.mesh3dLayers.map(m => m.id === id ? { ...m, ...updates } : m)
      })),
      deleteMesh3d: (id) => set(s => ({
        mesh3dLayers: s.mesh3dLayers.filter(m => m.id !== id),
        selectedMesh3dId: s.selectedMesh3dId === id ? null : s.selectedMesh3dId
      })),
      duplicateMesh3d: (id) => {
        const mesh = get().mesh3dLayers.find(m => m.id === id);
        if (!mesh) return;
        const clone: Mesh3dLayer = {
          ...mesh,
          id: crypto.randomUUID(),
          name: `${mesh.name} (Copy)`,
          x: mesh.x + 40,
          y: mesh.y + 40
        };
        set(s => ({ mesh3dLayers: [...s.mesh3dLayers, clone], selectedMesh3dId: clone.id }));
      },
      reorderMesh3d: (activeId, overId) => set(s => ({ mesh3dLayers: reorder(s.mesh3dLayers, activeId, overId) })),
      moveMesh3dUp: (id) => set(s => {
        const i = s.mesh3dLayers.findIndex(m => m.id === id);
        return i <= 0 ? s : { mesh3dLayers: swap(s.mesh3dLayers, i, i - 1) };
      }),
      moveMesh3dDown: (id) => set(s => {
        const i = s.mesh3dLayers.findIndex(m => m.id === id);
        return i === -1 || i >= s.mesh3dLayers.length - 1 ? s : { mesh3dLayers: swap(s.mesh3dLayers, i, i + 1) };
      }),
      updateCamera3d: (updates) => set(s => ({ camera3d: { ...s.camera3d, ...updates } })),

      replaceFlythroughAssets: async (files) => {
        const gifs = files.filter(file => file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif'));
        const assets = await Promise.all(gifs.map(async (file): Promise<FlythroughAsset> => {
          const gifData = await parseGifFile(file);
          let width = gifData?.width;
          let height = gifData?.height;
          if (!width || !height) {
            try {
              const bitmap = await createImageBitmap(file);
              width = bitmap.width;
              height = bitmap.height;
              bitmap.close();
            } catch {
              // The renderer can still load the object URL; square is the
              // narrow fallback only when the platform cannot inspect it.
            }
          }
          return {
            id: crypto.randomUUID(),
            name: file.name,
            src: URL.createObjectURL(file),
            gifData: gifData || undefined,
            width,
            height
          };
        }));
        set({ flythroughAssets: assets });
      },
      removeFlythroughAsset: (id) => set(s => {
        // Keep the source alive while zundo can still restore this document
        // entry. GPU textures are released immediately by the mode renderer.
        return { flythroughAssets: s.flythroughAssets.filter(item => item.id !== id) };
      }),
      clearFlythroughAssets: () => set({ flythroughAssets: [] }),
      updateFlythrough: (updates) => set(s => ({ flythrough: { ...s.flythrough, ...updates } })),
      reseedFlythrough: () => set(s => ({
        flythrough: { ...s.flythrough, seed: (s.flythrough.seed + 1) % 100000 }
      })),

      replaceTunnelAssets: async (files) => set({ tunnelAssets: await tunnelAssetsFromFiles(files) }),
      addTunnelAssets: async (files) => {
        const assets = await tunnelAssetsFromFiles(files);
        set(s => ({ tunnelAssets: [...s.tunnelAssets, ...assets] }));
      },
      removeTunnelAsset: (id) => set(s => ({
        tunnelAssets: s.tunnelAssets.filter(asset => asset.id !== id)
      })),
      clearTunnelAssets: () => set({ tunnelAssets: [] }),
      reorderTunnelAssets: (activeId, overId) => set(s => ({
        tunnelAssets: reorder(s.tunnelAssets, activeId, overId)
      })),
      updateTunnel: (updates) => set(s => ({
        tunnel: { ...s.tunnel, ...updates }
      })),
      reseedTunnel: () => set(s => ({
        tunnel: { ...s.tunnel, seed: (s.tunnel.seed + 1) % 100000 }
      }))
    }),
    {
      // Undo history tracks the document only — selection, mode, and drawing
      // state stay outside so undo never "jumps" the UI around.
      partialize: (s) => ({
        layers: s.layers,
        polygonLayers: s.polygonLayers,
        mesh3dLayers: s.mesh3dLayers,
        camera3d: s.camera3d,
        flythroughAssets: s.flythroughAssets,
        flythrough: s.flythrough,
        tunnelAssets: s.tunnelAssets,
        tunnel: s.tunnel,
        canvasBg: s.canvasBg,
        masterFx: s.masterFx
      }),
      equality: (a, b) =>
        a.layers === b.layers && a.polygonLayers === b.polygonLayers && a.mesh3dLayers === b.mesh3dLayers
        && a.camera3d === b.camera3d && a.flythroughAssets === b.flythroughAssets
        && a.flythrough === b.flythrough && a.tunnelAssets === b.tunnelAssets
        && a.tunnel === b.tunnel && a.canvasBg === b.canvasBg && a.masterFx === b.masterFx,
      limit: 100,
      // Coalesce rapid bursts (slider scrubs) into few history entries.
      handleSet: (handleSet) => {
        let lastTime = 0;
        return (state) => {
          const now = Date.now();
          if (now - lastTime >= 350) {
            lastTime = now;
            handleSet(state);
          }
        };
      }
    }
  )
);

export function getDocumentSnapshot(): DocumentState {
  const { layers, polygonLayers, mesh3dLayers, camera3d, flythroughAssets, flythrough, tunnelAssets, tunnel, canvasBg, masterFx } = useStore.getState();
  return { layers, polygonLayers, mesh3dLayers, camera3d, flythroughAssets, flythrough, tunnelAssets, tunnel, canvasBg, masterFx };
}

export const undo = () => useStore.temporal.getState().undo();
export const redo = () => useStore.temporal.getState().redo();
export const pauseHistory = () => useStore.temporal.getState().pause();
export const resumeHistory = () => useStore.temporal.getState().resume();
export const clearHistory = () => useStore.temporal.getState().clear();

// Exposed for headless smoke tests and console debugging only.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window as object, { __store: useStore, __undo: undo, __redo: redo });
}
