import { AppMode, Layer, PolygonLayer } from '../types';
import { getGifFrameAtTime } from '../lib/gifUtils';
import { applyMotion, getInstances } from '../lib/motion';

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

export interface RenderState {
  appMode: AppMode;
  layers: Layer[];
  polygonLayers: PolygonLayer[];
  canvasBg: string;
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
export function getCachedImage(src?: string): HTMLImageElement | null {
  if (!src) return null;
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function getLayerSize(layer: Layer): { w: number; h: number } {
  if (layer.gifData) {
    return { w: layer.gifData.width || 200, h: layer.gifData.height || 200 };
  }
  const img = getCachedImage(layer.src);
  if (img) {
    return { w: img.naturalWidth || 200, h: img.naturalHeight || 200 };
  }
  return { w: 200, h: 200 };
}

// Patterns are cached per-context and rebuilt only when the source image
// changes (e.g. a GIF advancing a frame), not on every rAF tick.
interface PatternEntry {
  source: CanvasImageSource;
  pattern: CanvasPattern;
}
const patternCaches = new WeakMap<CanvasRenderingContext2D, Map<string, PatternEntry>>();

function getPattern(
  ctx: CanvasRenderingContext2D,
  key: string,
  source: CanvasImageSource
): CanvasPattern | null {
  let cache = patternCaches.get(ctx);
  if (!cache) {
    cache = new Map();
    patternCaches.set(ctx, cache);
  }
  const entry = cache.get(key);
  if (entry && entry.source === source) return entry.pattern;
  const pattern = ctx.createPattern(source, 'repeat');
  if (pattern) cache.set(key, { source, pattern });
  return pattern;
}

function renderPolygon(
  ctx: CanvasRenderingContext2D,
  polygon: PolygonLayer,
  t: number,
  width: number,
  height: number
) {
  if (!polygon.points || polygon.points.length < 3) return;

  const scaleVal = applyMotion(polygon.textureScale ?? 1, polygon.motionTextureScale, t);
  const rotationVal = applyMotion(polygon.textureRotation ?? 0, polygon.motionTextureRotation, t);
  const offsetX = applyMotion(polygon.textureOffsetX ?? 0, polygon.motionTextureOffsetX, t);
  const offsetY = applyMotion(polygon.textureOffsetY ?? 0, polygon.motionTextureOffsetY, t);

  const scaleX = width / CANVAS_WIDTH;
  const scaleY = height / CANVAS_HEIGHT;

  ctx.save();

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
    frameSource = getGifFrameAtTime(polygon.gifData, t, polygon.gifSpeed ?? 1);
  }
  if (!frameSource && polygon.src) {
    frameSource = getCachedImage(polygon.src);
  }

  if (frameSource) {
    try {
      const pattern = getPattern(ctx, polygon.id, frameSource);
      if (pattern) {
        const matrix = new DOMMatrix();
        matrix.translateSelf(offsetX, offsetY);
        matrix.scaleSelf(Math.max(0.01, scaleVal), Math.max(0.01, scaleVal));
        matrix.rotateSelf(rotationVal);
        pattern.setTransform(matrix);
        ctx.fillStyle = pattern;
        ctx.fill();
      }
    } catch (err) {
      console.warn('Pattern fill failed:', err);
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
}

export function renderFrame(
  canvas: HTMLCanvasElement,
  t: number,
  state: RenderState,
  width: number = CANVAS_WIDTH,
  height: number = CANVAS_HEIGHT
) {
  // Resizing a canvas clears its backing store — only do it when needed.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = state.canvasBg;
  ctx.fillRect(0, 0, width, height);

  if (state.appMode === 'symmetry') {
    const scaleX = width / CANVAS_WIDTH;
    const scaleY = height / CANVAS_HEIGHT;

    state.layers.forEach((layer) => {
      if (layer.hidden) return;

      let drawSource: CanvasImageSource | null = null;
      let w = 100;
      let h = 100;

      if (layer.gifData) {
        const frame = getGifFrameAtTime(layer.gifData, t, layer.gifSpeed ?? 1);
        if (frame) {
          drawSource = frame;
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

      const instances = getInstances(layer, t);
      instances.forEach((inst) => {
        ctx.save();
        ctx.translate((width / 2) + inst.x * scaleX, (height / 2) + inst.y * scaleY);
        ctx.rotate((inst.rotation * Math.PI) / 180);
        ctx.scale(inst.scaleX * scaleX, inst.scaleY * scaleY);
        ctx.globalAlpha = Math.max(0, Math.min(1, inst.opacity));
        ctx.globalCompositeOperation = BLEND_MAP[inst.blendMode] || 'source-over';
        try {
          ctx.drawImage(drawSource!, -w / 2, -h / 2, w, h);
        } catch (e) {
          console.warn('Canvas drawImage failed:', e);
        }
        ctx.restore();
      });
    });
  } else if (state.appMode === 'polygon') {
    state.polygonLayers.forEach((polygon) => {
      if (polygon.hidden) return;
      renderPolygon(ctx, polygon, t, width, height);
    });
  }
}
