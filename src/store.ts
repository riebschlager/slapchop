import { create } from 'zustand';
import { temporal } from 'zundo';
import { AppMode, Layer, PolygonLayer, PolygonPoint } from './types';
import { parseGifFile } from './lib/gifUtils';
import { createNewPolygonLayer, createPresetPolygonPoints } from './lib/polygonUtils';

export interface DocumentState {
  layers: Layer[];
  polygonLayers: PolygonLayer[];
  canvasBg: string;
}

export interface AppState extends DocumentState {
  appMode: AppMode;
  selectedLayerId: string | null;
  selectedPolygonId: string | null;
  isDrawingPolygon: boolean;

  setAppMode: (mode: AppMode) => void;
  setCanvasBg: (color: string) => void;
  loadDocument: (doc: DocumentState) => void;

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
      canvasBg: '#000000',
      appMode: 'symmetry',
      selectedLayerId: null,
      selectedPolygonId: INITIAL_POLYGON.id,
      isDrawingPolygon: false,

      setAppMode: (mode) => set({ appMode: mode, isDrawingPolygon: false }),
      setCanvasBg: (color) => set({ canvasBg: color }),
      loadDocument: (doc) => set({
        layers: doc.layers,
        polygonLayers: doc.polygonLayers,
        canvasBg: doc.canvasBg,
        selectedLayerId: null,
        selectedPolygonId: null,
        isDrawingPolygon: false
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
      toggleDrawPolygon: () => set(s => ({ isDrawingPolygon: !s.isDrawingPolygon }))
    }),
    {
      // Undo history tracks the document only — selection, mode, and drawing
      // state stay outside so undo never "jumps" the UI around.
      partialize: (s) => ({ layers: s.layers, polygonLayers: s.polygonLayers, canvasBg: s.canvasBg }),
      equality: (a, b) =>
        a.layers === b.layers && a.polygonLayers === b.polygonLayers && a.canvasBg === b.canvasBg,
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
  const { layers, polygonLayers, canvasBg } = useStore.getState();
  return { layers, polygonLayers, canvasBg };
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
