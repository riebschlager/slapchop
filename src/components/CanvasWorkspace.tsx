import React, { useRef, useState, useEffect } from 'react';
import { Layer, PolygonLayer, PolygonPoint, MotionConfig, GifData, AppMode } from '../types';
import { cn } from '../lib/utils';
import { Download, Video, X, Loader2, PenTool } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getGifFrameAtTime } from '../lib/gifUtils';
import { getPolygonCentroid, isPointInPolygon } from '../lib/polygonUtils';

function getExportTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  'normal': 'source-over',
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'difference': 'difference',
  'exclusion': 'exclusion',
  'hue': 'hue',
  'saturation': 'saturation',
  'color': 'color',
  'luminosity': 'luminosity'
};

const imageCache = new Map<string, HTMLImageElement>();
function getCachedImage(src?: string): HTMLImageElement | null {
  if (!src) return null;
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

interface Props {
  appMode: AppMode;
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onAddLayer: (file: File, x: number, y: number) => void;

  polygonLayers: PolygonLayer[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  onUpdatePolygon: (id: string, updates: Partial<PolygonLayer>) => void;

  isDrawingPolygon: boolean;
  onFinishDrawingPolygon: (points: PolygonPoint[]) => void;
  onCancelDrawingPolygon: () => void;

  canvasBg: string;
}

export default function CanvasWorkspace({
  appMode,
  layers,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onAddLayer,
  polygonLayers,
  selectedPolygonId,
  onSelectPolygon,
  onUpdatePolygon,
  isDrawingPolygon,
  onFinishDrawingPolygon,
  onCancelDrawingPolygon,
  canvasBg
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [scale, setScale] = useState(1);
  const [time, setTime] = useState(0);

  // Drawing mode points state
  const [drawingPoints, setDrawingPoints] = useState<PolygonPoint[]>([]);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<PolygonPoint | null>(null);

  // Dragging vertex state
  const [draggedVertexIndex, setDraggedVertexIndex] = useState<number | null>(null);

  // Export settings state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<'zip' | 'webm'>('zip');
  const [exportResolution, setExportResolution] = useState<'full' | 'hd' | 'compact'>('hd');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png');
  const [exportDuration, setExportDuration] = useState<number>(3);
  const [exportFps, setExportFps] = useState<number>(30);

  // Active export progress state
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; status: 'rendering' | 'zipping' }>({ current: 0, total: 0, status: 'rendering' });
  const [zipPercent, setZipPercent] = useState(0);

  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoTime, setVideoTime] = useState(0);

  const isCancelExportRef = useRef(false);
  const isRecordingVideoRef = useRef(false);

  // Native canvas resolution
  const CANVAS_WIDTH = 1080;
  const CANVAS_HEIGHT = 1920;

  useEffect(() => {
    let animationFrameId: number;
    const startTime = performance.now();
    const loop = (t: number) => {
      setTime((t - startTime) / 1000);
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  useEffect(() => {
    const updateScale = () => {
      if (wrapRef.current) {
        const rect = wrapRef.current.getBoundingClientRect();
        const scaleX = (rect.width - 80) / CANVAS_WIDTH;
        const scaleY = (rect.height - 80) / CANVAS_HEIGHT;
        setScale(Math.min(scaleX, scaleY, 1));
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Reset drawing state when toggled
  useEffect(() => {
    if (!isDrawingPolygon) {
      setDrawingPoints([]);
      setMouseCanvasPos(null);
    }
  }, [isDrawingPolygon]);

  const applyMotion = (baseValue: number, config: MotionConfig | undefined, t: number): number => {
    if (!config || config.type === 'none') return baseValue;
    if (config.type === 'sine') {
      return baseValue + Math.sin(t * config.speed * Math.PI * 2 + config.phase) * config.amplitude;
    }
    if (config.type === 'noise') {
      const noise = Math.sin(t * config.speed * 1.5 + config.phase) 
                  * Math.sin(t * config.speed * 0.8 + config.phase * 1.3)
                  * Math.cos(t * config.speed * 2.2 - config.phase);
      return baseValue + noise * config.amplitude;
    }
    return baseValue;
  };

  const getModulatedLayer = (layer: Layer, t: number): Layer => {
    return {
      ...layer,
      x: applyMotion(layer.x, layer.motionX, t),
      y: applyMotion(layer.y, layer.motionY, t),
      rotation: applyMotion(layer.rotation, layer.motionRotation, t),
      scaleX: Math.sign(layer.scaleX || 1) * applyMotion(Math.abs(layer.scaleX), layer.motionScale, t),
      scaleY: Math.sign(layer.scaleY || 1) * applyMotion(Math.abs(layer.scaleY), layer.motionScale, t),
    };
  };

  const getInstances = (layer: Layer, t: number) => {
    const modulatedLayer = getModulatedLayer(layer, t);
    switch (modulatedLayer.symmetry) {
      case 'none':
        return [{ ...modulatedLayer, isPrimary: true }];
      case 'mirror-x':
        return [
          { ...modulatedLayer, isPrimary: true },
          { ...modulatedLayer, x: -modulatedLayer.x, rotation: -modulatedLayer.rotation, scaleX: -modulatedLayer.scaleX, isPrimary: false }
        ];
      case 'mirror-y':
        return [
          { ...modulatedLayer, isPrimary: true },
          { ...modulatedLayer, y: -modulatedLayer.y, rotation: -modulatedLayer.rotation, scaleY: -modulatedLayer.scaleY, isPrimary: false }
        ];
      case 'quad':
        return [
          { ...modulatedLayer, isPrimary: true },
          { ...modulatedLayer, x: -modulatedLayer.x, rotation: -modulatedLayer.rotation, scaleX: -modulatedLayer.scaleX, isPrimary: false },
          { ...modulatedLayer, y: -modulatedLayer.y, rotation: -modulatedLayer.rotation, scaleY: -modulatedLayer.scaleY, isPrimary: false },
          { ...modulatedLayer, x: -modulatedLayer.x, y: -modulatedLayer.y, rotation: modulatedLayer.rotation, scaleX: -modulatedLayer.scaleX, scaleY: -modulatedLayer.scaleY, isPrimary: false }
        ];
      case 'radial': {
        const instances = [];
        const N = Math.max(2, modulatedLayer.radialSegments || 6);
        for (let i = 0; i < N; i++) {
          const angle = i * (2 * Math.PI / N);
          const deg = i * (360 / N);
          const nx = modulatedLayer.x * Math.cos(angle) - modulatedLayer.y * Math.sin(angle);
          const ny = modulatedLayer.x * Math.sin(angle) + modulatedLayer.y * Math.cos(angle);
          instances.push({
            ...modulatedLayer,
            x: nx,
            y: ny,
            rotation: modulatedLayer.rotation + deg,
            isPrimary: i === 0
          });
        }
        return instances;
      }
      default:
        return [{ ...modulatedLayer, isPrimary: true }];
    }
  };

  const hitTestLayer = (layer: Layer, coords: PolygonPoint): boolean => {
    if (layer.hidden) return false;
    const instances = getInstances(layer, time);

    let w = 200;
    let h = 200;
    if (layer.gifData) {
      w = layer.gifData.width || 200;
      h = layer.gifData.height || 200;
    } else if (layer.src) {
      const img = getCachedImage(layer.src);
      if (img) {
        w = img.naturalWidth || 200;
        h = img.naturalHeight || 200;
      }
    }

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

  const renderPolygonToCtx = (
    ctx: CanvasRenderingContext2D,
    polygon: PolygonLayer,
    t: number,
    width: number,
    height: number
  ) => {
    if (!polygon.points || polygon.points.length < 3) return;

    const scaleVal = applyMotion(polygon.textureScale ?? 1, polygon.motionTextureScale, t);
    const rotationVal = applyMotion(polygon.textureRotation ?? 0, polygon.motionTextureRotation, t);
    const offsetX = applyMotion(polygon.textureOffsetX ?? 0, polygon.motionTextureOffsetX, t);
    const offsetY = applyMotion(polygon.textureOffsetY ?? 0, polygon.motionTextureOffsetY, t);

    const scaleX = width / CANVAS_WIDTH;
    const scaleY = height / CANVAS_HEIGHT;

    ctx.save();

    // Create path for polygon
    ctx.beginPath();
    polygon.points.forEach((pt, i) => {
      const px = (width / 2) + pt.x * scaleX;
      const py = (height / 2) + pt.y * scaleY;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();

    ctx.globalAlpha = Math.max(0, Math.min(1, polygon.opacity));
    ctx.globalCompositeOperation = BLEND_MAP[polygon.blendMode] || 'source-over';

    let frameSource: CanvasImageSource | null = null;
    if (polygon.gifData) {
      const frameCanvas = getGifFrameAtTime(polygon.gifData, t, polygon.gifSpeed ?? 1);
      if (frameCanvas) frameSource = frameCanvas;
    }

    if (!frameSource && polygon.src) {
      const imgEl = getCachedImage(polygon.src);
      if (imgEl) {
        frameSource = imgEl;
      }
    }

    if (frameSource) {
      try {
        const pattern = ctx.createPattern(frameSource, 'repeat');
        if (pattern) {
          if ('setTransform' in pattern) {
            const matrix = new DOMMatrix();
            matrix.translateSelf(offsetX, offsetY);
            matrix.scaleSelf(Math.max(0.01, scaleVal), Math.max(0.01, scaleVal));
            matrix.rotateSelf(rotationVal);
            pattern.setTransform(matrix);
          }
          ctx.fillStyle = pattern;
          ctx.fill();
        }
      } catch (err) {
        console.warn("Pattern fill failed:", err);
        ctx.fillStyle = polygon.fillColor || '#6366f1';
        ctx.fill();
      }
    } else {
      ctx.fillStyle = polygon.fillColor || '#6366f1';
      ctx.fill();
    }

    if (polygon.strokeWidth > 0 && polygon.strokeColor && polygon.strokeColor !== 'transparent') {
      ctx.lineWidth = polygon.strokeWidth * Math.min(scaleX, scaleY);
      ctx.strokeStyle = polygon.strokeColor;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    ctx.restore();
  };

  const renderToCanvas = (
    canvas: HTMLCanvasElement,
    t: number,
    width: number = CANVAS_WIDTH,
    height: number = CANVAS_HEIGHT
  ) => {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, width, height);

    if (appMode === 'symmetry') {
      const scaleX = width / CANVAS_WIDTH;
      const scaleY = height / CANVAS_HEIGHT;

      layers.forEach((layer) => {
        if (layer.hidden) return;
        const instances = getInstances(layer, t);
        instances.forEach((inst) => {
          let drawSource: CanvasImageSource | null = null;
          let w = 100;
          let h = 100;

          if (layer.gifData) {
            const gifCanvas = getGifFrameAtTime(layer.gifData, t, layer.gifSpeed ?? 1);
            if (gifCanvas) {
              drawSource = gifCanvas;
              w = layer.gifData.width;
              h = layer.gifData.height;
            }
          }

          if (!drawSource) {
            const imgEl = getCachedImage(layer.src);
            if (imgEl) {
              drawSource = imgEl;
              w = imgEl.naturalWidth || 100;
              h = imgEl.naturalHeight || 100;
            }
          }

          if (!drawSource) return;

          ctx.save();
          ctx.translate((width / 2) + inst.x * scaleX, (height / 2) + inst.y * scaleY);
          ctx.rotate((inst.rotation * Math.PI) / 180);
          ctx.scale(inst.scaleX * scaleX, inst.scaleY * scaleY);

          ctx.globalAlpha = Math.max(0, Math.min(1, inst.opacity));
          ctx.globalCompositeOperation = BLEND_MAP[inst.blendMode] || 'source-over';

          try {
            ctx.drawImage(drawSource, -w / 2, -h / 2, w, h);
          } catch (e) {
            console.warn("Canvas drawImage failed:", e);
          }
          ctx.restore();
        });
      });
    } else if (appMode === 'polygon') {
      polygonLayers.forEach((polygon) => {
        if (polygon.hidden) return;
        renderPolygonToCtx(ctx, polygon, t, width, height);
      });
    }
  };

  // Keep canvas rendered each frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      renderToCanvas(canvas, time, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, [time, layers, polygonLayers, appMode, canvasBg]);

  // Convert mouse event to canvas relative space coordinates
  const getCanvasCoords = (e: React.MouseEvent | MouseEvent): PolygonPoint | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const x = (e.clientX - rect.left - cx) / scale;
    const y = (e.clientY - rect.top - cy) / scale;
    return { x, y };
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e);
    if (coords && isDrawingPolygon) {
      setMouseCanvasPos(coords);
    }
  };

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (isDrawingPolygon) return;

    if (appMode === 'polygon') {
      const coords = getCanvasCoords(e);
      if (!coords) return;

      // Hit-test polygon layers from top to bottom
      for (let i = polygonLayers.length - 1; i >= 0; i--) {
        const poly = polygonLayers[i];
        if (poly.hidden) continue;

        if (isPointInPolygon(coords, poly.points)) {
          onSelectPolygon(poly.id);

          // Initiate dragging polygon
          const startCoords = coords;
          const initialPoints = [...poly.points];

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const currentCoords = getCanvasCoords(moveEvent);
            if (!currentCoords) return;

            const dx = currentCoords.x - startCoords.x;
            const dy = currentCoords.y - startCoords.y;

            const movedPoints = initialPoints.map(pt => ({
              x: pt.x + dx,
              y: pt.y + dy
            }));

            onUpdatePolygon(poly.id, { points: movedPoints });
          };

          const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };

          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
          return;
        }
      }

      // If clicked empty canvas background, deselect current polygon
      onSelectPolygon(null);
    } else if (appMode === 'symmetry') {
      const coords = getCanvasCoords(e);
      if (!coords) return;

      // Hit-test symmetry layers from top to bottom (highest z-index first)
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer.hidden) continue;

        if (hitTestLayer(layer, coords)) {
          onSelectLayer(layer.id);

          // Initiate dragging layer on canvas
          const startCoords = coords;
          const startX = layer.x;
          const startY = layer.y;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const currentCoords = getCanvasCoords(moveEvent);
            if (!currentCoords) return;

            const dx = currentCoords.x - startCoords.x;
            const dy = currentCoords.y - startCoords.y;

            onUpdateLayer(layer.id, {
              x: startX + dx,
              y: startY + dy
            });
          };

          const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };

          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
          return;
        }
      }

      // If clicked background without hitting any layer
      onSelectLayer(null);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!isDrawingPolygon) return;
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

  const handleContainerDoubleClick = (e: React.MouseEvent) => {
    if (!isDrawingPolygon) return;
    e.stopPropagation();
    if (drawingPoints.length >= 3) {
      onFinishDrawingPolygon(drawingPoints);
      setDrawingPoints([]);
      setMouseCanvasPos(null);
    }
  };

  // Dragging vertex or whole polygon
  const handleVertexMouseDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setDraggedVertexIndex(index);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const coords = getCanvasCoords(moveEvent);
      if (coords && selectedPolygonId) {
        const poly = polygonLayers.find(p => p.id === selectedPolygonId);
        if (poly) {
          const newPoints = [...poly.points];
          newPoints[index] = coords;
          onUpdatePolygon(selectedPolygonId, { points: newPoints });
        }
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setDraggedVertexIndex(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handlePolygonCenterMouseDown = (e: React.MouseEvent, polygonId: string) => {
    e.stopPropagation();
    onSelectPolygon(polygonId);

    const poly = polygonLayers.find(p => p.id === polygonId);
    if (!poly) return;

    const startCoords = getCanvasCoords(e);
    if (!startCoords) return;

    const initialPoints = [...poly.points];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentCoords = getCanvasCoords(moveEvent);
      if (!currentCoords) return;

      const dx = currentCoords.x - startCoords.x;
      const dy = currentCoords.y - startCoords.y;

      const movedPoints = initialPoints.map(pt => ({
        x: pt.x + dx,
        y: pt.y + dy
      }));

      onUpdatePolygon(polygonId, { points: movedPoints });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleLayerCenterMouseDown = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    onSelectLayer(layerId);

    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const startCoords = getCanvasCoords(e);
    if (!startCoords) return;

    const startX = layer.x;
    const startY = layer.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentCoords = getCanvasCoords(moveEvent);
      if (!currentCoords) return;

      const dx = currentCoords.x - startCoords.x;
      const dy = currentCoords.y - startCoords.y;

      onUpdateLayer(layerId, {
        x: startX + dx,
        y: startY + dy
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
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

  const handleExportHighRes = () => {
    try {
      const canvas = document.createElement('canvas');
      renderToCanvas(canvas, time, CANVAS_WIDTH, CANVAS_HEIGHT);
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `prism-art-${getExportTimestamp()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("High-Res export failed", e);
    }
  };

  const startZipSequenceExport = async () => {
    setIsExportingZip(true);
    isCancelExportRef.current = false;
    setZipPercent(0);

    const [resW, resH] = exportResolution === 'full' ? [1080, 1920]
                       : exportResolution === 'hd' ? [720, 1280]
                       : [540, 960];

    const fps = exportFps;
    const totalFrames = Math.round(fps * exportDuration);
    setExportProgress({ current: 0, total: totalFrames, status: 'rendering' });

    const zip = new JSZip();
    const offscreenCanvas = document.createElement('canvas');
    const ext = exportFormat === 'jpeg' ? 'jpg' : 'png';
    const mimeType = exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png';

    for (let frame = 0; frame < totalFrames; frame++) {
      if (isCancelExportRef.current) {
        setIsExportingZip(false);
        return;
      }

      const frameTime = frame * (1 / fps);
      renderToCanvas(offscreenCanvas, frameTime, resW, resH);

      const blob = await new Promise<Blob | null>((resolve) => {
        offscreenCanvas.toBlob((b) => resolve(b), mimeType, 0.92);
      });

      if (blob) {
        const filename = `frame_${String(frame + 1).padStart(5, '0')}.${ext}`;
        zip.file(filename, blob);
      }

      setExportProgress({ current: frame + 1, total: totalFrames, status: 'rendering' });
      await new Promise((r) => setTimeout(r, 10));
    }

    if (isCancelExportRef.current) {
      setIsExportingZip(false);
      return;
    }

    setExportProgress({ current: totalFrames, total: totalFrames, status: 'zipping' });

    try {
      const zipContent = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipPercent(Math.round(metadata.percent));
      });

      const timestamp = getExportTimestamp();
      saveAs(zipContent, `prism-sequence-${timestamp}-${exportResolution}-${exportDuration}s.zip`);
      setShowExportModal(false);
    } catch (e) {
      console.error("ZIP Generation error:", e);
    } finally {
      setIsExportingZip(false);
    }
  };

  const startWebMVideoExport = async () => {
    setIsRecordingVideo(true);
    isRecordingVideoRef.current = true;
    setVideoTime(0);

    const [resW, resH] = exportResolution === 'full' ? [1080, 1920]
                       : exportResolution === 'hd' ? [720, 1280]
                       : [540, 960];

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
      const blob = new Blob(chunks, { type: 'video/webm' });
      const timestamp = getExportTimestamp();
      saveAs(blob, `prism-video-${timestamp}-${exportDuration}s.webm`);
      setIsRecordingVideo(false);
      setShowExportModal(false);
    };

    mediaRecorder.start();

    const startTime = performance.now();
    const interval = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      setVideoTime(elapsed);

      renderToCanvas(offscreenCanvas, elapsed, resW, resH);

      if (elapsed >= exportDuration || !isRecordingVideoRef.current) {
        clearInterval(interval);
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      }
    }, 1000 / exportFps);
  };

  const selectedPolygon = polygonLayers.find(p => p.id === selectedPolygonId);
  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  return (
    <div 
      ref={wrapRef} 
      className="flex-1 bg-gray-950 flex items-center justify-center relative overflow-hidden select-none"
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
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
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
          <span>Click canvas to add vertices ({drawingPoints.length} added). Double-click or click start point to close.</span>
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
              onCancelDrawingPolygon();
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
        onClick={handleContainerClick}
        onDoubleClick={handleContainerDoubleClick}
        onMouseMove={handleContainerMouseMove}
        className={cn(
          "relative shadow-2xl transition-all duration-75 overflow-hidden",
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
            {/* Draw active polygon guidance line */}
            {isDrawingPolygon && (
              <svg className="w-full h-full absolute inset-0 pointer-events-none">
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
                {/* Center Translation Handle */}
                {(() => {
                  const center = getPolygonCentroid(selectedPolygon.points);
                  const cx = (CANVAS_WIDTH / 2 + center.x) * scale;
                  const cy = (CANVAS_HEIGHT / 2 + center.y) * scale;
                  return (
                    <div
                      onMouseDown={(e) => handlePolygonCenterMouseDown(e, selectedPolygon.id)}
                      style={{ left: `${cx}px`, top: `${cy}px` }}
                      className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-indigo-600/90 hover:bg-indigo-500 border-2 border-white shadow-xl pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform hover:scale-125 z-20"
                      title="Drag to Move Polygon"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  );
                })()}

                {/* Vertex Point Handles */}
                {selectedPolygon.points.map((pt, i) => {
                  const vx = (CANVAS_WIDTH / 2 + pt.x) * scale;
                  const vy = (CANVAS_HEIGHT / 2 + pt.y) * scale;
                  return (
                    <div
                      key={`v-handle-${i}`}
                      onMouseDown={(e) => handleVertexMouseDown(e, i)}
                      style={{ left: `${vx}px`, top: `${vy}px` }}
                      className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-white border-2 border-indigo-600 shadow-md pointer-events-auto cursor-move hover:scale-150 transition-transform z-20"
                      title={`Vertex ${i + 1}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Symmetry Mode Layer Interactive Handle Overlay */}
        {appMode === 'symmetry' && selectedLayer && !selectedLayer.hidden && (
          <div className="absolute inset-0 pointer-events-none">
            {getInstances(selectedLayer, time).map((inst, idx) => {
              let w = 200;
              let h = 200;
              if (selectedLayer.gifData) {
                w = selectedLayer.gifData.width || 200;
                h = selectedLayer.gifData.height || 200;
              } else if (selectedLayer.src) {
                const img = getCachedImage(selectedLayer.src);
                if (img) {
                  w = img.naturalWidth || 200;
                  h = img.naturalHeight || 200;
                }
              }
              const cx = (CANVAS_WIDTH / 2 + inst.x) * scale;
              const cy = (CANVAS_HEIGHT / 2 + inst.y) * scale;
              const boxW = w * Math.abs(inst.scaleX) * scale;
              const boxH = h * Math.abs(inst.scaleY) * scale;

              return (
                <div
                  key={`layer-select-outline-${inst.isPrimary ? 'primary' : 'sym'}-${idx}`}
                  style={{
                    left: `${cx}px`,
                    top: `${cy}px`,
                    width: `${boxW}px`,
                    height: `${boxH}px`,
                    transform: `translate(-50%, -50%) rotate(${inst.rotation}deg)`,
                  }}
                  className={cn(
                    "absolute border-2 pointer-events-none rounded transition-opacity",
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
              );
            })}
          </div>
        )}
      </div>

      {/* Export Options Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 text-gray-100 shadow-2xl relative">
            <button 
              onClick={() => {
                if (isExportingZip) isCancelExportRef.current = true;
                if (isRecordingVideo) isRecordingVideoRef.current = false;
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
                  <button
                    onClick={() => setExportType('zip')}
                    className={cn(
                      "py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2",
                      exportType === 'zip' ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
                    )}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Frame Sequence (ZIP)
                  </button>
                  <button
                    onClick={() => setExportType('webm')}
                    className={cn(
                      "py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2",
                      exportType === 'webm' ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
                    )}
                  >
                    <Video className="w-3.5 h-3.5" />
                    WebM Video
                  </button>
                </div>
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
                      onClick={() => setExportResolution(res.id as any)}
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
              {isExportingZip && (
                <div className="p-3 bg-gray-950 rounded-lg border border-gray-800 space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>{exportProgress.status === 'rendering' ? `Rendering Frame ${exportProgress.current}/${exportProgress.total}...` : 'Compressing ZIP file...'}</span>
                    <span>{exportProgress.status === 'rendering' ? `${Math.round((exportProgress.current / exportProgress.total) * 100)}%` : `${zipPercent}%`}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-150" 
                      style={{ width: `${exportProgress.status === 'rendering' ? (exportProgress.current / exportProgress.total) * 100 : zipPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {isRecordingVideo && (
                <div className="p-3 bg-gray-950 rounded-lg border border-gray-800 space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      Recording WebM Video...
                    </span>
                    <span>{videoTime.toFixed(1)}s / {exportDuration}s</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-red-500 transition-all duration-150" 
                      style={{ width: `${Math.min(100, (videoTime / exportDuration) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-gray-800 flex justify-end gap-2">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (exportType === 'zip') startZipSequenceExport();
                    else startWebMVideoExport();
                  }}
                  disabled={isExportingZip || isRecordingVideo}
                  className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg text-xs shadow-lg shadow-indigo-600/20 transition-all"
                >
                  {(isExportingZip || isRecordingVideo) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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
