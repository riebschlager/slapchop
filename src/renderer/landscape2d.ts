import { getGifFrameAtTime } from '../lib/gifUtils';
import { resolveLandscapeCells, LandscapePoint, resolveLandscapeFrame } from '../lib/landscape';
import { LandscapeAsset, LandscapeConfig, LandscapeSkySource } from '../types';

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function projectLandscapePoint(
  point: LandscapePoint,
  config: LandscapeConfig,
  width: number,
  height: number
): ProjectedPoint | null {
  const camera: [number, number, number] = [config.cameraX, config.cameraHeight, 1500];
  const target: [number, number, number] = [0, 0, -config.lookAhead];
  const forward = normalize([target[0] - camera[0], target[1] - camera[1], target[2] - camera[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const relative: [number, number, number] = [point.x - camera[0], point.y - camera[1], point.z - camera[2]];
  const depth = dot(relative, forward);
  if (depth <= 2) return null;
  const focal = height * 0.5 / Math.tan(config.fov * Math.PI / 360);
  return {
    x: width / 2 + dot(relative, right) * focal / depth,
    y: height / 2 - dot(relative, up) * focal / depth,
    depth
  };
}

function skyAssetForTile(source: LandscapeSkySource, x: number, y: number, ring: number): LandscapeAsset | null {
  if (source.assets.length === 0) return null;
  const hash = Math.abs((x * 73856093) ^ (y * 19349663) ^ (ring * 83492791));
  return source.assets[hash % source.assets.length];
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  size: number
) {
  const scale = Math.min(size / Math.max(1, sourceWidth), size / Math.max(1, sourceHeight));
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
}

/** Draw the concentric, independently folder-textured sky. */
export function renderLandscapeSky(
  ctx: CanvasRenderingContext2D,
  t: number,
  sources: LandscapeSkySource[],
  config: LandscapeConfig,
  width: number,
  height: number
) {
  const scale = Math.min(width / 1080, height / 1920);
  const centerX = width / 2 + config.skyCenterX * width / 1080;
  const centerY = height / 2 + config.skyCenterY * height / 1920;
  ctx.save();
  ctx.fillStyle = config.skyBackgroundColor;
  ctx.fillRect(0, 0, width, height);

  for (let ring = Math.max(1, Math.round(config.skyCircleCount)) - 1; ring >= 0; ring--) {
    const outerRadius = (ring + 1) * config.skyRingWidth * scale + ring * config.skyRingGap * scale;
    const innerRadius = ring === 0
      ? 0
      : ring * config.skyRingWidth * scale + ring * config.skyRingGap * scale;
    const source = sources.length > 0 ? sources[ring % sources.length] : null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
    if (innerRadius > 0) {
      ctx.moveTo(centerX + innerRadius, centerY);
      ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
    }
    ctx.clip('evenodd');
    ctx.fillStyle = ring % 2 === 0 ? '#ff5d32' : '#ffd84d';
    ctx.fillRect(0, 0, width, height);

    if (source && source.assets.length > 0) {
      const tileSize = Math.max(56, 210 * source.textureScale * scale);
      const offsetX = source.textureOffsetX * tileSize;
      const offsetY = source.textureOffsetY * tileSize;
      ctx.translate(centerX, centerY);
      ctx.rotate(source.textureRotation * Math.PI / 180);
      ctx.translate(-centerX, -centerY);
      const minX = Math.floor((-outerRadius - offsetX) / tileSize) - 1;
      const maxX = Math.ceil((outerRadius - offsetX) / tileSize) + 1;
      const minY = Math.floor((-outerRadius - offsetY) / tileSize) - 1;
      const maxY = Math.ceil((outerRadius - offsetY) / tileSize) + 1;
      for (let tileY = minY; tileY <= maxY; tileY++) {
        for (let tileX = minX; tileX <= maxX; tileX++) {
          const asset = skyAssetForTile(source, tileX, tileY, ring);
          if (!asset) continue;
          const frame = getGifFrameAtTime(asset.gifData, t, source.gifSpeed);
          if (!frame) continue;
          const x = centerX + offsetX + tileX * tileSize;
          const y = centerY + offsetY + tileY * tileSize;
          ctx.fillStyle = '#050609';
          ctx.fillRect(x, y, tileSize, tileSize);
          drawContained(ctx, frame, asset.width, asset.height, x, y, tileSize);
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Canvas 2D reference renderer for the complete Landscape mode. */
export function renderLandscapeScene2d(
  ctx: CanvasRenderingContext2D,
  t: number,
  terrainAssets: LandscapeAsset[],
  skySources: LandscapeSkySource[],
  config: LandscapeConfig,
  width: number,
  height: number
) {
  const frame = resolveLandscapeFrame(config, skySources, t);
  const resolved = frame.config;
  renderLandscapeSky(ctx, t, frame.skySources, resolved, width, height);
  const cells = resolveLandscapeCells(resolved, t, terrainAssets.length, frame.travel).reverse();
  for (const cell of cells) {
    const projected = cell.corners.map(point => projectLandscapePoint(point, resolved, width, height));
    if (projected.some(point => point === null)) continue;
    const quad = projected as ProjectedPoint[];
    ctx.save();
    ctx.beginPath();
    quad.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.closePath();
    const asset = cell.assetIndex >= 0 ? terrainAssets[cell.assetIndex] : null;
    if (asset) {
      ctx.clip();
      const gifFrame = getGifFrameAtTime(asset.gifData, t, resolved.terrainGifSpeed);
      if (gifFrame) {
        const xs = quad.map(point => point.x);
        const ys = quad.map(point => point.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const drawWidth = Math.max(1, Math.max(...xs) - minX);
        const drawHeight = Math.max(1, Math.max(...ys) - minY);
        const zoom = Math.max(0.25, resolved.terrainTextureScale);
        ctx.drawImage(
          gifFrame,
          minX + resolved.terrainTextureOffsetX * drawWidth - drawWidth * (zoom - 1) / 2,
          minY + resolved.terrainTextureOffsetY * drawHeight - drawHeight * (zoom - 1) / 2,
          drawWidth * zoom,
          drawHeight * zoom
        );
      }
    } else {
      const averageHeight = cell.corners.reduce((sum, point) => sum + point.y, 0) / 4;
      const lightness = Math.max(12, Math.min(48, 28 + averageHeight / Math.max(1, resolved.heightScale) * 20));
      ctx.fillStyle = `hsl(${178 + cell.column * 3} 46% ${lightness}%)`;
      ctx.fill();
    }
    ctx.restore();

    if (resolved.wireframe) {
      ctx.beginPath();
      quad.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.strokeStyle = resolved.wireframeColor;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(0.5, width / 1080);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
