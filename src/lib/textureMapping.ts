import { TextureTiling } from '../types';

export function textureMirrorAxes(mode: TextureTiling = 'repeat'): [boolean, boolean] {
  return [mode === 'mirror' || mode === 'mirror-x', mode === 'mirror' || mode === 'mirror-y'];
}

export function rotateTextureUv(u: number, v: number, degrees = 0): [number, number] {
  const angle = degrees * Math.PI / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [0.5 + (u - 0.5) * c - (v - 0.5) * s, 0.5 + (u - 0.5) * s + (v - 0.5) * c];
}

function sourceSize(source: CanvasImageSource): [number, number] {
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight];
  if ('displayWidth' in source) return [source.displayWidth, source.displayHeight];
  if ('videoWidth' in source) return [source.videoWidth, source.videoHeight];
  if (typeof source.width === 'number' && typeof source.height === 'number') return [source.width, source.height];
  return [typeof source.width === 'number' ? source.width : source.width.baseVal.value, typeof source.height === 'number' ? source.height : source.height.baseVal.value];
}

// Weak keys let decoded GIF frames and their mirrored tiles be collected together.
const mirroredSources = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();
export function mirroredTextureSource(source: CanvasImageSource, mode: TextureTiling = 'repeat'): CanvasImageSource {
  const [mirrorX, mirrorY] = textureMirrorAxes(mode);
  if (!mirrorX && !mirrorY) return source;
  let entries = mirroredSources.get(source);
  if (!entries) {
    entries = new Map();
    mirroredSources.set(source, entries);
  }
  const cached = entries.get(mode);
  if (cached) return cached;
  const [width, height] = sourceSize(source);
  const canvas = document.createElement('canvas');
  canvas.width = width * (mirrorX ? 2 : 1);
  canvas.height = height * (mirrorY ? 2 : 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create mirrored texture canvas.');
  for (let y = 0; y <= Number(mirrorY); y++) {
    for (let x = 0; x <= Number(mirrorX); x++) {
      ctx.save();
      ctx.translate(x ? width * 2 : 0, y ? height * 2 : 0);
      ctx.scale(x ? -1 : 1, y ? -1 : 1);
      ctx.drawImage(source, 0, 0);
      ctx.restore();
    }
  }
  entries.set(mode, canvas);
  return canvas;
}

/** Fill a source-coordinate rectangle; clamp extends the outermost pixel. */
export function fillTexture(ctx: CanvasRenderingContext2D, source: CanvasImageSource, mode: TextureTiling, x: number, y: number, width: number, height: number) {
  if (mode !== 'clamp') {
    const pattern = ctx.createPattern(mirroredTextureSource(source, mode), 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(x, y, width, height);
    }
    return;
  }
  const [w, h] = sourceSize(source);
  const xs = [[x, 0, 0, 1], [0, w, 0, w], [w, x + width, w - 1, 1]];
  const ys = [[y, 0, 0, 1], [0, h, 0, h], [h, y + height, h - 1, 1]];
  for (const [left, right, sx, sw] of xs) {
    for (const [top, bottom, sy, sh] of ys) {
      if (right > left && bottom > top) ctx.drawImage(source, sx, sy, sw, sh, left, top, right - left, bottom - top);
    }
  }
}
