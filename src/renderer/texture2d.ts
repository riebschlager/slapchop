import { TextureTiling } from '../types';
import { fillTexture } from '../lib/textureMapping';

export function drawImageTriangle(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  src: [[number, number], [number, number], [number, number]],
  dst: [[number, number], [number, number], [number, number]],
  tiling?: TextureTiling
) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;
  const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(denominator) < 1e-8) return;
  const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / denominator;
  const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / denominator;
  const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator;
  const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / denominator;
  const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / denominator;
  const f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  if (tiling) {
    const minX = Math.min(...src.map(p => p[0]));
    const minY = Math.min(...src.map(p => p[1]));
    fillTexture(ctx, source, tiling, minX, minY, Math.max(...src.map(p => p[0])) - minX, Math.max(...src.map(p => p[1])) - minY);
  } else {
    ctx.drawImage(source, 0, 0);
  }
  ctx.restore();
}
