import {
  AppMode,
  Camera3dConfig,
  FlythroughAsset,
  FlythroughConfig,
  Layer,
  MasterFxConfig,
  Mesh3dLayer,
  PolygonLayer,
  PolygonPoint
} from '../types';
import { getGifFrameAtTime } from '../lib/gifUtils';
import { applyMotion, getDeformedPoints, getInstances, getModulatedLayer, getPolygonSymmetryTransforms, resolveSymmetryParams } from '../lib/motion';
import { getMesh3dInstances } from '../lib/motion3d';
import { generateMesh3dGeometry } from '../lib/geometry3d';
import { deformGeometry } from '../lib/deformation3d';
import { buildMeshWorldMatrix, mat4TransformPoint, Vec3, vecCross, vecNormalize, vecSub } from '../lib/mat4';
import { createScreen3dProjector, ScreenPoint } from '../lib/project3d';
import { getVoronoiCells } from '../lib/voronoi';
import { resolveFlythroughParticles } from '../lib/flythrough';

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

export interface RenderState {
  appMode: AppMode;
  layers: Layer[];
  polygonLayers: PolygonLayer[];
  mesh3dLayers: Mesh3dLayer[];
  camera3d: Camera3dConfig;
  flythroughAssets: FlythroughAsset[];
  flythrough: FlythroughConfig;
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

function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  width: number,
  height: number,
  scaleX: number,
  scaleY: number
) {
  ctx.beginPath();
  points.forEach((pt, i) => {
    const px = (width / 2) + pt.x * scaleX;
    const py = (height / 2) + pt.y * scaleY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

/**
 * Voronoi is a subdivision/masking effect, not a repeat-and-transform one,
 * so it bypasses getPolygonSymmetryTransforms entirely: each shard clips to
 * the *intersection* of the parent shape and its own cell polygon (two
 * nested ctx.clip() calls — Canvas 2D intersects clip regions automatically,
 * no polygon-polygon boolean math needed), then fills with the same texture
 * pattern at a small deterministic per-cell phase offset.
 */
function renderVoronoiPolygon(
  ctx: CanvasRenderingContext2D,
  polygon: PolygonLayer,
  points: PolygonPoint[],
  frameSource: CanvasImageSource | null,
  scaleVal: number,
  rotationVal: number,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number,
  width: number,
  height: number
) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const params = resolveSymmetryParams(polygon.symmetryParams);
  const cells = getVoronoiCells({ minX, minY, maxX, maxY }, params.voronoiCells, params.voronoiSeed);
  const hasStroke = polygon.strokeWidth > 0 && !!polygon.strokeColor && polygon.strokeColor !== 'transparent';

  for (const cell of cells) {
    ctx.save();
    tracePolygonPath(ctx, points, width, height, scaleX, scaleY);
    ctx.clip();
    tracePolygonPath(ctx, cell.points, width, height, scaleX, scaleY);
    ctx.clip();

    ctx.globalAlpha = Math.max(0, Math.min(1, polygon.opacity));
    ctx.globalCompositeOperation = BLEND_MAP[polygon.blendMode] || 'source-over';

    if (frameSource) {
      try {
        const pattern = getPattern(ctx, `${polygon.id}-voronoi`, frameSource);
        if (pattern) {
          const spread = 400 * params.voronoiPhaseVariation;
          const phaseX = (cell.phase - 0.5) * spread;
          const phaseY = (((cell.phase * 7.3) % 1) - 0.5) * spread;
          const matrix = new DOMMatrix();
          matrix.scaleSelf(scaleX, scaleY);
          matrix.translateSelf(offsetX + phaseX, offsetY + phaseY);
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

    if (hasStroke) {
      tracePolygonPath(ctx, cell.points, width, height, scaleX, scaleY);
      ctx.lineWidth = polygon.strokeWidth * Math.min(scaleX, scaleY);
      ctx.strokeStyle = polygon.strokeColor;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    ctx.restore();
  }
}

function renderPolygon(
  ctx: CanvasRenderingContext2D,
  polygon: PolygonLayer,
  t: number,
  width: number,
  height: number
) {
  if (!polygon.points || polygon.points.length < 3) return;
  const points = getDeformedPoints(polygon, t);

  const scaleVal = applyMotion(polygon.textureScale ?? 1, polygon.motionTextureScale, t);
  const rotationVal = applyMotion(polygon.textureRotation ?? 0, polygon.motionTextureRotation, t);
  const offsetX = applyMotion(polygon.textureOffsetX ?? 0, polygon.motionTextureOffsetX, t);
  const offsetY = applyMotion(polygon.textureOffsetY ?? 0, polygon.motionTextureOffsetY, t);

  const scaleX = width / CANVAS_WIDTH;
  const scaleY = height / CANVAS_HEIGHT;

  let frameSource: CanvasImageSource | null = null;
  if (polygon.gifData) {
    frameSource = getGifFrameAtTime(polygon.gifData, t, polygon.gifSpeed ?? 1);
  }
  if (!frameSource && polygon.src) {
    frameSource = getCachedImage(polygon.src);
  }

  if ((polygon.symmetry ?? 'none') === 'voronoi') {
    renderVoronoiPolygon(ctx, polygon, points, frameSource, scaleVal, rotationVal, offsetX, offsetY, scaleX, scaleY, width, height);
    return;
  }

  const origin = resolveSymmetryParams(polygon.symmetryParams);
  const originPxX = (width / 2) + origin.originX * scaleX;
  const originPxY = (height / 2) + origin.originY * scaleY;

  // Each symmetrized copy wraps the whole draw (path + texture pattern +
  // stroke) in a rigid transform around the origin, so the pattern mirrors
  // /rotates along with the shape — matching how a mirrored Layer's raster
  // content flips, not just its outline.
  for (const tr of getPolygonSymmetryTransforms(polygon)) {
    ctx.save();
    ctx.translate(originPxX, originPxY);
    ctx.rotate((tr.rotationDeg * Math.PI) / 180);
    ctx.scale((tr.mirrorX ? -1 : 1) * tr.scaleMult, (tr.mirrorY ? -1 : 1) * tr.scaleMult);
    ctx.translate(-originPxX, -originPxY);

    tracePolygonPath(ctx, points, width, height, scaleX, scaleY);

    ctx.globalAlpha = Math.max(0, Math.min(1, polygon.opacity));
    ctx.globalCompositeOperation = BLEND_MAP[polygon.blendMode] || 'source-over';

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
}

/**
 * Voronoi for an image layer shatters the sprite into masked shards rather
 * than tiling a pattern (Layer has no tiling concept, unlike PolygonLayer).
 * Each shard is displaced a small deterministic amount along its own phase
 * — mask and image translate together, so the piece stays intact but sits
 * slightly out of place, reading as a "shattered glass" mosaic.
 */
function renderVoronoiLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  t: number,
  drawSource: CanvasImageSource,
  w: number,
  h: number,
  width: number,
  height: number
) {
  const scaleX = width / CANVAS_WIDTH;
  const scaleY = height / CANVAS_HEIGHT;
  const m = getModulatedLayer(layer, t);
  const halfW = (w * Math.abs(m.scaleX)) / 2;
  const halfH = (h * Math.abs(m.scaleY)) / 2;
  const bounds = { minX: m.x - halfW, minY: m.y - halfH, maxX: m.x + halfW, maxY: m.y + halfH };

  const params = resolveSymmetryParams(layer.symmetryParams);
  const cells = getVoronoiCells(bounds, params.voronoiCells, params.voronoiSeed);
  const jitter = params.voronoiPhaseVariation * 30;

  for (const cell of cells) {
    const angle = cell.phase * Math.PI * 2;
    const dx = Math.cos(angle) * jitter * cell.phase;
    const dy = Math.sin(angle) * jitter * cell.phase;

    ctx.save();
    tracePolygonPath(ctx, cell.points.map(p => ({ x: p.x + dx, y: p.y + dy })), width, height, scaleX, scaleY);
    ctx.clip();

    ctx.globalAlpha = Math.max(0, Math.min(1, m.opacity));
    ctx.globalCompositeOperation = BLEND_MAP[m.blendMode] || 'source-over';
    ctx.translate((width / 2) + (m.x + dx) * scaleX, (height / 2) + (m.y + dy) * scaleY);
    ctx.rotate((m.rotation * Math.PI) / 180);
    ctx.scale(m.scaleX * scaleX, m.scaleY * scaleY);
    try {
      ctx.drawImage(drawSource, -w / 2, -h / 2, w, h);
    } catch (e) {
      console.warn('Canvas drawImage failed:', e);
    }
    ctx.restore();
  }
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

      if (layer.symmetry === 'voronoi') {
        renderVoronoiLayer(ctx, layer, t, drawSource, w, h, width, height);
        return;
      }

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
  } else if (state.appMode === '3d') {
    renderMesh3dScene(ctx, t, state.mesh3dLayers, state.camera3d, width, height);
  } else if (state.appMode === 'flythrough') {
    renderFlythroughScene(ctx, t, state.flythroughAssets, state.flythrough, width, height);
  }

  if (state.masterFx?.enabled) {
    applyMasterFx2D(ctx, t, state.masterFx, width, height);
  }
}

type Point3 = [number, number, number];

function normalize3([x, y, z]: Point3): Point3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function cross3(a: Point3, b: Point3): Point3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function renderFlythroughScene(
  ctx: CanvasRenderingContext2D,
  t: number,
  assets: FlythroughAsset[],
  config: FlythroughConfig,
  width: number,
  height: number
) {
  const tanHalfFov = Math.tan((config.fov * Math.PI) / 360);
  const aspect = width / height;
  const particles = resolveFlythroughParticles(assets, config, t).sort((a, b) => a.z - b.z);

  const project = ([x, y, z]: Point3): [number, number] | null => {
    if (z >= -1) return null;
    const ndcX = (x / -z) / (tanHalfFov * aspect);
    const ndcY = (y / -z) / tanHalfFov;
    return [(ndcX + 1) * width / 2, (1 - ndcY) * height / 2];
  };

  for (const particle of particles) {
    const source = particle.asset.gifData
      ? getGifFrameAtTime(particle.asset.gifData, t, 1)
      : getCachedImage(particle.asset.src);
    if (!source) continue;

    let right: Point3 = [1, 0, 0];
    let up: Point3 = [0, 1, 0];
    if (config.plane === 'billboard') {
      const normal = normalize3([-particle.x, -particle.y, -particle.z]);
      right = normalize3(cross3([0, 1, 0], normal));
      up = normalize3(cross3(normal, right));
    } else if (config.plane === 'xz') {
      up = [0, 0, 1];
    } else if (config.plane === 'yz') {
      right = [0, 0, -1];
    }

    const angle = particle.rotation * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedRight: Point3 = [
      right[0] * cos + up[0] * sin,
      right[1] * cos + up[1] * sin,
      right[2] * cos + up[2] * sin
    ];
    const rotatedUp: Point3 = [
      -right[0] * sin + up[0] * cos,
      -right[1] * sin + up[1] * cos,
      -right[2] * sin + up[2] * cos
    ];
    const center: Point3 = [particle.x, particle.y, particle.z];
    const corner = (rx: number, uy: number): Point3 => [
      center[0] + rotatedRight[0] * rx + rotatedUp[0] * uy,
      center[1] + rotatedRight[1] * rx + rotatedUp[1] * uy,
      center[2] + rotatedRight[2] * rx + rotatedUp[2] * uy
    ];
    const hw = particle.width / 2;
    const hh = particle.height / 2;
    const projected = [
      project(corner(-hw, hh)),
      project(corner(hw, hh)),
      project(corner(hw, -hh)),
      project(corner(-hw, -hh))
    ];
    if (projected.some(point => point === null)) continue;

    const sourceWidth = particle.asset.gifData?.width ?? particle.asset.width ?? 1;
    const sourceHeight = particle.asset.gifData?.height ?? particle.asset.height ?? 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, config.opacity));
    drawImageTriangle(ctx, source, [[0, 0], [sourceWidth, 0], [sourceWidth, sourceHeight]], [projected[0]!, projected[1]!, projected[2]!]);
    drawImageTriangle(ctx, source, [[0, 0], [sourceWidth, sourceHeight], [0, sourceHeight]], [projected[0]!, projected[2]!, projected[3]!]);
    ctx.restore();
  }
}

function drawImageTriangle(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  src: [[number, number], [number, number], [number, number]],
  dst: [[number, number], [number, number], [number, number]]
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
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

interface ProjectedTri3d {
  points: [[number, number], [number, number], [number, number]];
  depth: number; // view-space z (more negative = farther); sort ascending for painter's algorithm
  fillColor: string;
  strokeColor?: string;
  strokeWidth: number;
  wireframeOnly: boolean;
}

/**
 * Software fallback for 3D Mesh Mode (`?renderer=2d`): projects every mesh's
 * deformed geometry per symmetry instance, depth-sorts every resulting
 * triangle across the whole scene (Painter's algorithm), and fills each
 * with a flat, single-headlight-shaded color. Unlike the rest of this file's
 * 2D fallback, this intentionally doesn't attempt texture mapping or smooth
 * shading — see the 3D mode implementation plan's scope for render2d.ts —
 * so it exists to keep the scene legible without a GPU, not for visual
 * parity with threeRenderer.ts.
 *
 * Projection itself lives in project3d.ts (shared with the interactive
 * viewport): a plain up=(0,1,0) camera whose NDC maps directly to canvas
 * pixels without the usual top/bottom flip, which is what makes world +Y land
 * toward the bottom of the canvas here — consistent with the rest of the app's
 * Y-down convention despite the "standard" camera math.
 */
function renderMesh3dScene(
  ctx: CanvasRenderingContext2D,
  t: number,
  mesh3dLayers: Mesh3dLayer[],
  camera3dRaw: Camera3dConfig,
  width: number,
  height: number
) {
  const { eye, project } = createScreen3dProjector(camera3dRaw, t, width, height);

  const triangles: ProjectedTri3d[] = [];

  for (const layer of mesh3dLayers) {
    if (layer.hidden) continue;
    const base = generateMesh3dGeometry(layer);
    const deformed = deformGeometry(base, layer, t);
    const vertexCount = deformed.positions.length / 3;
    const fillColor = layer.fillColor || '#6366f1';

    for (const inst of getMesh3dInstances(layer, t)) {
      const { world: worldMatrix } = buildMeshWorldMatrix(
        [inst.x, inst.y, inst.z],
        [layer.pivotX, layer.pivotY, layer.pivotZ],
        (inst.rotationXDeg * Math.PI) / 180,
        (inst.rotationYDeg * Math.PI) / 180,
        (inst.rotationZDeg * Math.PI) / 180,
        [inst.scaleX, inst.scaleY, inst.scaleZ]
      );

      const worldPositions: Vec3[] = new Array(vertexCount);
      const projected: (ScreenPoint | null)[] = new Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        const local: Vec3 = [deformed.positions[i * 3], deformed.positions[i * 3 + 1], deformed.positions[i * 3 + 2]];
        const world = mat4TransformPoint(worldMatrix, local);
        worldPositions[i] = world;
        projected[i] = project(world);
      }

      for (let idx = 0; idx < deformed.indices.length; idx += 3) {
        const ia = deformed.indices[idx], ib = deformed.indices[idx + 1], ic = deformed.indices[idx + 2];
        const pa = projected[ia], pb = projected[ib], pc = projected[ic];
        if (!pa || !pb || !pc) continue;

        // Screen-space shoelace: a front-facing triangle (as wound by
        // geometry3d.ts, seen by a camera at rest) comes out negative under
        // this projection. Mirrored instances flip winding naturally here
        // since this reads the actual post-transform screen positions, not
        // the source topology, so culling stays correct for them too.
        const signedArea = pa.x * (pb.y - pc.y) + pb.x * (pc.y - pa.y) + pc.x * (pa.y - pb.y);
        if (!layer.doubleSided && signedArea > 0) continue;

        const wa = worldPositions[ia], wb = worldPositions[ib], wc = worldPositions[ic];
        const faceNormal = vecNormalize(vecCross(vecSub(wb, wa), vecSub(wc, wa)));
        const toEye = vecNormalize(vecSub(eye, wa));
        const facing = Math.max(
          0.2,
          Math.abs(faceNormal[0] * toEye[0] + faceNormal[1] * toEye[1] + faceNormal[2] * toEye[2])
        );

        triangles.push({
          points: [[pa.x, pa.y], [pb.x, pb.y], [pc.x, pc.y]],
          depth: (pa.viewZ + pb.viewZ + pc.viewZ) / 3,
          fillColor: shadeColor(fillColor, facing),
          strokeColor: layer.wireframe ? layer.wireframeColor : undefined,
          strokeWidth: layer.wireframeWidth,
          wireframeOnly: layer.wireframe
        });
      }
    }
  }

  triangles.sort((a, b) => a.depth - b.depth);

  for (const tri of triangles) {
    ctx.beginPath();
    ctx.moveTo(tri.points[0][0], tri.points[0][1]);
    ctx.lineTo(tri.points[1][0], tri.points[1][1]);
    ctx.lineTo(tri.points[2][0], tri.points[2][1]);
    ctx.closePath();
    if (tri.wireframeOnly) {
      ctx.lineWidth = tri.strokeWidth;
      ctx.strokeStyle = tri.strokeColor!;
      ctx.stroke();
    } else {
      ctx.fillStyle = tri.fillColor;
      ctx.fill();
    }
  }
}

function shadeColor(hex: string, factor: number): string {
  const [r, g, b] = parseHexColor(hex);
  const f = Math.max(0, Math.min(1, factor));
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
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
