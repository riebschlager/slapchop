import { AppMode, Layer, MasterFxConfig, PolygonLayer } from '../types';
import { getGifFrameAtTime } from '../lib/gifUtils';
import { applyMotion, getInstances } from '../lib/motion';

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

export interface RenderState {
  appMode: AppMode;
  layers: Layer[];
  polygonLayers: PolygonLayer[];
  canvasBg: string;
  masterFx?: MasterFxConfig;
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
        // Design-space pattern transform, mapped to output pixels so the
        // texture stays resolution-independent at any export size.
        matrix.scaleSelf(scaleX, scaleY);
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

  if (state.masterFx?.enabled) {
    applyMasterFx2D(ctx, t, state.masterFx, width, height);
  }
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16)
    ];
  }
  return [
    parseInt(clean.substring(0, 2), 16) || 0,
    parseInt(clean.substring(2, 4), 16) || 0,
    parseInt(clean.substring(4, 6), 16) || 0
  ];
}

function applyMasterFx2D(
  ctx: CanvasRenderingContext2D,
  t: number,
  fx: MasterFxConfig | undefined,
  width: number,
  height: number
) {
  if (!fx || !fx.enabled) return;

  // 1. Color Adjustments and Bloom using CSS filter pass if needed
  const hue = applyMotion(fx.hueRotate, fx.motionHueRotate, t);
  const hasColorAdjust = fx.colorAdjustEnabled && (fx.brightness !== 0 || fx.contrast !== 0 || fx.saturation !== 0 || hue !== 0);
  const hasBloom = fx.bloomEnabled && fx.bloomStrength > 0;

  if (hasColorAdjust || hasBloom) {
    const filterParts: string[] = [];
    if (fx.colorAdjustEnabled) {
      if (fx.brightness !== 0) filterParts.push(`brightness(${Math.max(0, 1 + fx.brightness)})`);
      if (fx.contrast !== 0) filterParts.push(`contrast(${Math.max(0, 1 + fx.contrast)})`);
      if (fx.saturation !== 0) {
        const satVal = fx.saturation > 0 ? 1 + fx.saturation * 2 : Math.max(0, 1 + fx.saturation);
        filterParts.push(`saturate(${satVal})`);
      }
      if (hue !== 0) filterParts.push(`hue-rotate(${hue}deg)`);
    }
    if (hasBloom) {
      filterParts.push(`blur(${fx.bloomStrength * (width / CANVAS_WIDTH) * 0.5}px)`);
    }

    if (filterParts.length > 0) {
      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(ctx.canvas, 0, 0);
        ctx.save();
        ctx.filter = filterParts.join(' ');
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();
      }
    }
  }

  // 2. Pixel passes (Duotone, RGB Split, Noise)
  const hasDuotone = fx.duotoneEnabled && fx.duotoneIntensity > 0;
  const hasRgbSplit = fx.rgbSplitEnabled;
  const hasNoise = fx.noiseEnabled && fx.noiseAmount > 0;

  if (hasDuotone || hasRgbSplit || hasNoise) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const len = data.length;

    // Duotone
    if (hasDuotone) {
      const [sr, sg, sb] = parseHexColor(fx.duotoneShadowColor);
      const [hr, hg, hb] = parseHexColor(fx.duotoneHighlightColor);
      const intensity = fx.duotoneIntensity;

      for (let i = 0; i < len; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const mr = sr + (hr - sr) * lum;
        const mg = sg + (hg - sg) * lum;
        const mb = sb + (hb - sb) * lum;
        data[i] = r + (mr - r) * intensity;
        data[i + 1] = g + (mg - g) * intensity;
        data[i + 2] = b + (mb - b) * intensity;
      }
    }

    // RGB Split
    if (hasRgbSplit) {
      const offsetPx = applyMotion(fx.rgbSplitOffset, fx.motionRgbSplitOffset, t) * (width / CANVAS_WIDTH);
      const angleRad = (fx.rgbSplitAngle * Math.PI) / 180;
      const dx = Math.round(Math.cos(angleRad) * offsetPx);
      const dy = Math.round(Math.sin(angleRad) * offsetPx);

      if (dx !== 0 || dy !== 0) {
        const copy = new Uint8ClampedArray(data);
        for (let y = 0; y < height; y++) {
          const row = y * width;
          for (let x = 0; x < width; x++) {
            const idx = (row + x) * 4;

            const rx = Math.min(width - 1, Math.max(0, x + dx));
            const ry = Math.min(height - 1, Math.max(0, y + dy));
            const rIdx = (ry * width + rx) * 4;

            const bx = Math.min(width - 1, Math.max(0, x - dx));
            const by = Math.min(height - 1, Math.max(0, y - dy));
            const bIdx = (by * width + bx) * 4;

            data[idx] = copy[rIdx];
            data[idx + 2] = copy[bIdx + 2];
          }
        }
      }
    }

    // Film Grain / Noise
    if (hasNoise) {
      const amt = fx.noiseAmount * 255;
      const seed = Math.floor((t * (fx.noiseSpeed || 1) * 10) % 1000);
      for (let i = 0; i < len; i += 4) {
        if (data[i + 3] === 0) continue;
        const n = ((Math.sin((i + seed) * 12.9898) * 43758.5453) % 1) - 0.5;
        const diff = n * amt;
        data[i] = Math.max(0, Math.min(255, data[i] + diff));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + diff));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + diff));
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  // 3. Scanlines
  if (fx.scanlinesEnabled && fx.scanlinesOpacity > 0) {
    ctx.save();
    const count = fx.scanlinesCount || 360;
    const scanTime = (t * (fx.scanlinesSpeed ?? 0.5)) % 1000;
    const lineSpacing = height / count;
    ctx.fillStyle = `rgba(0, 0, 0, ${fx.scanlinesOpacity * 0.5})`;
    for (let y = (scanTime * lineSpacing * 10) % lineSpacing; y < height; y += lineSpacing) {
      ctx.fillRect(0, y, width, Math.max(1, lineSpacing * 0.4));
    }
    ctx.restore();
  }
}
