import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Layer, PolygonLayer, PolygonPoint, AppMode } from './types';
import Sidebar from './components/Sidebar';
import CanvasWorkspace from './components/CanvasWorkspace';
import { parseGifFile } from './lib/gifUtils';
import { createPresetPolygonPoints, createNewPolygonLayer } from './lib/polygonUtils';

// Initial default sample polygon for instant visual feedback in Polygon mode
const INITIAL_POLYGON_1 = createNewPolygonLayer(
  'Hexagon Tile',
  createPresetPolygonPoints('hexagon', 220),
  {
    textureScale: 0.5,
    strokeColor: '#818cf8',
    strokeWidth: 3,
    fillColor: '#4f46e5'
  }
);

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('symmetry');
  const [canvasBg, setCanvasBg] = useState('#000000');

  // Mode 1: Symmetry Layers
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Mode 2: Polygon GIF Tiler
  const [polygonLayers, setPolygonLayers] = useState<PolygonLayer[]>([INITIAL_POLYGON_1]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(INITIAL_POLYGON_1.id);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);

  // Handlers for Symmetry Mode
  const handleAddLayer = async (file: File, x: number = 0, y: number = 0) => {
    const url = URL.createObjectURL(file);
    const gifData = await parseGifFile(file);

    const newLayer: Layer = {
      id: uuidv4(),
      name: file.name,
      src: url,
      gifData: gifData || undefined,
      x: x,
      y: y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      symmetry: 'none',
      radialSegments: 6,
      blendMode: 'screen',
      opacity: 1
    };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const handleUpdateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(layer => layer.id === id ? { ...layer, ...updates } : layer));
  };

  const handleDeleteLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const handleReorderLayers = (activeId: string, overId: string) => {
    setLayers((items) => {
      const oldIndex = items.findIndex(item => item.id === activeId);
      const newIndex = items.findIndex(item => item.id === overId);
      const next = [...items];
      const [removed] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, removed);
      return next;
    });
  };

  const handleDuplicateLayer = (id: string) => {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    const clone: Layer = {
      ...layer,
      id: uuidv4(),
      name: `${layer.name} (Copy)`,
      x: layer.x + 40,
      y: layer.y + 40
    };
    setLayers(prev => [...prev, clone]);
    setSelectedLayerId(clone.id);
  };

  const handleMoveLayerUp = (id: string) => {
    setLayers(items => {
      const index = items.findIndex(l => l.id === id);
      if (index <= 0) return items;
      const next = [...items];
      const temp = next[index];
      next[index] = next[index - 1];
      next[index - 1] = temp;
      return next;
    });
  };

  const handleMoveLayerDown = (id: string) => {
    setLayers(items => {
      const index = items.findIndex(l => l.id === id);
      if (index === -1 || index >= items.length - 1) return items;
      const next = [...items];
      const temp = next[index];
      next[index] = next[index + 1];
      next[index + 1] = temp;
      return next;
    });
  };

  // Handlers for Polygon Mode
  const handleAddPresetPolygon = (type: 'triangle' | 'rectangle' | 'star' | 'hexagon') => {
    const pts = createPresetPolygonPoints(type, 200);
    const newPoly = createNewPolygonLayer(
      `${type.charAt(0).toUpperCase() + type.slice(1)} ${polygonLayers.length + 1}`,
      pts,
      {
        textureScale: 0.5,
        strokeColor: '#818cf8',
        strokeWidth: 3,
        fillColor: '#6366f1'
      }
    );
    setPolygonLayers(prev => [...prev, newPoly]);
    setSelectedPolygonId(newPoly.id);
  };

  const handleUploadPolygonTexture = async (file: File) => {
    const url = URL.createObjectURL(file);
    const gifData = await parseGifFile(file);

    if (selectedPolygonId) {
      setPolygonLayers(prev => prev.map(p => p.id === selectedPolygonId ? {
        ...p,
        src: url,
        gifData: gifData || undefined
      } : p));
    } else {
      const pts = createPresetPolygonPoints('hexagon', 220);
      const newPoly = createNewPolygonLayer(
        file.name,
        pts,
        {
          src: url,
          gifData: gifData || undefined,
          textureScale: 0.5,
          strokeColor: '#ffffff',
          strokeWidth: 2
        }
      );
      setPolygonLayers(prev => [...prev, newPoly]);
      setSelectedPolygonId(newPoly.id);
    }
  };

  const handleFinishDrawingPolygon = (points: PolygonPoint[]) => {
    if (points.length < 3) return;
    const newPoly = createNewPolygonLayer(
      `Custom Polygon ${polygonLayers.length + 1}`,
      points,
      {
        textureScale: 0.5,
        strokeColor: '#c084fc',
        strokeWidth: 3,
        fillColor: '#8b5cf6'
      }
    );
    setPolygonLayers(prev => [...prev, newPoly]);
    setSelectedPolygonId(newPoly.id);
    setIsDrawingPolygon(false);
  };

  const handleUpdatePolygon = (id: string, updates: Partial<PolygonLayer>) => {
    setPolygonLayers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleDeletePolygon = (id: string) => {
    setPolygonLayers(prev => prev.filter(p => p.id !== id));
    if (selectedPolygonId === id) setSelectedPolygonId(null);
  };

  const handleReorderPolygons = (activeId: string, overId: string) => {
    setPolygonLayers((items) => {
      const oldIndex = items.findIndex(item => item.id === activeId);
      const newIndex = items.findIndex(item => item.id === overId);
      const next = [...items];
      const [removed] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, removed);
      return next;
    });
  };

  const handleDuplicatePolygon = (id: string) => {
    const poly = polygonLayers.find(p => p.id === id);
    if (!poly) return;
    const clone: PolygonLayer = {
      ...poly,
      id: uuidv4(),
      name: `${poly.name} (Copy)`,
      points: poly.points.map(pt => ({ x: pt.x + 30, y: pt.y + 30 }))
    };
    setPolygonLayers(prev => [...prev, clone]);
    setSelectedPolygonId(clone.id);
  };

  const handleMovePolygonUp = (id: string) => {
    setPolygonLayers(items => {
      const index = items.findIndex(p => p.id === id);
      if (index <= 0) return items;
      const next = [...items];
      const temp = next[index];
      next[index] = next[index - 1];
      next[index - 1] = temp;
      return next;
    });
  };

  const handleMovePolygonDown = (id: string) => {
    setPolygonLayers(items => {
      const index = items.findIndex(p => p.id === id);
      if (index === -1 || index >= items.length - 1) return items;
      const next = [...items];
      const temp = next[index];
      next[index] = next[index + 1];
      next[index + 1] = temp;
      return next;
    });
  };

  return (
    <div className="flex w-full h-screen font-sans bg-gray-950 overflow-hidden text-gray-100">
      <Sidebar 
        appMode={appMode}
        onModeChange={(mode) => {
          setAppMode(mode);
          setIsDrawingPolygon(false);
        }}
        layers={layers}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onUpdateLayer={handleUpdateLayer}
        onDeleteLayer={handleDeleteLayer}
        onDuplicateLayer={handleDuplicateLayer}
        onMoveLayerUp={handleMoveLayerUp}
        onMoveLayerDown={handleMoveLayerDown}
        onReorderLayers={handleReorderLayers}
        onAddLayer={handleAddLayer}
        polygonLayers={polygonLayers}
        selectedPolygonId={selectedPolygonId}
        onSelectPolygon={setSelectedPolygonId}
        onUpdatePolygon={handleUpdatePolygon}
        onDeletePolygon={handleDeletePolygon}
        onDuplicatePolygon={handleDuplicatePolygon}
        onMovePolygonUp={handleMovePolygonUp}
        onMovePolygonDown={handleMovePolygonDown}
        onReorderPolygons={handleReorderPolygons}
        onAddPresetPolygon={handleAddPresetPolygon}
        isDrawingPolygon={isDrawingPolygon}
        onToggleDrawPolygon={() => setIsDrawingPolygon(prev => !prev)}
        onUploadPolygonTexture={handleUploadPolygonTexture}
        canvasBg={canvasBg}
        onUpdateCanvasBg={setCanvasBg}
      />
      <CanvasWorkspace 
        appMode={appMode}
        layers={layers}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onUpdateLayer={handleUpdateLayer}
        onAddLayer={handleAddLayer}
        polygonLayers={polygonLayers}
        selectedPolygonId={selectedPolygonId}
        onSelectPolygon={setSelectedPolygonId}
        onUpdatePolygon={handleUpdatePolygon}
        isDrawingPolygon={isDrawingPolygon}
        onFinishDrawingPolygon={handleFinishDrawingPolygon}
        onCancelDrawingPolygon={() => setIsDrawingPolygon(false)}
        canvasBg={canvasBg}
      />
    </div>
  );
}
