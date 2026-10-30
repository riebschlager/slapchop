import { brushPath, createStampImage } from './stampImage';
import { autoStroke, AutopaintSequence, type AutopaintSettings } from './autopaint';
import { getGifFrameAtTime } from '../../lib/gifUtils';
import {
  PaintDabCursor, buildPaintDabs, pathDistance, originalStamps, replayStamps, stampAlpha, stampPosition,
  type PaintDocument, type PaintStroke, type PaintStamp, type PaintDab
} from './model';

interface StampImage { canvas: HTMLCanvasElement; key: string; owners: Set<PaintStroke>; frame: CanvasImageSource }
// Stamp images may be regenerated cheaply; accumulated stroke pixels never evict.
const STAMP_PIXEL_BUDGET = 4 * 1024 * 1024;
interface StrokeData { stroke: PaintStroke; dabs: PaintDab[]; mask: Path2D; extent: { left: number; right: number; top: number; bottom: number } }
interface Bounds { x: number; y: number; width: number; height: number }
interface RasterCache extends Bounds {
  sources: PaintDocument['assets'];
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
function bounds(data: StrokeData[], width: number, height: number): Bounds {
  let left = width, top = height, right = 0, bottom = 0;
  for (const { stroke, extent } of data) {
    // Round only at the output boundary to preserve the original sampling grid.
    const pad = stroke.size * (Math.SQRT1_2 + stroke.scatter / 2);
    left = Math.min(left, (extent.left - pad + 540) * width / 1080);
    right = Math.max(right, (extent.right + pad + 540) * width / 1080);
    top = Math.min(top, (extent.top - pad + 960) * height / 1920);
    bottom = Math.max(bottom, (extent.bottom + pad + 960) * height / 1920);
  }
  const x = Math.max(0, Math.floor(left) - 1), y = Math.max(0, Math.floor(top) - 1);
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil(right) + 1) - x),
    height: Math.max(1, Math.min(height, Math.ceil(bottom) + 1) - y) };
}
function* savedStamps({ stroke, dabs }: StrokeData): Generator<PaintStamp> {
  const duration = stroke.points.at(-1)?.time ?? 0;
  for (const dab of dabs) yield { stroke, dab, birth: dab.time - duration, sourceTime: stroke.sourceOffset + dab.time * stroke.gifSpeed };
}
/** Static runs flatten in stack order; active paths own cropped, persistent
 * surfaces. No eviction can trigger history reconstruction during forward play.
 * Paths remain authoritative: edits, undo, seeks and exports rebuild from them.
 */
export class PaintRenderer {
  readonly canvas = document.createElement('canvas');
  readonly stats = { historyRebuilds: 0, stampDraws: 0, stampBuilds: 0, composites: 0, geometryBuilds: 0, groupBuilds: 0, checkpointHits: 0 };
  revision = 0;
  private caches: RasterCache[] = [];
  private checkpointTimes = new WeakMap<PaintStroke, number>();
  private geometry = new WeakMap<PaintStroke['points'], Map<string, PaintDab[]>>();
  private data = new WeakMap<PaintStroke, StrokeData>();
  private plannedStrokes: PaintStroke[] | null = null;
  private groups: PaintStroke[][] = [];
  private checkpoints: RasterCache[] = [];
  private inFlight = new Set<RasterCache>();
  private previousStrokes: PaintStroke[] = [];
  private auto: { config: AutopaintSettings; canvas: HTMLCanvasElement; time: number; owner: PaintStroke; mask: Path2D; live: PaintStamp[]; sequence: AutopaintSequence; sources: PaintDocument['assets'] } | null = null;
  private autoCheckpoints: NonNullable<PaintRenderer['auto']>[] = [];
  private draftSource: PaintDocument['assets'][number]['gifData'] | undefined;
  private hadDraft = false;
  private draft: { stroke: PaintStroke; canvas: HTMLCanvasElement; mask: Path2D; cursor: PaintDabCursor; dabs: PaintDab[] } | null = null;
  private sourceArray: PaintDocument['assets'] | null = null;
  private sourceLookup = new Map<string, PaintDocument['assets'][number]>();
  private stamps = new Set<StampImage>();
  private stampPixels = 0;
  private stampLookup = new Map<string, Map<CanvasImageSource, StampImage>>();
  get checkpointPixels() { return [...this.checkpoints, ...this.autoCheckpoints].reduce((sum, c) => sum + c.canvas.width * c.canvas.height, 0); }
  get stampCachePixels() { return this.stampPixels; }

  private draw(ctx: CanvasRenderingContext2D, stamp: PaintStamp, time: number, mask: Path2D, owner = stamp.stroke) {
    const alpha = stampAlpha(stamp, time);
    if (alpha <= 0) return false;
    const asset = this.sourceLookup.get(stamp.stroke.assetId);
    if (!asset) return false;
    const frame = getGifFrameAtTime(asset.gifData, stamp.sourceTime);
    if (!frame) return false;
    const { stroke } = stamp;
    const key = [stroke.pattern, stroke.size, stroke.rotation, stroke.imageZoom, stroke.imageRotation,
      asset.gifData.width, asset.gifData.height].join('/');
    let image = this.stampLookup.get(key)?.get(frame);
    if (!image) {
      const canvas = createStampImage(stroke, frame, asset.gifData.width, asset.gifData.height,
        this.canvas.width, this.canvas.height, mask);
      image = { canvas, key, owners: new Set(), frame };
      let frames = this.stampLookup.get(key);
      if (!frames) { frames = new Map(); this.stampLookup.set(key, frames); }
      frames.set(frame, image);
      this.stats.stampBuilds++;
      this.stampPixels += canvas.width * canvas.height;
      this.stamps.add(image);
      while (this.stampPixels > STAMP_PIXEL_BUDGET && this.stamps.size > 1) this.releaseStamp(this.stamps.values().next().value!);
    }
    image.owners.add(owner);
    this.stamps.delete(image); this.stamps.add(image);
    const p = stampPosition(stamp);
    ctx.save();
    ctx.globalAlpha = alpha;
    const pressure = stamp.pressure ?? 1;
    const w = image.canvas.width * 1080 / this.canvas.width * pressure, h = image.canvas.height * 1920 / this.canvas.height * pressure;
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
  get cachedPixels() { return this.caches.reduce((sum, c) => sum + c.width * c.height, 0) + (this.auto ? this.auto.canvas.width * this.auto.canvas.height : 0) + (this.draft ? this.draft.canvas.width * this.draft.canvas.height : 0); }

  private pruneStamps(present: Set<PaintStroke>) {
    for (const image of this.stamps) {
      for (const owner of image.owners) if (!present.has(owner)) image.owners.delete(owner);
      if (!image.owners.size) this.releaseStamp(image);
    }
  }

  render(doc: PaintDocument, time: number, width: number, height: number, draft?: PaintStroke | null): HTMLCanvasElement {
    const work = this.renderBatches(doc, time, width, height, draft);
    while (!work.next().done) { /* Offline frames finish before encoding. */ }
    return this.canvas;
  }

  *renderBatches(doc: PaintDocument, time: number, width: number, height: number, draft?: PaintStroke | null): Generator<void> {
    let operations = 0;
    time = Math.max(0, time);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.clear();
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const sourcesChanged = this.sourceArray !== doc.assets;
    if (sourcesChanged) {
      this.sourceArray = doc.assets; this.sourceLookup = new Map(doc.assets.map(a => [a.id, a]));
    }
    let invalidated = false;
    const sourcesMatch = (cache: RasterCache) => cache.data.every(({ stroke }) =>
      doc.assets.find(asset => asset.id === stroke.assetId)?.gifData === cache.sources.find(asset => asset.id === stroke.assetId)?.gifData);
    for (const cache of sourcesChanged ? [...this.caches, ...this.checkpoints] : []) {
      if (!sourcesMatch(cache)) {
        invalidated = true;
        release(cache);
        this.caches = this.caches.filter(c => c !== cache);
        this.checkpoints = this.checkpoints.filter(c => c !== cache);
      }
    }
    if (this.draft && this.draftSource !== doc.assets.find(a => a.id === this.draft!.stroke.assetId)?.gifData) {
      this.draft.canvas.width = 0; this.draft.canvas.height = 0; this.draft = null;
      this.hadDraft = true;
    }
    const present = new Set(doc.strokes.filter(stroke => !stroke.hidden));
    if (draft) present.add(draft);
    if (this.auto) present.add(this.auto.owner);
    this.pruneStamps(present);
    if (this.plannedStrokes !== doc.strokes) {
      this.groups = [];
      for (const stroke of doc.strokes) {
        if (stroke.hidden) continue;
        const previous = this.groups.at(-1);
        if (!stroke.replay && stroke.lifetime === 0 && previous && !previous[0].replay && previous[0].lifetime === 0) previous.push(stroke);
        else this.groups.push([stroke]);
      }
      this.plannedStrokes = doc.strokes;
      this.stats.groupBuilds++;
    }
    const groups = this.groups;
    const appendOnly = this.previousStrokes.length < doc.strokes.length
      && this.previousStrokes.every((stroke, i) => stroke === doc.strokes[i]);
    const byFirstStroke = new Map(this.caches.map(c => [c.data[0].stroke, c]));
    const remaining = new Set(this.caches);
    let changed = invalidated || this.revision === 0 || (!!draft !== this.hadDraft);
    const next: RasterCache[] = [];
    for (const [groupIndex, strokes] of groups.entries()) {
      let cache = byFirstStroke.get(strokes[0]);
      if (cache && (cache.data.length !== strokes.length || !cache.data.every((d, i) => d.stroke === strokes[i]))) cache = undefined;
      const matches = (c: RasterCache) => c.data.length === strokes.length && c.data.every((d, i) => d.stroke === strokes[i]);
      if (cache && cache.time > time && (strokes[0].replay || strokes[0].lifetime > 0)) {
        this.saveCheckpoint(cache);
        cache = undefined;
      }
      if (!cache) {
        const checkpoint = this.checkpoints.filter(c => matches(c) && (c.time <= time || (!strokes[0].replay && !strokes[0].lifetime)))
          .sort((a, b) => b.time - a.time)[0];
        if (checkpoint) {
          cache = this.copyCache(checkpoint);
          this.stats.checkpointHits++;
        }
      }
      const appended: StrokeData[] = [];
      // Only the top static run can grow without changing stack semantics.
      const tail = this.caches.at(-1);
      if (!cache && appendOnly && groupIndex === groups.length - 1 && !strokes[0].replay && strokes[0].lifetime === 0
        && tail && remaining.has(tail) && tail.time <= time && tail.data.length < strokes.length
        && tail.data.every((d, i) => d.stroke === strokes[i])) {
        cache = tail;
        for (const stroke of strokes.slice(tail.data.length)) appended.push(yield* this.strokeData(stroke));
        const added = bounds(appended, width, height);
        const x = Math.min(cache.x, added.x), y = Math.min(cache.y, added.y);
        const w = Math.max(cache.x + cache.width, added.x + added.width) - x;
        const h = Math.max(cache.y + cache.height, added.y + added.height) - y;
        if (x !== cache.x || y !== cache.y || w !== cache.width || h !== cache.height) {
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          context(canvas).drawImage(cache.canvas, cache.x - x, cache.y - y);
          release(cache);
          Object.assign(cache, { canvas, x, y, width: w, height: h });
        }
        cache.data.push(...appended);
        cache.sources = doc.assets.filter(a => cache!.data.some(d => d.stroke.assetId === a.id));
        changed = true;
      }
      if (!cache) {
        const data: StrokeData[] = [];
        for (const stroke of strokes) data.push(yield* this.strokeData(stroke));
        const rect = bounds(data, width, height);
        const canvas = document.createElement('canvas');
        canvas.width = rect.width; canvas.height = rect.height;
        cache = { ...rect, canvas, sources: doc.assets.filter(a => strokes.some(s => s.assetId === a.id)), time: -Infinity, live: [], data };
        changed = true;
      }
      this.inFlight.add(cache);
      remaining.delete(cache);
      yield;
      const layer = context(cache.canvas);
      const rebuild = (cache.time > time && (strokes[0].replay || strokes[0].lifetime > 0)) || cache.time === -Infinity;
      const fading = strokes[0].lifetime > 0;
      if (rebuild || (fading && cache.time !== time)) {
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.clearRect(0, 0, cache.width, cache.height);
        changed = true;
      }
      layer.setTransform(width / 1080, 0, 0, height / 1920, width / 2 - cache.x, height / 2 - cache.y);
      if (rebuild) { this.stats.historyRebuilds++; cache.live = []; }
      if (rebuild || appended.length) {
        for (const data of rebuild ? cache.data : appended) for (const stamp of savedStamps(data)) {
          if (fading) { if (stampAlpha(stamp, time) > 0) cache.live.push(stamp); }
          else if (this.draw(layer, stamp, time, data.mask)) changed = true;
          if (++operations % 128 === 0) yield;
        }
      }
      if (rebuild || cache.time !== time) {
        for (const data of cache.data) {
          const from = fading
            ? Math.max(rebuild ? -1e-9 : cache.time, time - data.stroke.lifetime)
            : rebuild ? -1e-9 : cache.time;
          for (const stamp of replayStamps(data.stroke, data.dabs, from, time)) {
            if (fading) cache.live.push(stamp);
            else if (this.draw(layer, stamp, time, data.mask)) changed = true;
            if (++operations % 128 === 0) yield;
          }
        }
        if (fading) {
          cache.live = cache.live.filter(stamp => stampAlpha(stamp, time) > 0);
          for (const stamp of cache.live) {
            this.draw(layer, stamp, time, cache.data[0].mask);
              if (++operations % 128 === 0) yield;
          }
        }
      }
      cache.time = time;
      next.push(cache);
      if (strokes[0].replay && !strokes[0].lifetime && time - (this.checkpointTimes.get(strokes[0]) ?? -Infinity) >= 5) {
        this.saveCheckpoint(cache); this.checkpointTimes.set(strokes[0], time);
      }
    }
    if (next.length !== this.caches.length || next.some((c, i) => c !== this.caches[i])) changed = true;
    for (const cache of remaining) { this.keepCheckpoint(cache); }
    this.inFlight.clear();
    this.caches = next;
    this.previousStrokes = doc.strokes;
    const config = doc.autopaint;
    const palette = doc.assets.filter(a => !a.retired);
    const samePalette = (sources: PaintDocument['assets']) => sources.length === palette.length && sources.every((a, i) => a.id === palette[i].id && a.gifData === palette[i].gifData);
    this.autoCheckpoints = this.autoCheckpoints.filter(auto => {
      if (samePalette(auto.sources)) return true;
      auto.canvas.width = 0; auto.canvas.height = 0; return false;
    });
    if (this.auto && (this.auto.config !== config || !config?.enabled || time < this.auto.time || !samePalette(this.auto.sources))) {
      if (samePalette(this.auto.sources)) this.keepAutoCheckpoint(this.auto);
      else { this.auto.canvas.width = 0; this.auto.canvas.height = 0; }
      this.auto = null;
      changed = true;
    }
    if (config?.enabled) {
      if (!this.auto) {
        const checkpoint = this.autoCheckpoints.filter(a => a.config === config && a.time <= time).sort((a, b) => b.time - a.time)[0];
        if (checkpoint) {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          context(canvas).drawImage(checkpoint.canvas, 0, 0, width, height);
          this.auto = { ...checkpoint, canvas, live: [...checkpoint.live], sequence: new AutopaintSequence(config, doc.assets) };
          this.stats.checkpointHits++;
        }
      }
      if (!this.auto) {
        const owner = autoStroke(config, doc.assets, 0);
        if (owner) {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const mask = new Path2D();
          brushPath(mask, config.brush.pattern, config.brush.size);
          this.auto = { config, canvas, owner, mask, time: -Infinity, live: [], sequence: new AutopaintSequence(config, doc.assets), sources: palette };
          this.stats.historyRebuilds++;
          changed = true;
        }
      }
      const auto = this.auto;
      if (auto && auto.time !== time) {
        const ctx = context(auto.canvas);
        const lifetime = config.brush.lifetime;
        if (lifetime > 0) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, width, height);
          changed = true;
        }
        ctx.setTransform(width / 1080, 0, 0, height / 1920, width / 2, height / 2);
        const from = Math.max(auto.time, lifetime > 0 ? time - lifetime : -1e-9);
        for (const stamp of auto.sequence.stamps(from, time)) {
          if (lifetime > 0) auto.live.push(stamp);
          else if (this.draw(ctx, stamp, time, auto.mask, auto.owner)) changed = true;
          if (++operations % 128 === 0) yield;
        }
        if (lifetime > 0) {
          auto.live = auto.live.filter(stamp => stampAlpha(stamp, time) > 0);
          for (const stamp of auto.live) {
            this.draw(ctx, stamp, time, auto.mask, auto.owner);
              if (++operations % 128 === 0) yield;
          }
        }
        auto.time = time;
        if (!lifetime && !this.autoCheckpoints.some(a => a.config === config && time - a.time < 10)) {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          context(canvas).drawImage(auto.canvas, 0, 0, width, height);
          this.keepAutoCheckpoint({ ...auto, canvas, live: [] });
        }
      }
    }
    this.pruneStamps(new Set([...doc.strokes.filter(stroke => !stroke.hidden && (stroke.replay || stroke.lifetime > 0)),
      ...(draft ? [draft] : []), ...(this.auto ? [this.auto.owner] : [])]));
    if (this.updateDraft(draft ?? null, doc, width, height)) changed = true;
    if (changed) {
      const ctx = context(this.canvas);
      ctx.clearRect(0, 0, width, height);
      for (const cache of this.caches) ctx.drawImage(cache.canvas, cache.x, cache.y);
      if (this.auto) ctx.drawImage(this.auto.canvas, 0, 0);
      if (this.draft) ctx.drawImage(this.draft.canvas, 0, 0);
      this.stats.composites++;
      this.revision++;
    }
    this.hadDraft = !!draft;
  }
  private *strokeData(stroke: PaintStroke): Generator<void, StrokeData> {
    let data = this.data.get(stroke);
    if (data) return data;
    let geometries = this.geometry.get(stroke.points);
    if (!geometries) { geometries = new Map(); this.geometry.set(stroke.points, geometries); }
    const key = `${stroke.size}/${stroke.spacing}/${stroke.constantSpeed}`;
    let dabs = geometries.get(key);
    if (!dabs) {
      dabs = [];
      const cursor = new PaintDabCursor(stroke.size * stroke.spacing);
      const total = stroke.constantSpeed ? pathDistance(stroke.points) : 0;
      const timing = total > 0 ? { total, duration: Math.max(1 / 30, stroke.points.at(-1)!.time) } : undefined;
      while (cursor.processedPoints < stroke.points.length) {
        dabs.push(...cursor.append(stroke.points, timing, Math.min(stroke.points.length, cursor.processedPoints + 64)));
        yield;
      }
      geometries.set(key, dabs);
      // Inspector scrubbing must not retain every spacing variant.
      if (geometries.size > 4) geometries.delete(geometries.keys().next().value!);
      this.stats.geometryBuilds++;
    }
    const mask = new Path2D();
    brushPath(mask, stroke.pattern, stroke.size);
    const extent = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      extent.left = Math.min(extent.left, p.x); extent.right = Math.max(extent.right, p.x);
      extent.top = Math.min(extent.top, p.y); extent.bottom = Math.max(extent.bottom, p.y);
      if (i % 64 === 63) yield;
    }
    data = { stroke, mask, dabs, extent };
    this.data.set(stroke, data);
    return data;
  }

  private copyCache(cache: RasterCache): RasterCache {
    const canvas = document.createElement('canvas');
    canvas.width = cache.width; canvas.height = cache.height;
    context(canvas).drawImage(cache.canvas, 0, 0, cache.width, cache.height);
    return { ...cache, canvas, data: [...cache.data], live: [...cache.live] };
  }
  private saveCheckpoint(cache: RasterCache) {
    if (cache.width * cache.height <= 8 * 1024 * 1024) this.keepCheckpoint(this.copyCache(cache));
  }
  private keepCheckpoint(cache: RasterCache) {
    this.checkpoints.push(cache);
    while (this.checkpoints.length > 8 || this.checkpoints.reduce((n, c) => n + c.width * c.height, 0) > 8 * 1024 * 1024) release(this.checkpoints.shift()!);
  }
  private keepAutoCheckpoint(auto: NonNullable<PaintRenderer['auto']>) {
    this.autoCheckpoints.push(auto);
    while (this.autoCheckpoints.length > 4 || this.autoCheckpoints.reduce((n, a) => n + a.canvas.width * a.canvas.height, 0) > 4 * 1024 * 1024) {
      const old = this.autoCheckpoints.shift()!; old.canvas.width = 0; old.canvas.height = 0;
    }
  }
  /** Abandon partial work without publishing it or discarding reusable checkpoints. */
  cancelRebuild() {
    for (const cache of new Set([...this.caches, ...this.inFlight])) release(cache);
    this.caches = []; this.inFlight.clear(); this.previousStrokes = [];
    if (this.auto) { this.auto.canvas.width = 0; this.auto.canvas.height = 0; this.auto = null; }
    this.hadDraft = true;
  }

  private updateDraft(stroke: PaintStroke | null, doc: PaintDocument, width: number, height: number): boolean {
    let changed = false;
    if (this.draft && (this.draft.stroke !== stroke || !stroke || stroke.points.length < this.draft.cursor.processedPoints)) {
      this.draft.canvas.width = 0; this.draft.canvas.height = 0;
      this.draft = null;
      changed = true;
    }
    if (!stroke) return changed;
    if (!this.draft) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const mask = new Path2D();
      brushPath(mask, stroke.pattern, stroke.size);
      this.draftSource = doc.assets.find(a => a.id === stroke.assetId)?.gifData;
      this.draft = { stroke, canvas, mask, cursor: new PaintDabCursor(stroke.size * stroke.spacing), dabs: [] };
    }
    const draft = this.draft;
    if (draft.cursor.processedPoints === stroke.points.length) return changed;
    const ctx = context(draft.canvas);
    let dabs = draft.cursor.append(stroke.points);
    // Constant-speed timing depends on the completed path's total distance and
    // duration. Preserve this legacy preview behavior when that replay option is
    // carried into a manual brush; unchanged samples still do no work.
    if (stroke.constantSpeed) {
      dabs = buildPaintDabs(stroke);
      ctx.clearRect(0, 0, width, height);
      changed = true;
    } else if (stroke.lifetime > 0) {
      // Exact linear fading changes earlier alpha as the recorded duration grows.
      // Retain only its live window, while sampling only newly appended segments.
      draft.dabs.push(...dabs);
      const duration = stroke.points.at(-1)?.time ?? 0;
      draft.dabs = draft.dabs.filter(dab => duration - dab.time < stroke.lifetime);
      dabs = draft.dabs;
      ctx.clearRect(0, 0, width, height);
      changed = true;
    }
    ctx.setTransform(width / 1080, 0, 0, height / 1920, width / 2, height / 2);
    for (const stamp of originalStamps(stroke, dabs)) {
      if (this.draw(ctx, stamp, 0, draft.mask)) changed = true;
    }
    // Clear in output pixels next time, including after a resolution change.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return changed;
  }
  clear() {
    if (this.draft) { this.draft.canvas.width = 0; this.draft.canvas.height = 0; this.draft = null; }
    if (this.auto) { this.auto.canvas.width = 0; this.auto.canvas.height = 0; this.auto = null; }
    for (const cache of this.caches) release(cache);
    this.caches = [];
    for (const cache of this.inFlight) release(cache);
    this.inFlight.clear();
    for (const cache of this.checkpoints) release(cache);
    this.checkpoints = [];
    for (const auto of this.autoCheckpoints) { auto.canvas.width = 0; auto.canvas.height = 0; }
    this.autoCheckpoints = [];
    this.plannedStrokes = null; this.groups = [];
    this.sourceArray = null; this.sourceLookup.clear();
    this.geometry = new WeakMap(); this.data = new WeakMap(); this.checkpointTimes = new WeakMap();
    this.previousStrokes = [];
    for (const image of this.stamps) this.releaseStamp(image);
    // Force even an empty document to clear the previously composited image.
    this.hadDraft = true;
  }
  destroy() { this.clear(); this.canvas.width = 0; this.canvas.height = 0; }
}
