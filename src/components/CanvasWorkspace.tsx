import React, { RefObject, useEffect, useRef, useState } from 'react';
import { DEFAULT_SYMMETRY_PARAMS, PolygonPoint } from '../types';
import { cn } from '../lib/utils';
import { PenTool } from 'lucide-react';
import { getPolygonCentroid, isPointInPolygon } from '../lib/polygonUtils';
import {
  clampHandleToBounds,
  getVisibleHandleBounds,
  isPointOutsideCanvas,
  Viewport
} from '../lib/canvasViewport';
import { getInstances } from '../lib/motion';
import { pauseHistory, resumeHistory, useStore } from '../store';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  getLayerSize
} from '../renderer/render2d';
import { getActiveRendererName, getPlaybackTime, startRenderLoop } from '../renderer/loop';
import { imageFilesFromPaths, isNative, openProjectFromPath } from '../lib/native';
import { WORKSPACE_FIT_MARGIN } from '../lib/layout';

export default function CanvasWorkspace({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const appMode = useStore(s => s.appMode);
  const layers = useStore(s => s.layers);
  const polygonLayers = useStore(s => s.polygonLayers);
  const selectedLayerId = useStore(s => s.selectedLayerId);
  const selectedPolygonId = useStore(s => s.selectedPolygonId);
  const isDrawingPolygon = useStore(s => s.isDrawingPolygon);
  const canvasBg = useStore(s => s.canvasBg);

  const onSelectLayer = useStore(s => s.selectLayer);
  const onUpdateLayer = useStore(s => s.updateLayer);
  const onAddLayer = useStore(s => s.addLayerFromFile);
  const onSelectPolygon = useStore(s => s.selectPolygon);
  const onUpdatePolygon = useStore(s => s.updatePolygon);
  const onFinishDrawingPolygon = useStore(s => s.finishDrawingPolygon);
  const onToggleDrawPolygon = useStore(s => s.toggleDrawPolygon);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const symOverlayRef = useRef<HTMLDivElement>(null);
  const statusPillRef = useRef<HTMLDivElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  // Workspace size in CSS pixels; null until the first measurement.
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // Height of the only chrome still floating over the canvas — the status
  // pill — so the top handle gutter clears it exactly instead of guessing.
  const [statusPillInset, setStatusPillInset] = useState(WORKSPACE_FIT_MARGIN);

  // Drawing mode points state
  const [drawingPoints, setDrawingPoints] = useState<PolygonPoint[]>([]);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<PolygonPoint | null>(null);

  // The render loop lives outside React: it reads the store imperatively and
  // repaints the canvas every frame without triggering any component renders.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startRenderLoop(canvas, (fps) => {
      if (fpsRef.current) fpsRef.current.textContent = `${fps} fps · ${getActiveRendererName()}`;
    });
  }, [canvasRef]);

  // Observes the workspace element itself, not the window: once side columns
  // can resize or collapse, workspace width changes without a window resize,
  // and a stale scale/viewport would silently corrupt hit-testing and handle
  // pinning.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const updateScale = () => {
      const rect = wrap.getBoundingClientRect();
      const scaleX = (rect.width - WORKSPACE_FIT_MARGIN * 2) / CANVAS_WIDTH;
      const scaleY = (rect.height - WORKSPACE_FIT_MARGIN * 2) / CANVAS_HEIGHT;
      const next = Math.min(scaleX, scaleY, 1);
      scaleRef.current = next;
      setScale(next);
      setViewport({ width: rect.width, height: rect.height });

      const pillHeight = statusPillRef.current?.getBoundingClientRect().height ?? 0;
      setStatusPillInset(pillHeight > 0 ? pillHeight + WORKSPACE_FIT_MARGIN / 2 : WORKSPACE_FIT_MARGIN);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // In the desktop app Tauri intercepts Finder drags before HTML5 sees them,
  // and hands us real paths — which also makes folder drops possible.
  useEffect(() => {
    if (!isNative()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const stop = await getCurrentWebview().onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDraggingOver(true);
          return;
        }
        setIsDraggingOver(false);
        if (payload.type !== 'drop') return;

        const project = payload.paths.find((p) => p.toLowerCase().endsWith('.slapchop'));
        if (project) {
          await openProjectFromPath(project);
          return;
        }
        try {
          const files = await imageFilesFromPaths(payload.paths);
          if (files.length === 0) return;
          // Physical (device px) position → CSS px → canvas coords
          const dpr = window.devicePixelRatio || 1;
          const coords = canvasCoordsFromClient(payload.position.x / dpr, payload.position.y / dpr) ?? { x: 0, y: 0 };
          const addLayer = useStore.getState().addLayerFromFile;
          files.forEach((file) => addLayer(file, coords.x, coords.y));
        } catch (e) {
          console.error('Drop failed:', e);
        }
      });
      if (disposed) stop();
      else unlisten = stop;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Reset drawing state when toggled
  useEffect(() => {
    if (!isDrawingPolygon) {
      setDrawingPoints([]);
      setMouseCanvasPos(null);
    }
  }, [isDrawingPolygon]);

  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);
  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  // Handles for points beyond the frame are drawn in the workspace margin, and
  // pinned to the edge of it once they would leave the window entirely. Only
  // the status pill still floats over the canvas, so its measured height
  // stands in for the top gutter; the other three sides use the same margin
  // the fit-to-window scale calc reserves.
  const handleViewportInsets = {
    top: statusPillInset,
    right: WORKSPACE_FIT_MARGIN,
    bottom: WORKSPACE_FIT_MARGIN,
    left: WORKSPACE_FIT_MARGIN
  };
  const handleBounds = viewport
    ? getVisibleHandleBounds(viewport, scale, handleViewportInsets)
    : null;
  const polygonExtendsOffCanvas = !!selectedPolygon
    && selectedPolygon.points.some(pt => isPointOutsideCanvas(pt, CANVAS_WIDTH, CANVAS_HEIGHT));

  // Selection overlay for symmetry layers follows motion-modulated instances.
  // Positions are written straight to the DOM each frame — React only
  // re-renders when the selection or instance count changes.
  useEffect(() => {
    if (appMode !== 'symmetry' || !selectedLayer || selectedLayer.hidden) return;
    let raf = 0;
    const tick = () => {
      const el = symOverlayRef.current;
      if (el) {
        const t = getPlaybackTime();
        const { w, h } = getLayerSize(selectedLayer);
        const instances = getInstances(selectedLayer, t);
        for (let i = 0; i < el.children.length; i++) {
          const box = el.children[i] as HTMLElement;
          const inst = instances[i];
          if (!inst) break;
          box.style.left = `${(CANVAS_WIDTH / 2 + inst.x) * scale}px`;
          box.style.top = `${(CANVAS_HEIGHT / 2 + inst.y) * scale}px`;
          box.style.width = `${w * Math.abs(inst.scaleX) * scale}px`;
          box.style.height = `${h * Math.abs(inst.scaleY) * scale}px`;
          box.style.transform = `translate(-50%, -50%) rotate(${inst.rotation}deg)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [appMode, selectedLayer, scale]);

  // Convert mouse event to canvas relative space coordinates
  // Closure-safe variant (reads the current scale from a ref) so listeners
  // registered once — like the native drag-drop handler — stay correct.
  const canvasCoordsFromClient = (clientX: number, clientY: number): PolygonPoint | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const s = scaleRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2) / s,
      y: (clientY - rect.top - rect.height / 2) / s
    };
  };

  const getCanvasCoords = (e: React.MouseEvent | MouseEvent): PolygonPoint | null =>
    canvasCoordsFromClient(e.clientX, e.clientY);

  const hitTestLayer = (layerId: string, coords: PolygonPoint): boolean => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer || layer.hidden) return false;
    const instances = getInstances(layer, getPlaybackTime());
    const { w, h } = getLayerSize(layer);

    for (const inst of instances) {
      const dx = coords.x - inst.x;
      const dy = coords.y - inst.y;

      const rad = -inst.rotation * (Math.PI / 180);
      const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

      const halfW = (w * Math.abs(inst.scaleX)) / 2;
      const halfH = (h * Math.abs(inst.scaleY)) / 2;

      if (Math.abs(rx) <= halfW + 10 && Math.abs(ry) <= halfH + 10) {
        return true;
      }
    }
    return false;
  };

  // Shared drag wiring: each drag is a single undo step. History capture is
  // paused right after the first tracked change and resumed on mouse-up.
  const beginDrag = (onMove: (e: MouseEvent) => void, onEnd?: () => void) => {
    let firstMove = true;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      onMove(moveEvent);
      if (firstMove) {
        pauseHistory();
        firstMove = false;
      }
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (!firstMove) resumeHistory();
      onEnd?.();
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const startPolygonDrag = (polygonId: string, startCoords: PolygonPoint) => {
    const poly = useStore.getState().polygonLayers.find(p => p.id === polygonId);
    if (!poly) return;
    const initialPoints = [...poly.points];

    beginDrag((moveEvent) => {
      const currentCoords = getCanvasCoords(moveEvent);
      if (!currentCoords) return;
      const dx = currentCoords.x - startCoords.x;
      const dy = currentCoords.y - startCoords.y;
      onUpdatePolygon(polygonId, {
        points: initialPoints.map(pt => ({ x: pt.x + dx, y: pt.y + dy }))
      });
    });
  };

  const startLayerDrag = (layerId: string, startCoords: PolygonPoint) => {
    const layer = useStore.getState().layers.find(l => l.id === layerId);
    if (!layer) return;
    const startX = layer.x;
    const startY = layer.y;

    beginDrag((moveEvent) => {
      const currentCoords = getCanvasCoords(moveEvent);
      if (!currentCoords) return;
      const dx = currentCoords.x - startCoords.x;
      const dy = currentCoords.y - startCoords.y;
      onUpdateLayer(layerId, { x: startX + dx, y: startY + dy });
    });
  };

  // Drawing accepts the whole workspace, not just the frame, so vertices can be
  // placed outside the canvas bounds. Floating chrome (header buttons, the
  // drawing banner) lives in its own subtrees, so only the workspace backdrop
  // itself and anything inside the canvas count as drawing surface.
  const isDrawingSurface = (target: EventTarget | null): boolean =>
    target === wrapRef.current
    || (target instanceof Node && !!containerRef.current?.contains(target));

  const handleWorkspaceMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingPolygon || !isDrawingSurface(e.target)) return;
    const coords = getCanvasCoords(e);
    if (coords) setMouseCanvasPos(coords);
  };

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (isDrawingPolygon) return;

    const coords = getCanvasCoords(e);
    if (!coords) return;

    if (appMode === 'polygon') {
      // Hit-test polygon layers from top to bottom
      for (let i = polygonLayers.length - 1; i >= 0; i--) {
        const poly = polygonLayers[i];
        if (poly.hidden) continue;
        if (isPointInPolygon(coords, poly.points)) {
          onSelectPolygon(poly.id);
          startPolygonDrag(poly.id, coords);
          return;
        }
      }
      onSelectPolygon(null);
    } else if (appMode === 'symmetry') {
      // Hit-test symmetry layers from top to bottom (highest z-index first)
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer.hidden) continue;
        if (hitTestLayer(layer.id, coords)) {
          onSelectLayer(layer.id);
          startLayerDrag(layer.id, coords);
          return;
        }
      }
      onSelectLayer(null);
    }
  };

  const handleWorkspaceClick = (e: React.MouseEvent) => {
    if (!isDrawingPolygon || !isDrawingSurface(e.target)) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;

    // Check if clicking near first point to close polygon
    if (drawingPoints.length >= 3) {
      const firstPt = drawingPoints[0];
      const dist = Math.hypot(coords.x - firstPt.x, coords.y - firstPt.y);
      if (dist < 25) {
        onFinishDrawingPolygon(drawingPoints);
        setDrawingPoints([]);
        setMouseCanvasPos(null);
        return;
      }
    }

    setDrawingPoints(prev => [...prev, coords]);
  };

  const handleWorkspaceDoubleClick = (e: React.MouseEvent) => {
    if (!isDrawingPolygon || !isDrawingSurface(e.target)) return;
    if (drawingPoints.length >= 3) {
      onFinishDrawingPolygon(drawingPoints);
      setDrawingPoints([]);
      setMouseCanvasPos(null);
    }
  };

  const handleVertexMouseDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const polygonId = selectedPolygonId;
    if (!polygonId) return;
    const startCoords = getCanvasCoords(e);
    const startPoint = useStore.getState().polygonLayers
      .find(p => p.id === polygonId)?.points[index];
    if (!startCoords || !startPoint) return;

    // Moving by delta rather than snapping the vertex to the cursor: a handle
    // pinned to the workspace edge stands in for a point further out, and
    // grabbing it must not drag that point back to the handle's position.
    beginDrag((moveEvent) => {
      const coords = getCanvasCoords(moveEvent);
      if (!coords) return;
      const poly = useStore.getState().polygonLayers.find(p => p.id === polygonId);
      if (!poly) return;
      const newPoints = [...poly.points];
      newPoints[index] = {
        x: startPoint.x + (coords.x - startCoords.x),
        y: startPoint.y + (coords.y - startCoords.y)
      };
      onUpdatePolygon(polygonId, { points: newPoints });
    });
  };

  const handlePolygonCenterMouseDown = (e: React.MouseEvent, polygonId: string) => {
    e.stopPropagation();
    onSelectPolygon(polygonId);
    const startCoords = getCanvasCoords(e);
    if (!startCoords) return;
    startPolygonDrag(polygonId, startCoords);
  };

  const handleLayerCenterMouseDown = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    onSelectLayer(layerId);
    const startCoords = getCanvasCoords(e);
    if (!startCoords) return;
    startLayerDrag(layerId, startCoords);
  };

  // Off-center symmetry anchor: shared by both app modes since Layer and
  // PolygonLayer carry the same symmetryParams shape. Dragging re-centers
  // whichever modes are active (mirror/radial/spiral/…) around this point.
  const startSymmetryOriginDrag = (kind: 'layer' | 'polygon', id: string, startCoords: PolygonPoint) => {
    const readParams = () => kind === 'layer'
      ? useStore.getState().layers.find(l => l.id === id)?.symmetryParams
      : useStore.getState().polygonLayers.find(p => p.id === id)?.symmetryParams;
    const start = readParams();
    const startOriginX = start?.originX ?? 0;
    const startOriginY = start?.originY ?? 0;

    beginDrag((moveEvent) => {
      const currentCoords = getCanvasCoords(moveEvent);
      if (!currentCoords) return;
      const dx = currentCoords.x - startCoords.x;
      const dy = currentCoords.y - startCoords.y;
      const symmetryParams = { ...DEFAULT_SYMMETRY_PARAMS, ...readParams(), originX: startOriginX + dx, originY: startOriginY + dy };
      if (kind === 'layer') onUpdateLayer(id, { symmetryParams });
      else onUpdatePolygon(id, { symmetryParams });
    });
  };

  const handleSymmetryOriginMouseDown = (e: React.MouseEvent, kind: 'layer' | 'polygon', id: string) => {
    e.stopPropagation();
    const startCoords = getCanvasCoords(e);
    if (!startCoords) return;
    startSymmetryOriginDrag(kind, id, startCoords);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    if (!containerRef.current) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;

    const files: File[] = Array.from(e.dataTransfer.files);
    files.forEach((file: File) => {
      if (file.type.startsWith('image/')) {
        onAddLayer(file, coords.x, coords.y);
      }
    });
  };

  return (
    <div
      ref={wrapRef}
      className={cn(
        "flex-1 bg-gray-950 flex items-center justify-center relative overflow-hidden select-none",
        isDrawingPolygon ? "cursor-crosshair" : ""
      )}
      onClick={handleWorkspaceClick}
      onDoubleClick={handleWorkspaceDoubleClick}
      onMouseMove={handleWorkspaceMouseMove}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Floating status pill — the only chrome still overlaying the canvas
          now that identity/mode chrome and export/live-output triggers live
          in the side columns. Its measured height drives the top handle
          gutter above, so this stays the sole floating element by design. */}
      <div className="absolute top-4 left-6 flex items-center z-20 pointer-events-none">
        <div ref={statusPillRef} className="flex items-center gap-2 pointer-events-auto bg-gray-900/80 backdrop-blur border border-gray-800 px-3 py-1.5 rounded-full text-xs text-gray-300 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-white">
            {appMode === 'symmetry' ? 'Symmetry Canvas' : 'Polygon GIF Tiler'}
          </span>
          <span className="text-gray-500 font-mono">1080x1920</span>
          {import.meta.env.DEV && (
            <span ref={fpsRef} className="text-emerald-400 font-mono" />
          )}
        </div>
      </div>

      {/* Drawing Polygon Top Notification Banner */}
      {isDrawingPolygon && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-amber-950/90 border border-amber-500/80 px-4 py-2 rounded-full shadow-2xl backdrop-blur text-amber-200 text-xs">
          <PenTool className="w-4 h-4 text-amber-400 animate-bounce" />
          <span>Click anywhere to add vertices, inside or outside the frame ({drawingPoints.length} added). Double-click or click start point to close.</span>
          {drawingPoints.length >= 3 && (
            <button
              onClick={() => {
                onFinishDrawingPolygon(drawingPoints);
                setDrawingPoints([]);
                setMouseCanvasPos(null);
              }}
              className="px-2.5 py-1 bg-amber-500 text-black font-bold rounded-full hover:bg-amber-400 transition-colors"
            >
              Done
            </button>
          )}
          <button
            onClick={() => {
              onToggleDrawPolygon();
              setDrawingPoints([]);
              setMouseCanvasPos(null);
            }}
            className="px-2 py-1 hover:bg-amber-900/50 rounded-full transition-colors text-amber-400"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main Interactive Canvas Box */}
      <div
        ref={containerRef}
        onMouseDown={handleContainerMouseDown}
        className={cn(
          // Deliberately not clipped: interaction overlays have to be able to
          // paint into the surrounding margin so handles for points outside
          // the frame stay visible. Anything that must stay inside the frame
          // clips itself.
          "relative shadow-2xl transition-all duration-75",
          isDraggingOver ? "ring-4 ring-indigo-500/50" : "",
          isDrawingPolygon ? "cursor-crosshair" : "cursor-default"
        )}
        style={{
          width: CANVAS_WIDTH * scale,
          height: CANVAS_HEIGHT * scale,
          backgroundColor: canvasBg
        }}
      >
        {/* Native 2D Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full block"
        />

        {/* Polygon Interactive Handle Overlay */}
        {appMode === 'polygon' && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Draw active polygon guidance line. `overflow: visible` keeps the
                in-progress geometry legible when vertices land outside the
                frame — an SVG root clips to its viewport otherwise. */}
            {isDrawingPolygon && (
              <svg
                className="w-full h-full absolute inset-0 pointer-events-none"
                style={{ overflow: 'visible' }}
              >
                {drawingPoints.length > 0 && (
                  <polyline
                    points={drawingPoints.map(p => `${(CANVAS_WIDTH / 2 + p.x) * scale},${(CANVAS_HEIGHT / 2 + p.y) * scale}`).join(' ')}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                )}
                {drawingPoints.length > 0 && mouseCanvasPos && (
                  <line
                    x1={(CANVAS_WIDTH / 2 + drawingPoints[drawingPoints.length - 1].x) * scale}
                    y1={(CANVAS_HEIGHT / 2 + drawingPoints[drawingPoints.length - 1].y) * scale}
                    x2={(CANVAS_WIDTH / 2 + mouseCanvasPos.x) * scale}
                    y2={(CANVAS_HEIGHT / 2 + mouseCanvasPos.y) * scale}
                    stroke="#fbbf24"
                    strokeWidth={2}
                  />
                )}
                {drawingPoints.map((pt, i) => (
                  <circle
                    key={`draw-pt-${i}`}
                    cx={(CANVAS_WIDTH / 2 + pt.x) * scale}
                    cy={(CANVAS_HEIGHT / 2 + pt.y) * scale}
                    r={i === 0 ? 8 : 5}
                    fill={i === 0 ? "#10b981" : "#f59e0b"}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                ))}
              </svg>
            )}

            {/* Selected polygon handles */}
            {selectedPolygon && !isDrawingPolygon && (
              <div className="w-full h-full relative pointer-events-none">
                {/* The renderer clips the shape to the frame, so once part of
                    it lies outside, trace the true outline over the margin to
                    show what the handles are attached to. */}
                {polygonExtendsOffCanvas && (
                  <svg
                    className="w-full h-full absolute inset-0 pointer-events-none"
                    style={{ overflow: 'visible' }}
                  >
                    <polygon
                      points={selectedPolygon.points
                        .map(p => `${(CANVAS_WIDTH / 2 + p.x) * scale},${(CANVAS_HEIGHT / 2 + p.y) * scale}`)
                        .join(' ')}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      opacity={0.7}
                    />
                  </svg>
                )}

                {/* Center Translation Handle */}
                {(() => {
                  const center = clampHandleToBounds(
                    getPolygonCentroid(selectedPolygon.points),
                    handleBounds
                  );
                  return (
                    <div
                      onMouseDown={(e) => handlePolygonCenterMouseDown(e, selectedPolygon.id)}
                      style={{
                        left: `${(CANVAS_WIDTH / 2 + center.x) * scale}px`,
                        top: `${(CANVAS_HEIGHT / 2 + center.y) * scale}px`
                      }}
                      className={cn(
                        "absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-indigo-600/90 hover:bg-indigo-500 border-2 shadow-xl pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform hover:scale-125 z-20",
                        center.pinned ? "border-amber-400 border-dashed" : "border-white"
                      )}
                      title={center.pinned
                        ? 'Drag to Move Polygon (center is off screen)'
                        : 'Drag to Move Polygon'}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  );
                })()}

                {/* Vertex Point Handles. A vertex dragged past the edge of the
                    workspace keeps a handle pinned at the boundary so it can
                    always be grabbed and brought back. */}
                {selectedPolygon.points.map((pt, i) => {
                  const vertex = clampHandleToBounds(pt, handleBounds);
                  return (
                    <div
                      key={`v-handle-${i}`}
                      onMouseDown={(e) => handleVertexMouseDown(e, i)}
                      style={{
                        left: `${(CANVAS_WIDTH / 2 + vertex.x) * scale}px`,
                        top: `${(CANVAS_HEIGHT / 2 + vertex.y) * scale}px`
                      }}
                      className={cn(
                        "absolute w-4 h-4 -ml-2 -mt-2 rounded-full shadow-md pointer-events-auto cursor-move hover:scale-150 transition-transform z-20",
                        vertex.pinned
                          ? "bg-amber-200 border-2 border-amber-500 border-dashed"
                          : "bg-white border-2 border-indigo-600"
                      )}
                      title={vertex.pinned
                        ? `Vertex ${i + 1} (off screen — drag to bring it back)`
                        : `Vertex ${i + 1}`}
                    />
                  );
                })}

                {/* Symmetry Origin Handle */}
                {/* Voronoi's shard bounds derive from the shape itself, not
                    a separate origin, so the handle would have no effect. */}
                {!['none', 'voronoi'].includes(selectedPolygon.symmetry ?? 'none') && (() => {
                  const origin = clampHandleToBounds({
                    x: selectedPolygon.symmetryParams?.originX ?? 0,
                    y: selectedPolygon.symmetryParams?.originY ?? 0
                  }, handleBounds);
                  return (
                    <div
                      onMouseDown={(e) => handleSymmetryOriginMouseDown(e, 'polygon', selectedPolygon.id)}
                      style={{
                        left: `${(CANVAS_WIDTH / 2 + origin.x) * scale}px`,
                        top: `${(CANVAS_HEIGHT / 2 + origin.y) * scale}px`
                      }}
                      className={cn(
                        "absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-amber-500/90 hover:bg-amber-400 border-2 shadow-xl pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform hover:scale-125 z-30",
                        origin.pinned ? "border-amber-200 border-dashed" : "border-white"
                      )}
                      title={origin.pinned
                        ? 'Drag to Move Symmetry Origin (off screen)'
                        : 'Drag to Move Symmetry Origin'}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Symmetry Mode Layer Interactive Handle Overlay */}
        {appMode === 'symmetry' && selectedLayer && !selectedLayer.hidden && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Instance outlines trace what the renderer draws, so they clip
                to the frame like it does. The ref'd element holds nothing but
                those boxes: the rAF tick above reads el.children[i] against
                instances[i]. */}
            <div ref={symOverlayRef} className="absolute inset-0 overflow-hidden">
              {getInstances(selectedLayer, getPlaybackTime()).map((inst, idx) => (
                <div
                  key={`layer-select-outline-${inst.isPrimary ? 'primary' : 'sym'}-${idx}`}
                  className={cn(
                    "absolute border-2 pointer-events-none rounded",
                    inst.isPrimary ? "border-indigo-400 border-dashed" : "border-indigo-500/30 border-dotted"
                  )}
                >
                  {inst.isPrimary && (
                    <div
                      onMouseDown={(e) => handleLayerCenterMouseDown(e, selectedLayer.id)}
                      className="absolute top-1/2 left-1/2 -ml-3.5 -mt-3.5 w-7 h-7 rounded-full bg-indigo-600/90 hover:bg-indigo-500 border-2 border-white shadow-xl pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform hover:scale-125 z-20"
                      title="Drag to Move GIF / Layer"
                    >
                      <div className="w-2 h-2 rounded-full bg-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Symmetry Origin Handle — kept out of the clipped container
                above so it stays reachable when dragged past the frame. */}
            {/* Voronoi's shard bounds derive from the layer itself, not a
                separate origin, so the handle would have no effect. */}
            {selectedLayer.symmetry !== 'none' && selectedLayer.symmetry !== 'voronoi' && (() => {
              const origin = clampHandleToBounds({
                x: selectedLayer.symmetryParams?.originX ?? 0,
                y: selectedLayer.symmetryParams?.originY ?? 0
              }, handleBounds);
              return (
                <div
                  onMouseDown={(e) => handleSymmetryOriginMouseDown(e, 'layer', selectedLayer.id)}
                  style={{
                    left: `${(CANVAS_WIDTH / 2 + origin.x) * scale}px`,
                    top: `${(CANVAS_HEIGHT / 2 + origin.y) * scale}px`
                  }}
                  className={cn(
                    "absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-amber-500/90 hover:bg-amber-400 border-2 shadow-xl pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform hover:scale-125 z-30",
                    origin.pinned ? "border-amber-200 border-dashed" : "border-white"
                  )}
                  title={origin.pinned
                    ? 'Drag to Move Symmetry Origin (off screen)'
                    : 'Drag to Move Symmetry Origin'}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              );
            })()}
          </div>
        )}
      </div>

    </div>
  );
}
