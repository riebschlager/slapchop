import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_SYMMETRY_PARAMS, PolygonPoint } from '../types';
import { cn } from '../lib/utils';
import { Download, Video, X, Loader2, PenTool, Film, Repeat, Clapperboard, Radio } from 'lucide-react';
import { getPolygonCentroid, isPointInPolygon } from '../lib/polygonUtils';
import {
  clampHandleToBounds,
  getVisibleHandleBounds,
  isPointOutsideCanvas,
  Viewport
} from '../lib/canvasViewport';
import { getInstances } from '../lib/motion';
import { getDocumentSnapshot, pauseHistory, resumeHistory, useStore } from '../store';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  RenderState,
  getLayerSize
} from '../renderer/render2d';
import { getActiveRendererName, getPlaybackTime, renderExportFrame, startRenderLoop } from '../renderer/loop';
import { exportVideo, supportsWebCodecs, VideoFormat } from '../lib/videoExport';
import { exportZipSequence } from '../lib/zipExport';
import { exportGif } from '../lib/gifExport';
import { imageFilesFromPaths, isNative, openProjectFromPath, pickSavePath, saveBlob } from '../lib/native';
import { exportProRes } from '../lib/proresExport';
import {
  DEFAULT_SIGNALING_URL,
  INITIAL_LIVE_OUTPUT_STATE,
  LiveOutputState,
  TouchDesignerWebRtcOutput
} from '../lib/liveOutput';

// Gutters kept clear of handles that have been pinned to the workspace edge.
// The top gutter clears the floating header bar so a pinned handle stays
// clickable rather than sliding underneath it.
const HANDLE_VIEWPORT_INSETS = { top: 72, right: 20, bottom: 20, left: 20 };

function getExportTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export default function CanvasWorkspace() {
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const symOverlayRef = useRef<HTMLDivElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  // Workspace size in CSS pixels; null until the first measurement.
  const [viewport, setViewport] = useState<Viewport | null>(null);

  // Drawing mode points state
  const [drawingPoints, setDrawingPoints] = useState<PolygonPoint[]>([]);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<PolygonPoint | null>(null);

  // Export settings state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<'mp4' | 'webm' | 'prores' | 'gif' | 'zip'>('mp4');
  const [exportResolution, setExportResolution] = useState<'full' | 'hd' | 'compact'>('hd');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png');
  const [exportDuration, setExportDuration] = useState<number>(3);
  const [exportFps, setExportFps] = useState<number>(30);

  // Live output is connection state, not document state, so it intentionally
  // stays outside Zustand history and is torn down with this workspace.
  const liveOutputRef = useRef<TouchDesignerWebRtcOutput | null>(null);
  const [showLiveOutputModal, setShowLiveOutputModal] = useState(false);
  const [liveOutputState, setLiveOutputState] = useState<LiveOutputState>(INITIAL_LIVE_OUTPUT_STATE);
  const [liveOutputUrl, setLiveOutputUrl] = useState(DEFAULT_SIGNALING_URL);
  const [liveOutputFps, setLiveOutputFps] = useState(30);
  const [selectedReceiverAddress, setSelectedReceiverAddress] = useState('');
  const [liveOutputActionError, setLiveOutputActionError] = useState<string | null>(null);

  // Active export progress state (null when no export is running)
  const [exportJob, setExportJob] = useState<{ label: string; percent: number } | null>(null);

  const isCancelExportRef = useRef(false);

  useEffect(() => {
    const output = new TouchDesignerWebRtcOutput((nextState) => {
      setLiveOutputState(nextState);
      setSelectedReceiverAddress((current) => {
        if (nextState.receivers.some((receiver) => receiver.address === current)) return current;
        return nextState.receivers[0]?.address ?? '';
      });
    });
    liveOutputRef.current = output;
    return () => {
      output.destroy();
      liveOutputRef.current = null;
    };
  }, []);

  // The render loop lives outside React: it reads the store imperatively and
  // repaints the canvas every frame without triggering any component renders.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startRenderLoop(canvas, (fps) => {
      if (fpsRef.current) fpsRef.current.textContent = `${fps} fps · ${getActiveRendererName()}`;
    });
  }, []);

  useEffect(() => {
    const updateScale = () => {
      if (wrapRef.current) {
        const rect = wrapRef.current.getBoundingClientRect();
        const scaleX = (rect.width - 80) / CANVAS_WIDTH;
        const scaleY = (rect.height - 80) / CANVAS_HEIGHT;
        const next = Math.min(scaleX, scaleY, 1);
        scaleRef.current = next;
        setScale(next);
        setViewport({ width: rect.width, height: rect.height });
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Native menu items (File > Export…) reach us via window events.
  useEffect(() => {
    const showExport = () => setShowExportModal(true);
    const exportPng = () => void handleExportHighRes();
    window.addEventListener('slapchop:show-export', showExport);
    window.addEventListener('slapchop:export-png', exportPng);
    return () => {
      window.removeEventListener('slapchop:show-export', showExport);
      window.removeEventListener('slapchop:export-png', exportPng);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleExportHighRes reads all state through the store
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
  // pinned to the edge of it once they would leave the window entirely.
  const handleBounds = viewport
    ? getVisibleHandleBounds(viewport, scale, HANDLE_VIEWPORT_INSETS)
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

  // Reads through getState() so it stays correct inside long-lived listeners.
  const snapshotRenderState = (): RenderState => ({
    appMode: useStore.getState().appMode,
    ...getDocumentSnapshot()
  });

  const handleExportHighRes = async () => {
    try {
      const canvas = document.createElement('canvas');
      renderExportFrame(canvas, getPlaybackTime(), snapshotRenderState(), CANVAS_WIDTH, CANVAS_HEIGHT);
      const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
      await saveBlob(blob, `slapchop-art-${getExportTimestamp()}.png`);
    } catch (e) {
      console.error('High-Res export failed', e);
    }
  };

  const finishExport = async (blob: Blob, filename: string) => {
    await saveBlob(blob, filename);
    setShowExportModal(false);
  };

  // Real-time MediaRecorder capture, kept only for browsers without WebCodecs.
  const recordVideoFallback = (doc: RenderState, resW: number, resH: number) =>
    new Promise<void>((resolve) => {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = resW;
      offscreenCanvas.height = resH;

      const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      let selectedMimeType = 'video/webm';
      for (const type of mimeTypes) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }

      const stream = offscreenCanvas.captureStream(exportFps);
      const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        if (!isCancelExportRef.current) {
          const blob = new Blob(chunks, { type: 'video/webm' });
          finishExport(blob, `slapchop-video-${getExportTimestamp()}-${exportDuration}s.webm`);
        }
        resolve();
      };

      mediaRecorder.start();

      const startTime = performance.now();
      const interval = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        setExportJob({
          label: `Recording in real time (WebCodecs unavailable)… ${elapsed.toFixed(1)}s / ${exportDuration}s`,
          percent: Math.min(100, (elapsed / exportDuration) * 100)
        });

        renderExportFrame(offscreenCanvas, elapsed, doc, resW, resH);

        if (elapsed >= exportDuration || isCancelExportRef.current) {
          clearInterval(interval);
          if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        }
      }, 1000 / exportFps);
    });

  const startExport = async () => {
    isCancelExportRef.current = false;
    const doc = snapshotRenderState();
    const [resW, resH] = exportResolution === 'full' ? [1080, 1920]
                       : exportResolution === 'hd' ? [720, 1280]
                       : [540, 960];
    const ts = getExportTimestamp();

    const common = {
      width: resW,
      height: resH,
      fps: exportFps,
      duration: exportDuration,
      renderFrame: (canvas: HTMLCanvasElement, t: number) =>
        renderExportFrame(canvas, t, doc, resW, resH),
      isCancelled: () => isCancelExportRef.current
    };
    const frameProgress = (verb: string) => (done: number, total: number) =>
      setExportJob({ label: `${verb} frame ${done}/${total}…`, percent: (done / total) * 100 });

    setExportJob({ label: 'Preparing export…', percent: 0 });
    try {
      if (exportType === 'zip') {
        const blob = await exportZipSequence({
          ...common,
          imageFormat: exportFormat,
          onProgress: frameProgress('Rendering'),
          onZipProgress: (percent) => setExportJob({ label: 'Compressing ZIP…', percent })
        });
        if (blob) finishExport(blob, `slapchop-sequence-${ts}-${exportResolution}-${exportDuration}s.zip`);
      } else if (exportType === 'gif') {
        const blob = await exportGif({ ...common, onProgress: frameProgress('Encoding GIF') });
        if (blob) finishExport(blob, `slapchop-anim-${ts}-${exportDuration}s.gif`);
      } else if (exportType === 'prores') {
        const savePath = await pickSavePath(`slapchop-video-${ts}-${exportDuration}s.mov`);
        if (savePath) {
          const ok = await exportProRes({
            ...common,
            savePath,
            onProgress: frameProgress('Rendering'),
            onEncodeProgress: (done, total) =>
              setExportJob({ label: `Encoding ProRes ${done}/${total}…`, percent: (done / total) * 100 })
          });
          if (ok) setShowExportModal(false);
        }
      } else if (supportsWebCodecs()) {
        const blob = await exportVideo(exportType as VideoFormat, {
          ...common,
          onProgress: frameProgress('Encoding')
        });
        if (blob) finishExport(blob, `slapchop-video-${ts}-${exportDuration}s.${exportType}`);
      } else {
        await recordVideoFallback(doc, resW, resH);
      }
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExportJob(null);
    }
  };

  const connectLiveOutput = async () => {
    setLiveOutputActionError(null);
    try {
      await liveOutputRef.current?.connect(liveOutputUrl);
    } catch (error) {
      setLiveOutputActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const startLiveOutput = async () => {
    const canvas = canvasRef.current;
    const output = liveOutputRef.current;
    if (!canvas || !output) return;
    setLiveOutputActionError(null);
    try {
      await output.startStreaming(canvas, selectedReceiverAddress, liveOutputFps);
    } catch (error) {
      output.stopStreaming();
      setLiveOutputActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const stopLiveOutput = () => {
    liveOutputRef.current?.stopStreaming();
    setLiveOutputActionError(null);
  };

  const disconnectLiveOutput = () => {
    liveOutputRef.current?.disconnect();
    setLiveOutputActionError(null);
  };

  const liveOutputConnected = !['idle', 'error'].includes(liveOutputState.phase);
  const liveOutputBusy = ['connecting', 'negotiating'].includes(liveOutputState.phase);
  const liveOutputStreaming = liveOutputState.phase === 'streaming';
  const liveOutputMetrics = liveOutputState.metrics;
  const liveOutputDownscaled = liveOutputMetrics?.encodedWidth !== undefined
    && liveOutputMetrics.encodedHeight !== undefined
    && (liveOutputMetrics.encodedWidth < liveOutputMetrics.sourceWidth
      || liveOutputMetrics.encodedHeight < liveOutputMetrics.sourceHeight);

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
      {/* Top Action Header Bar */}
      <div className="absolute top-4 left-6 right-6 flex items-center justify-between z-20 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-gray-900/80 backdrop-blur border border-gray-800 px-3 py-1.5 rounded-full text-xs text-gray-300 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-white">
            {appMode === 'symmetry' ? 'Symmetry Canvas' : 'Polygon GIF Tiler'}
          </span>
          <span className="text-gray-500 font-mono">1080x1920</span>
          {import.meta.env.DEV && (
            <span ref={fpsRef} className="text-emerald-400 font-mono" />
          )}
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setShowLiveOutputModal(true)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors shadow-lg backdrop-blur",
              liveOutputStreaming
                ? "bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border-emerald-600/80"
                : liveOutputConnected
                  ? "bg-amber-950/90 hover:bg-amber-900 text-amber-200 border-amber-700/80"
                  : "bg-gray-900/80 hover:bg-gray-800 text-gray-200 border-gray-700/80"
            )}
          >
            {liveOutputBusy
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Radio className="w-3.5 h-3.5" />}
            {liveOutputStreaming ? 'Live' : 'Live Output'}
          </button>

          <button
            onClick={handleExportHighRes}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900/80 hover:bg-gray-800 text-gray-200 border border-gray-700/80 rounded-lg text-xs font-medium transition-colors shadow-lg backdrop-blur"
          >
            <Download className="w-3.5 h-3.5" />
            Export Image
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all"
          >
            <Video className="w-3.5 h-3.5" />
            Export Animation
          </button>
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

      {/* TouchDesigner WebRTC Live Output Modal */}
      {showLiveOutputModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 text-gray-100 shadow-2xl relative">
            <button
              onClick={() => setShowLiveOutputModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors"
              aria-label="Close live output settings"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <Radio className={cn(
                "w-5 h-5",
                liveOutputStreaming ? "text-emerald-400" : "text-indigo-400"
              )} />
              <h3 className="text-lg font-bold text-white">TouchDesigner Live Output</h3>
            </div>
            <p className="text-xs text-gray-400 mb-5">
              Stream the live 1080×1920 canvas over WebRTC using TouchDesigner&apos;s signaling server.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">
                  Signaling Server
                </label>
                <input
                  type="text"
                  value={liveOutputUrl}
                  onChange={(event) => setLiveOutputUrl(event.target.value)}
                  disabled={liveOutputConnected}
                  spellCheck={false}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-white disabled:text-gray-500 disabled:cursor-not-allowed outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  TouchDesigner&apos;s signalingServer COMP defaults to port 9980.
                </p>
              </div>

              <div className={cn(
                "rounded-lg border px-3 py-2 text-xs",
                liveOutputState.phase === 'error' || liveOutputActionError
                  ? "bg-red-950/40 border-red-900 text-red-300"
                  : liveOutputStreaming
                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                    : "bg-gray-950 border-gray-800 text-gray-300"
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    liveOutputState.phase === 'error' || liveOutputActionError
                      ? "bg-red-500"
                      : liveOutputStreaming
                        ? "bg-emerald-500 animate-pulse"
                        : liveOutputConnected ? "bg-amber-500" : "bg-gray-600"
                  )} />
                  <span>{liveOutputActionError ?? liveOutputState.message}</span>
                </div>
              </div>

              {liveOutputConnected && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">
                      Receiver
                    </label>
                    <select
                      value={selectedReceiverAddress}
                      onChange={(event) => setSelectedReceiverAddress(event.target.value)}
                      disabled={liveOutputState.receivers.length === 0 || liveOutputBusy || liveOutputStreaming}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white disabled:text-gray-500 outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {liveOutputState.receivers.length === 0 && (
                        <option value="">No receivers discovered</option>
                      )}
                      {liveOutputState.receivers.map((receiver) => (
                        <option key={receiver.id} value={receiver.address}>
                          {typeof receiver.properties.name === 'string'
                            ? `${receiver.properties.name} — ${receiver.address}`
                            : receiver.address}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">
                      Frame Rate
                    </label>
                    <select
                      value={liveOutputFps}
                      onChange={(event) => setLiveOutputFps(parseInt(event.target.value))}
                      disabled={liveOutputBusy || liveOutputStreaming}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white disabled:text-gray-500 outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value={30}>30 FPS — recommended</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </div>
                </>
              )}

              {liveOutputStreaming && liveOutputMetrics && (
                <div className="rounded-lg bg-gray-950 border border-gray-800 px-3 py-3">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Outbound Encoder
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <div className="text-[10px] text-gray-500">Source</div>
                      <div className="font-mono text-gray-200">
                        {liveOutputMetrics.sourceWidth}×{liveOutputMetrics.sourceHeight}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500">Encoded</div>
                      <div className={cn(
                        "font-mono",
                        liveOutputDownscaled ? "text-amber-300" : "text-emerald-300"
                      )}>
                        {liveOutputMetrics.encodedWidth !== undefined
                          && liveOutputMetrics.encodedHeight !== undefined
                          ? `${liveOutputMetrics.encodedWidth}×${liveOutputMetrics.encodedHeight}`
                          : 'Measuring…'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500">Encoded FPS</div>
                      <div className="font-mono text-gray-200">
                        {liveOutputMetrics.framesPerSecond === undefined
                          ? 'Measuring…'
                          : liveOutputMetrics.framesPerSecond.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500">Send Rate</div>
                      <div className="font-mono text-gray-200">
                        {liveOutputMetrics.bitrateMbps === undefined
                          ? 'Measuring…'
                          : `${liveOutputMetrics.bitrateMbps.toFixed(1)} Mbps`}
                      </div>
                    </div>
                  </div>
                  {liveOutputMetrics.qualityLimitationReason
                    && liveOutputMetrics.qualityLimitationReason !== 'none' && (
                    <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-amber-300">
                      WebRTC reports a {liveOutputMetrics.qualityLimitationReason} quality limit.
                    </div>
                  )}
                </div>
              )}

              {liveOutputState.qualityWarning && (
                <div className="rounded-lg bg-amber-950/30 border border-amber-900 px-3 py-2 text-[10px] leading-relaxed text-amber-200">
                  {liveOutputState.qualityWarning}
                </div>
              )}

              <div className="rounded-lg bg-indigo-950/20 border border-indigo-900/60 px-3 py-2 text-[10px] leading-relaxed text-indigo-200/80">
                In TouchDesigner, connect signalingClient and webRTC COMPs to the active signalingServer,
                then use a Video Stream In TOP in WebRTC mode followed by a Null TOP.
              </div>

              <div className="pt-3 border-t border-gray-800 flex items-center justify-between gap-2">
                {liveOutputConnected ? (
                  <button
                    onClick={disconnectLiveOutput}
                    className="px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg text-xs font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                ) : (
                  <span />
                )}

                {liveOutputStreaming || liveOutputState.phase === 'negotiating' ? (
                  <button
                    onClick={stopLiveOutput}
                    className="px-5 py-2 bg-red-700 hover:bg-red-600 text-white font-semibold rounded-lg text-xs transition-colors"
                  >
                    Stop Stream
                  </button>
                ) : liveOutputConnected ? (
                  <button
                    onClick={() => void startLiveOutput()}
                    disabled={!selectedReceiverAddress || liveOutputBusy}
                    className="flex items-center gap-2 px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs transition-colors"
                  >
                    {liveOutputBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Start Stream
                  </button>
                ) : (
                  <button
                    onClick={() => void connectLiveOutput()}
                    disabled={liveOutputBusy}
                    className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg text-xs transition-colors"
                  >
                    {liveOutputBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Find Receivers
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Options Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 text-gray-100 shadow-2xl relative">
            <button
              onClick={() => {
                isCancelExportRef.current = true;
                setShowExportModal(false);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-1">Export Animation</h3>
            <p className="text-xs text-gray-400 mb-5">Export sequence frames or video file for social media</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Export Format</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-950 rounded-lg border border-gray-800">
                  {([
                    { id: 'mp4', label: 'MP4 (H.264)', Icon: Film },
                    { id: 'webm', label: 'WebM (VP9)', Icon: Video },
                    ...(isNative() ? [{ id: 'prores', label: 'ProRes 4444', Icon: Clapperboard }] : []),
                    { id: 'gif', label: 'Animated GIF', Icon: Repeat },
                    { id: 'zip', label: 'Frames (ZIP)', Icon: Download }
                  ] as { id: 'mp4' | 'webm' | 'prores' | 'gif' | 'zip'; label: string; Icon: typeof Film }[]).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setExportType(id)}
                      className={cn(
                        "py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2",
                        exportType === id ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
                {(exportType === 'mp4' || exportType === 'webm') && !supportsWebCodecs() && (
                  <p className="text-[10px] text-amber-400/90 mt-1.5">
                    WebCodecs is unavailable in this browser — video will be recorded in real time as WebM.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Resolution</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'full', label: '1080x1920', sub: 'Full 1080p' },
                    { id: 'hd', label: '720x1280', sub: 'HD Ready' },
                    { id: 'compact', label: '540x960', sub: 'Compact' }
                  ].map((res) => (
                    <button
                      key={res.id}
                      onClick={() => setExportResolution(res.id as 'full' | 'hd' | 'compact')}
                      className={cn(
                        "p-2 rounded-lg border text-left transition-colors",
                        exportResolution === res.id
                          ? "bg-indigo-950/50 border-indigo-500 text-white"
                          : "bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700"
                      )}
                    >
                      <div className="text-xs font-semibold">{res.label}</div>
                      <div className="text-[10px] text-gray-500">{res.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">Duration (Sec)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={exportDuration}
                    onChange={(e) => setExportDuration(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">FPS</label>
                  <select
                    value={exportFps}
                    onChange={(e) => setExportFps(parseInt(e.target.value))}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value={15}>15 FPS</option>
                    <option value={30}>30 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>
                </div>
              </div>

              {exportType === 'zip' && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Image File Format</label>
                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="format"
                        value="png"
                        checked={exportFormat === 'png'}
                        onChange={() => setExportFormat('png')}
                        className="accent-indigo-500"
                      />
                      PNG (Lossless)
                    </label>
                    <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="format"
                        value="jpeg"
                        checked={exportFormat === 'jpeg'}
                        onChange={() => setExportFormat('jpeg')}
                        className="accent-indigo-500"
                      />
                      JPEG (Smaller ZIP)
                    </label>
                  </div>
                </div>
              )}

              {/* Exporting Progress bar */}
              {exportJob && (
                <div className="p-3 bg-gray-950 rounded-lg border border-gray-800 space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>{exportJob.label}</span>
                    <span>{Math.round(exportJob.percent)}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-150"
                      style={{ width: `${exportJob.percent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-gray-800 flex justify-end gap-2">
                <button
                  onClick={() => {
                    isCancelExportRef.current = true;
                    setShowExportModal(false);
                  }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={startExport}
                  disabled={exportJob !== null}
                  className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg text-xs shadow-lg shadow-indigo-600/20 transition-all"
                >
                  {exportJob !== null && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Start Export
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
