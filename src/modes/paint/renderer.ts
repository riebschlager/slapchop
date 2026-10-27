import { getGifFrameAtTime } from '../../lib/gifUtils';
import {
  buildPaintDabs, originalStamps, replayStamps, stampAlpha, stampPosition,
  type PaintDocument, type PaintStroke, type PaintStamp, type PaintDab, type BrushPattern
} from './model';

function brushPath(ctx: Path2D, pattern: BrushPattern, size: number) {
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
interface StampImage { canvas: HTMLCanvasElement; key: string; owners: Set<PaintStroke>; frame: CanvasImageSource }
// Stamp images may be regenerated cheaply; accumulated stroke pixels never evict.
const STAMP_PIXEL_BUDGET = 4 * 1024 * 1024;
interface StrokeData { stroke: PaintStroke; dabs: PaintDab[]; mask: Path2D }
interface Bounds { x: number; y: number; width: number; height: number }
interface RasterCache extends Bounds {
  canvas: HTMLCanvasElement;
  data: StrokeData[];
  time: number;
  // Only fading stamps need retained events, and only for their live window.
  live: PaintStamp[];
}
function release(cache: RasterCache) { cache.canvas.width = 0; cache.canvas.height = 0; }
function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the GIF Paint canvas context.');
  return ctx;
}
function bounds(strokes: PaintStroke[], width: number, height: number): Bounds {
  let left = width, top = height, right = 0, bottom = 0;
  for (const stroke of strokes) {
    // Enclose every rotated brush pattern plus deterministic scatter. Round out
    // in output pixels so cropped caches retain the original sampling grid.
    const pad = stroke.size * (Math.SQRT1_2 + stroke.scatter / 2);
    for (const p of stroke.points) {
      left = Math.min(left, (p.x - pad + 540) * width / 1080);
      right = Math.max(right, (p.x + pad + 540) * width / 1080);
      top = Math.min(top, (p.y - pad + 960) * height / 1920);
      bottom = Math.max(bottom, (p.y + pad + 960) * height / 1920);
    }
  }
  const x = Math.max(0, Math.floor(left) - 1), y = Math.max(0, Math.floor(top) - 1);
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil(right) + 1) - x),
    height: Math.max(1, Math.min(height, Math.ceil(bottom) + 1) - y) };
}
/** Static runs flatten in stack order; active paths own cropped, persistent
 * surfaces. No eviction can trigger history reconstruction during forward play.
 * Paths remain authoritative: edits, undo, seeks and exports rebuild from them.
 */
export class PaintRenderer {
  readonly canvas = document.createElement('canvas');
  readonly stats = { historyRebuilds: 0, stampDraws: 0, stampBuilds: 0, composites: 0 };
  revision = 0;
  private caches: RasterCache[] = [];
  private assets: PaintDocument['assets'] | null = null;
  private hadDraft = false;
  private stamps = new Set<StampImage>();
  private stampPixels = 0;
  private stampLookup = new Map<string, Map<CanvasImageSource, StampImage>>();
  get stampCachePixels() { return this.stampPixels; }

  private draw(ctx: CanvasRenderingContext2D, stamp: PaintStamp, doc: PaintDocument, time: number, mask: Path2D) {
    const alpha = stampAlpha(stamp, time);
    if (alpha <= 0) return false;
    const asset = doc.assets.find(a => a.id === stamp.stroke.assetId);
    if (!asset) return false;
    const frame = getGifFrameAtTime(asset.gifData, stamp.sourceTime);
    if (!frame) return false;
    const { stroke } = stamp;
    const key = [stroke.pattern, stroke.size, stroke.rotation, stroke.imageZoom, stroke.imageRotation,
      asset.gifData.width, asset.gifData.height].join('/');
    let image = this.stampLookup.get(key)?.get(frame);
    if (!image) {
      const canvas = document.createElement('canvas');
      const sx = this.canvas.width / 1080, sy = this.canvas.height / 1920;
      canvas.width = Math.ceil(stroke.size * Math.SQRT2 * sx) + 2;
      canvas.height = Math.ceil(stroke.size * Math.SQRT2 * sy) + 2;
      // Pre-masking makes clipping independent of Canvas command batching at
      // frame boundaries, so direct seeks and incremental deposits agree.
      const brush = context(canvas);
      brush.setTransform(sx, 0, 0, sy, canvas.width / 2, canvas.height / 2);
      brush.rotate(stroke.rotation * Math.PI / 180);
      brush.clip(mask);
      brush.rotate(stroke.imageRotation * Math.PI / 180);
      const scale = stroke.size / Math.max(asset.gifData.width, asset.gifData.height) * stroke.imageZoom;
      const w = asset.gifData.width * scale, h = asset.gifData.height * scale;
      brush.drawImage(frame, -w / 2, -h / 2, w, h);
      image = { canvas, key, owners: new Set(), frame };
      let frames = this.stampLookup.get(key);
      if (!frames) { frames = new Map(); this.stampLookup.set(key, frames); }
      frames.set(frame, image);
      this.stats.stampBuilds++;
      this.stampPixels += canvas.width * canvas.height;
      this.stamps.add(image);
      while (this.stampPixels > STAMP_PIXEL_BUDGET && this.stamps.size > 1) this.releaseStamp(this.stamps.values().next().value!);
    }
    image.owners.add(stroke);
    this.stamps.delete(image); this.stamps.add(image);
    const p = stampPosition(stamp);
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = image.canvas.width * 1080 / this.canvas.width, h = image.canvas.height * 1920 / this.canvas.height;
    ctx.drawImage(image.canvas, p.x - w / 2, p.y - h / 2, w, h);
    ctx.restore();
    this.stats.stampDraws++;
    return true;
  }
  private releaseStamp(image: StampImage) {
    this.stampPixels -= image.canvas.width * image.canvas.height;
    image.canvas.width = 0; image.canvas.height = 0;
    this.stamps.delete(image);
    const frames = this.stampLookup.get(image.key);
    frames?.delete(image.frame);
    if (!frames?.size) this.stampLookup.delete(image.key);
  }
  get cachedPixels() { return this.caches.reduce((sum, c) => sum + c.width * c.height, 0); }

  private pruneStamps(present: Set<PaintStroke>) {
    for (const image of this.stamps) {
      for (const owner of image.owners) if (!present.has(owner)) image.owners.delete(owner);
      if (!image.owners.size) this.releaseStamp(image);
    }
  }

  render(doc: PaintDocument, time: number, width: number, height: number, draft?: PaintStroke | null): HTMLCanvasElement {
    time = Math.max(0, time);
    if (this.canvas.width !== width || this.canvas.height !== height || this.assets !== doc.assets) {
      this.clear();
      this.canvas.width = width;
      this.canvas.height = height;
      this.assets = doc.assets;
    }
    const present = new Set(doc.strokes.filter(stroke => !stroke.hidden));
    if (draft) present.add(draft);
    this.pruneStamps(present);
    const groups: PaintStroke[][] = [];
    for (const stroke of doc.strokes) {
      if (stroke.hidden) continue;
      const previous = groups.at(-1);
      const temporal = stroke.replay || stroke.lifetime > 0;
      if (!temporal && previous && !previous[0].replay && previous[0].lifetime === 0) previous.push(stroke);
      else groups.push([stroke]);
    }
    const remaining = new Set(this.caches);
    let changed = this.revision === 0 || !!draft || this.hadDraft;
    const next = groups.map(strokes => {
      let cache = this.caches.find(c => c.data.length === strokes.length && c.data.every((d, i) => d.stroke === strokes[i]));
      if (!cache) {
        const rect = bounds(strokes, width, height);
        const canvas = document.createElement('canvas');
        canvas.width = rect.width; canvas.height = rect.height;
        cache = { ...rect, canvas, time: -Infinity, live: [], data: strokes.map(stroke => {
          const mask = new Path2D();
          brushPath(mask, stroke.pattern, stroke.size);
          return { stroke, mask, dabs: buildPaintDabs(stroke) };
        }) };
        changed = true;
      }
      remaining.delete(cache);
      const layer = context(cache.canvas);
      const rebuild = cache.time > time || cache.time === -Infinity;
      const fading = strokes[0].lifetime > 0;
      if (rebuild || (fading && cache.time !== time)) {
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.clearRect(0, 0, cache.width, cache.height);
        changed = true;
      }
      layer.setTransform(width / 1080, 0, 0, height / 1920, width / 2 - cache.x, height / 2 - cache.y);
      if (rebuild) {
        this.stats.historyRebuilds++;
        cache.live = [];
        for (const data of cache.data) for (const stamp of originalStamps(data.stroke, data.dabs)) {
          if (fading) { if (stampAlpha(stamp, time) > 0) cache.live.push(stamp); }
          else if (this.draw(layer, stamp, doc, time, data.mask)) changed = true;
        }
      }
      if (rebuild || cache.time !== time) {
        for (const data of cache.data) {
          const from = fading
            ? Math.max(rebuild ? -1e-9 : cache.time, time - data.stroke.lifetime)
            : rebuild ? -1e-9 : cache.time;
          for (const stamp of replayStamps(data.stroke, data.dabs, from, time)) {
            if (fading) cache.live.push(stamp);
            else if (this.draw(layer, stamp, doc, time, data.mask)) changed = true;
          }
        }
        if (fading) {
          cache.live = cache.live.filter(stamp => stampAlpha(stamp, time) > 0);
          for (const stamp of cache.live) this.draw(layer, stamp, doc, time, cache.data[0].mask);
        }
      }
      cache.time = time;
      return cache;
    });
    if (next.length !== this.caches.length || next.some((c, i) => c !== this.caches[i])) changed = true;
    for (const cache of remaining) release(cache);
    this.caches = next;
    this.pruneStamps(new Set([...present].filter(stroke => stroke.replay || stroke.lifetime > 0 || stroke === draft)));
    if (changed) {
      const ctx = context(this.canvas);
      ctx.clearRect(0, 0, width, height);
      for (const cache of this.caches) ctx.drawImage(cache.canvas, cache.x, cache.y);
      if (draft) {
        ctx.save();
        ctx.setTransform(width / 1080, 0, 0, height / 1920, width / 2, height / 2);
        const mask = new Path2D();
        brushPath(mask, draft.pattern, draft.size);
        for (const stamp of originalStamps(draft, buildPaintDabs(draft))) {
          // A gesture deposits frozen frames; lifetime starts after it is saved.
          this.draw(ctx, stamp, doc, 0, mask);
        }
        ctx.restore();
      }
      this.stats.composites++;
      this.revision++;
    }
    this.hadDraft = !!draft;
    return this.canvas;
  }
  clear() {
    for (const cache of this.caches) release(cache);
    this.caches = [];
    this.assets = null;
    for (const image of this.stamps) this.releaseStamp(image);
    // Force even an empty document to clear the previously composited image.
    this.hadDraft = true;
  }
  destroy() { this.clear(); this.canvas.width = 0; this.canvas.height = 0; }
}
