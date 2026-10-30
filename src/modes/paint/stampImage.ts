import type { BrushPattern, PaintStroke } from './model';

export function brushPath(ctx: Path2D, pattern: BrushPattern, size: number) {
  const r = size / 2;
  if (pattern === 'round') ctx.arc(0, 0, r, 0, Math.PI * 2);
  else if (pattern === 'flat') ctx.rect(-r, -r * 0.24, size, size * 0.24);
  else if (pattern === 'bristle') {
    for (let i = 0; i < 11; i++) ctx.rect(-r + size * i / 11, -r * (0.65 + 0.25 * Math.sin(i * 7)), size / 20, size * 0.75);
  } else if (pattern === 'stripes') {
    for (let i = 0; i < 5; i++) ctx.rect(-r, -r + i * size / 5, size, size / 12);
  } else {
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      if (x * x + y * y > 5) continue;
      ctx.moveTo(x * size / 5 + size / 16, y * size / 5);
      ctx.arc(x * size / 5, y * size / 5, size / 16, 0, Math.PI * 2);
    }
  }
}
/** Reference brush raster, shared by Canvas deposits and GPU atlas entries. */
export function createStampImage(stroke: PaintStroke, frame: CanvasImageSource, sourceWidth: number, sourceHeight: number,
  width: number, height: number, mask?: Path2D): HTMLCanvasElement {
  const sx = width / 1080, sy = height / 1920;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(stroke.size * Math.SQRT2 * sx) + 2;
  canvas.height = Math.ceil(stroke.size * Math.SQRT2 * sy) + 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the GIF Paint stamp context.');
  if (!mask) { mask = new Path2D(); brushPath(mask, stroke.pattern, stroke.size); }
  ctx.setTransform(sx, 0, 0, sy, canvas.width / 2, canvas.height / 2);
  ctx.rotate(stroke.rotation * Math.PI / 180);
  ctx.clip(mask);
  ctx.rotate(stroke.imageRotation * Math.PI / 180);
  const scale = stroke.size / Math.max(sourceWidth, sourceHeight) * stroke.imageZoom;
  const w = sourceWidth * scale, h = sourceHeight * scale;
  ctx.drawImage(frame, -w / 2, -h / 2, w, h);
  return canvas;
}
