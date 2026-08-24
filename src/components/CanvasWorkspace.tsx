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
import { Vec3 } from '../lib/mat4';
import {
  createScreen3dProjector,
  getMesh3dPrimaryOrigin,
  pickMesh3dAt,
  ScreenPoint,
  Screen3dProjector
} from '../lib/project3d';
import {
  DOLLY_PER_DRAG_PIXEL,
  DOLLY_PER_WHEEL_UNIT,
  dollyCamera,
  orbitCamera,
  panCameraTarget
} from '../lib/camera3dNav';
import { pauseHistory, resumeHistory, useStore } from '../store';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  getLayerSize
} from '../renderer/render2d';
import { getActiveRendererName, getPlaybackTime, startRenderLoop } from '../renderer/loop';
import { imageFilesFromPaths, isNative, openProjectFromPath } from '../lib/native';
import { WORKSPACE_FIT_MARGIN } from '../lib/layout';

// Translate gizmo arms, in the order they are rendered. Colors follow the
// near-universal X=red / Y=green / Z=blue convention so the axes read without
// a legend; the arms are drawn from the mesh's own origin along *world* axes,
// which is what the drag math below moves the layer along.
const GIZMO_AXES: { key: 'x' | 'y' | 'z'; label: string; dir: Vec3; color: string }[] = [
  { key: 'x', label: 'X', dir: [1, 0, 0], color: '#f87171' },
  { key: 'y', label: 'Y', dir: [0, 1, 0], color: '#4ade80' },
  { key: 'z', label: 'Z', dir: [0, 0, 1], color: '#60a5fa' }
];

// Arm length in canvas pixels. Converted to world units at the mesh's own
// depth every frame so the gizmo stays the same on-screen size no matter how
// far the camera is dollied out.
const GIZMO_ARM_PIXELS = 130;

/** Camera-relative gestures the 3D viewport recognizes on mouse-down. */
type Camera3dGesture = 'orbit' | 'pan' | 'dolly';

/** Gizmo arm length in world units at the depth of the thing it is attached to. */
function gizmoArmWorldLength(projector: Screen3dProjector, center: ScreenPoint): number {
  return projector.worldPerPixel(center.viewZ) * GIZMO_ARM_PIXELS;
}

/**
 * Which camera gesture a mouse-down starts, if any. Alt+left/right/middle
 * mirrors the orbit/dolly/pan bindings most 3D tools use; Shift+left and a
 * bare middle-drag are added because trackpads and two-button mice cannot
 * always produce the Alt+middle chord.
 */
function camera3dGestureFor(e: React.MouseEvent): Camera3dGesture | null {
  if (e.button === 1) return 'pan';
  if (e.altKey) {
    if (e.button === 0) return 'orbit';
    if (e.button === 2) return 'dolly';
  }
  if (e.shiftKey && e.button === 0) return 'pan';
  return null;
}

export default function CanvasWorkspace({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const appMode = useStore(s => s.appMode);
  const layers = useStore(s => s.layers);
  const polygonLayers = useStore(s => s.polygonLayers);
  const selectedLayerId = useStore(s => s.selectedLayerId);
  const selectedPolygonId = useStore(s => s.selectedPolygonId);
  const mesh3dLayers = useStore(s => s.mesh3dLayers);
  const flythroughAssets = useStore(s => s.flythroughAssets);
  const tunnelAssets = useStore(s => s.tunnelAssets);
  const tunnel = useStore(s => s.tunnel);
  const selectedMesh3dId = useStore(s => s.selectedMesh3dId);
  const isDrawingPolygon = useStore(s => s.isDrawingPolygon);
  const canvasBg = useStore(s => s.canvasBg);

  const onSelectLayer = useStore(s => s.selectLayer);
  const onUpdateLayer = useStore(s => s.updateLayer);
  const onAddLayer = useStore(s => s.addLayerFromFile);
  const onSelectPolygon = useStore(s => s.selectPolygon);
  const onUpdatePolygon = useStore(s => s.updatePolygon);
  const onFinishDrawingPolygon = useStore(s => s.finishDrawingPolygon);
  const onToggleDrawPolygon = useStore(s => s.toggleDrawPolygon);
  const onSelectMesh3d = useStore(s => s.selectMesh3d);
  const onUpdateMesh3d = useStore(s => s.updateMesh3d);
  const onUpdateCamera3d = useStore(s => s.updateCamera3d);
  const onReplaceFlythroughAssets = useStore(s => s.replaceFlythroughAssets);
  const onAddTunnelAssets = useStore(s => s.addTunnelAssets);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const symOverlayRef = useRef<HTMLDivElement>(null);
  const statusPillRef = useRef<HTMLDivElement>(null);
  // 3D translate gizmo: positioned imperatively every frame (see the rAF tick
  // below), so these are the only handles React does not lay out itself.
  const gizmoRef = useRef<HTMLDivElement>(null);
  const gizmoCenterRef = useRef<HTMLDivElement>(null);
  const gizmoArmRefs = useRef<(SVGLineElement | null)[]>([]);
  const gizmoHandleRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // Whether a camera-navigation modifier is held, purely so the cursor can
  // advertise that dragging the 3D viewport will move the camera.
  const [camera3dNavArmed, setCamera3dNavArmed] = useState(false);
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
          if (useStore.getState().appMode === 'flythrough') {
            await useStore.getState().replaceFlythroughAssets(files);
            return;
          }
          if (useStore.getState().appMode === 'tunnel') {
            await useStore.getState().addTunnelAssets(files);
            return;
          }
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
  const selectedMesh = mesh3dLayers.find(m => m.id === selectedMesh3dId);

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

  // 3D translate gizmo overlay. Like the symmetry overlay above, positions are
  // written straight to the DOM each frame rather than through state: the
  // mesh's origin moves under its own motion modulators and the camera's
  // wobble, so the handles have to track the rendered frame, not React's
  // render cadence.
  useEffect(() => {
    if (appMode !== '3d' || !selectedMesh3dId) return;
    let raf = 0;
    const tick = () => {
      const root = gizmoRef.current;
      if (root) {
        const state = useStore.getState();
        const mesh = state.mesh3dLayers.find(m => m.id === selectedMesh3dId);
        const t = getPlaybackTime();
        const projector = createScreen3dProjector(state.camera3d, t, CANVAS_WIDTH, CANVAS_HEIGHT);
        const origin = mesh && !mesh.hidden ? getMesh3dPrimaryOrigin(mesh, t) : null;
        const center = origin ? projector.project(origin) : null;
        const s = scaleRef.current;

        if (origin && center) {
          root.style.visibility = 'visible';
          const centerEl = gizmoCenterRef.current;
          if (centerEl) {
            centerEl.style.left = `${center.x * s}px`;
            centerEl.style.top = `${center.y * s}px`;
          }

          const armWorld = gizmoArmWorldLength(projector, center);
          GIZMO_AXES.forEach((axis, i) => {
            const tip = projector.project([
              origin[0] + axis.dir[0] * armWorld,
              origin[1] + axis.dir[1] * armWorld,
              origin[2] + axis.dir[2] * armWorld
            ]);
            const arm = gizmoArmRefs.current[i];
            const handle = gizmoHandleRefs.current[i];
            // An arm pointing straight at (or behind) the camera has no usable
            // screen direction, so it is hidden instead of collapsing onto the
            // center handle where it could not be aimed anyway.
            const usable = tip && Math.hypot(tip.x - center.x, tip.y - center.y) > 1;
            if (arm) {
              arm.style.visibility = usable ? 'visible' : 'hidden';
              if (tip && usable) {
                arm.setAttribute('x1', `${center.x * s}`);
                arm.setAttribute('y1', `${center.y * s}`);
                arm.setAttribute('x2', `${tip.x * s}`);
                arm.setAttribute('y2', `${tip.y * s}`);
              }
            }
            if (handle) {
              handle.style.visibility = usable ? 'visible' : 'hidden';
              if (tip && usable) {
                handle.style.left = `${tip.x * s}px`;
                handle.style.top = `${tip.y * s}px`;
              }
            }
          });
        } else {
          root.style.visibility = 'hidden';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [appMode, selectedMesh3dId]);

  // Wheel dolly. Registered non-passively so the page cannot scroll out from
  // under the gesture, and only while 3D mode owns the viewport. A burst of
  // notches collapses into one undo entry: the first notch is recorded, then
  // history pauses until the wheel goes quiet — the same shape as beginDrag.
  useEffect(() => {
    if (appMode !== '3d') return;
    const el = containerRef.current;
    if (!el) return;
    let coalescing = false;
    let idleTimer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaY arrives in pixels, lines, or pages depending on the device.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const { camera3d, updateCamera3d } = useStore.getState();
      updateCamera3d(dollyCamera(camera3d, e.deltaY * unit * DOLLY_PER_WHEEL_UNIT));
      if (!coalescing) {
        pauseHistory();
        coalescing = true;
      }
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        coalescing = false;
        resumeHistory();
      }, 400);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(idleTimer);
      if (coalescing) resumeHistory();
    };
  }, [appMode]);

  // Cursor affordance for camera navigation. Tracks the modifier itself rather
  // than an active drag so the viewport shows what a drag *would* do.
  useEffect(() => {
    if (appMode !== '3d') {
      setCamera3dNavArmed(false);
      return;
    }
    const sync = (e: KeyboardEvent) => setCamera3dNavArmed(e.altKey || e.shiftKey);
    const clear = () => setCamera3dNavArmed(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
      setCamera3dNavArmed(false);
    };
  }, [appMode]);

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
    } else if (appMode === '3d') {
      handleMesh3dMouseDown(e, coords);
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

  // ------------------------------------------------------------- 3D viewport

  /**
   * Camera gestures read the pose once, at grab time, and apply the whole
   * gesture as an offset from it — so a gesture stays predictable even while
   * camera motion wobble keeps animating underneath it.
   *
   * Orbit and dolly work in CSS pixels (a screen-space gesture should feel the
   * same regardless of the fit-to-window zoom), while pan works in canvas
   * pixels because it maps to world units through the projector.
   */
  const startCamera3dGesture = (gesture: Camera3dGesture, e: React.MouseEvent) => {
    const startCamera = useStore.getState().camera3d;
    const projector = createScreen3dProjector(startCamera, getPlaybackTime(), CANVAS_WIDTH, CANVAS_HEIGHT);
    const startX = e.clientX;
    const startY = e.clientY;

    beginDrag((moveEvent) => {
      const dxCss = moveEvent.clientX - startX;
      const dyCss = moveEvent.clientY - startY;
      if (gesture === 'orbit') {
        onUpdateCamera3d(orbitCamera(startCamera, dxCss, dyCss));
      } else if (gesture === 'dolly') {
        onUpdateCamera3d(dollyCamera(startCamera, dyCss * DOLLY_PER_DRAG_PIXEL));
      } else {
        const s = scaleRef.current;
        onUpdateCamera3d(panCameraTarget(startCamera, dxCss / s, dyCss / s, projector));
      }
    });
  };

  /**
   * The frozen frame a mesh drag is measured against: the projector, the
   * mesh's projected origin, and its starting position. Frozen for the same
   * reason camera gestures are — the mesh may be animating, and a drag that
   * re-derived its basis every frame would fight the animation.
   */
  const mesh3dDragBasis = (meshId: string) => {
    const state = useStore.getState();
    const mesh = state.mesh3dLayers.find(m => m.id === meshId);
    if (!mesh) return null;
    const t = getPlaybackTime();
    const projector = createScreen3dProjector(state.camera3d, t, CANVAS_WIDTH, CANVAS_HEIGHT);
    const origin = getMesh3dPrimaryOrigin(mesh, t);
    const center = origin ? projector.project(origin) : null;
    return { start: { x: mesh.x, y: mesh.y, z: mesh.z }, projector, origin, center };
  };

  /** Moves a mesh parallel to the view plane, so it tracks the cursor 1:1. */
  const startMesh3dPlaneDrag = (meshId: string, e: React.MouseEvent) => {
    const basis = mesh3dDragBasis(meshId);
    if (!basis) return;
    const { start, projector, center } = basis;
    const { right, screenDown } = projector;
    // Falling back to the target plane's scale keeps a mesh draggable even when
    // its own origin projects behind the camera.
    const perPixel = projector.worldPerPixel(center ? center.viewZ : -projector.pose.distance);
    const startX = e.clientX;
    const startY = e.clientY;

    beginDrag((moveEvent) => {
      const s = scaleRef.current;
      const dx = ((moveEvent.clientX - startX) / s) * perPixel;
      const dy = ((moveEvent.clientY - startY) / s) * perPixel;
      onUpdateMesh3d(meshId, {
        x: start.x + right[0] * dx + screenDown[0] * dy,
        y: start.y + right[1] * dx + screenDown[1] * dy,
        z: start.z + right[2] * dx + screenDown[2] * dy
      });
    });
  };

  /**
   * Constrains a mesh drag to one world axis. The arm's screen direction is
   * measured once and the pointer's travel is projected onto it, which is what
   * makes dragging "along Z" work even when Z is heavily foreshortened.
   */
  const startMesh3dAxisDrag = (meshId: string, axisIndex: number, e: React.MouseEvent) => {
    const basis = mesh3dDragBasis(meshId);
    if (!basis?.origin || !basis.center) return;
    const { start, projector, origin, center } = basis;
    const axis = GIZMO_AXES[axisIndex].dir;
    const armWorld = gizmoArmWorldLength(projector, center);
    const tip = projector.project([
      origin[0] + axis[0] * armWorld,
      origin[1] + axis[1] * armWorld,
      origin[2] + axis[2] * armWorld
    ]);
    if (!tip) return;
    const armPixels = Math.hypot(tip.x - center.x, tip.y - center.y);
    if (armPixels < 1) return; // arm points at the camera; nothing to aim along
    const unitX = (tip.x - center.x) / armPixels;
    const unitY = (tip.y - center.y) / armPixels;
    const pixelsPerWorldUnit = armPixels / armWorld;
    const startX = e.clientX;
    const startY = e.clientY;

    beginDrag((moveEvent) => {
      const s = scaleRef.current;
      const dx = (moveEvent.clientX - startX) / s;
      const dy = (moveEvent.clientY - startY) / s;
      const travel = (dx * unitX + dy * unitY) / pixelsPerWorldUnit;
      onUpdateMesh3d(meshId, {
        x: start.x + axis[0] * travel,
        y: start.y + axis[1] * travel,
        z: start.z + axis[2] * travel
      });
    });
  };

  // Gizmo handles sit above the canvas, so they have to honor the camera
  // modifiers themselves — otherwise Alt-dragging over a handle would move the
  // mesh instead of orbiting the view.
  const handleGizmoMouseDown = (e: React.MouseEvent, axisIndex: number | 'center') => {
    e.stopPropagation();
    const gesture = camera3dGestureFor(e);
    if (gesture) {
      e.preventDefault();
      startCamera3dGesture(gesture, e);
      return;
    }
    if (e.button !== 0 || !selectedMesh3dId) return;
    if (axisIndex === 'center') startMesh3dPlaneDrag(selectedMesh3dId, e);
    else startMesh3dAxisDrag(selectedMesh3dId, axisIndex, e);
  };

  const handleMesh3dMouseDown = (e: React.MouseEvent, coords: PolygonPoint) => {
    const gesture = camera3dGestureFor(e);
    if (gesture) {
      e.preventDefault();
      startCamera3dGesture(gesture, e);
      return;
    }
    if (e.button !== 0) return;

    // getCanvasCoords is center-origin; picking works in the renderer's
    // top-left-origin canvas space.
    const pick = pickMesh3dAt(
      { x: coords.x + CANVAS_WIDTH / 2, y: coords.y + CANVAS_HEIGHT / 2 },
      useStore.getState().mesh3dLayers,
      useStore.getState().camera3d,
      getPlaybackTime(),
      CANVAS_WIDTH,
      CANVAS_HEIGHT
    );
    if (!pick) {
      onSelectMesh3d(null);
      return;
    }
    onSelectMesh3d(pick.meshId);
    startMesh3dPlaneDrag(pick.meshId, e);
  };

  // Alt+right-drag is the dolly gesture, so the browser context menu has to
  // stay out of the way — but only in 3D mode, where that binding exists.
  const handleContainerContextMenu = (e: React.MouseEvent) => {
    if (appMode === '3d') e.preventDefault();
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
    if (appMode === 'flythrough') {
      const gifs = files.filter(file => file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif'));
      if (gifs.length > 0) void onReplaceFlythroughAssets(gifs);
      return;
    }
    if (appMode === 'tunnel') {
      if (files.length > 0) void onAddTunnelAssets(files);
      return;
    }
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
            {appMode === 'symmetry'
              ? 'Symmetry Canvas'
              : appMode === 'polygon'
                ? 'Polygon GIF Tiler'
                : appMode === '3d'
                  ? '3D Space'
                  : appMode === 'flythrough' ? 'GIF Flythrough' : 'GIF Tunnel'}
          </span>
          <span className="text-gray-500 font-mono">1080x1920</span>
          {appMode === '3d' && (
            <span className="text-gray-500 border-l border-gray-700 pl-2">
              Alt-drag orbit · Shift-drag pan · Scroll zoom
            </span>
          )}
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
        onContextMenu={handleContainerContextMenu}
        className={cn(
          // Deliberately not clipped: interaction overlays have to be able to
          // paint into the surrounding margin so handles for points outside
          // the frame stay visible. Anything that must stay inside the frame
          // clips itself.
          "relative shadow-2xl transition-all duration-75",
          isDraggingOver ? "ring-4 ring-indigo-500/50" : "",
          isDrawingPolygon
            ? "cursor-crosshair"
            : appMode === '3d' && camera3dNavArmed ? "cursor-grab" : "cursor-default"
        )}
        style={{
          width: CANVAS_WIDTH * scale,
          height: CANVAS_HEIGHT * scale,
          backgroundColor: appMode === 'tunnel' ? tunnel.voidColor : canvasBg
        }}
      >
        {/* Native 2D Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full block"
        />

        {appMode === 'flythrough' && flythroughAssets.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-4 py-3 rounded-lg border border-cyan-900/60 bg-black/65 backdrop-blur-sm text-center shadow-[0_0_40px_rgba(6,182,212,0.08)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-500">No flight library</div>
              <div className="mt-1 text-xs text-gray-500">Choose a GIF folder in the Stack panel</div>
            </div>
          </div>
        )}

        {appMode === 'tunnel' && tunnelAssets.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
            <div className="rounded-full border border-teal-950/70 bg-black/60 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-teal-700 backdrop-blur-sm">
              Palette tunnel · add wallpaper sources in the Stack
            </div>
          </div>
        )}

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

        {/* 3D Translate Gizmo. Rendered once per selection and positioned by
            the rAF tick above; `visibility: hidden` until that tick runs so it
            never flashes at the canvas origin, and stays hidden whenever the
            mesh origin projects behind the camera. */}
        {appMode === '3d' && selectedMesh && !selectedMesh.hidden && (
          <div
            ref={gizmoRef}
            className="absolute inset-0 pointer-events-none"
            style={{ visibility: 'hidden' }}
          >
            <svg
              className="w-full h-full absolute inset-0 pointer-events-none"
              style={{ overflow: 'visible' }}
            >
              {GIZMO_AXES.map((axis, i) => (
                <line
                  key={`gizmo-arm-${axis.key}`}
                  ref={(el) => { gizmoArmRefs.current[i] = el; }}
                  stroke={axis.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ))}
            </svg>

            {/* Center handle: free move across the view plane. */}
            <div
              ref={gizmoCenterRef}
              onMouseDown={(e) => handleGizmoMouseDown(e, 'center')}
              className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-indigo-600/90 hover:bg-indigo-500 border-2 border-white shadow-xl pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform hover:scale-125 z-20"
              title="Drag to move across the view plane"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>

            {/* Axis handles: constrained move along one world axis. */}
            {GIZMO_AXES.map((axis, i) => (
              <div
                key={`gizmo-handle-${axis.key}`}
                ref={(el) => { gizmoHandleRefs.current[i] = el; }}
                onMouseDown={(e) => handleGizmoMouseDown(e, i)}
                style={{ backgroundColor: axis.color }}
                className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-white shadow-lg pointer-events-auto cursor-grab active:cursor-grabbing flex items-center justify-center text-[9px] font-bold text-gray-950 transition-transform hover:scale-125 z-20"
                title={`Drag to move along ${axis.label}`}
              >
                {axis.label}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
