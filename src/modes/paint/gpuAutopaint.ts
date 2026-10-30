import { ImageSource, Particle, ParticleContainer, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { AutopaintSequence, type AutopaintSettings } from './autopaint';
import { getGifFrameAtTime } from '../../lib/gifUtils';
import { stampAlpha, stampPosition, type PaintAsset, type PaintStamp, type PaintStroke } from './model';
import { createStampImage } from './stampImage';

const BATCH_SIZE = 2048;
const ATLAS_PIXELS = 4 * 1024 * 1024;
interface Page {
  canvas: HTMLCanvasElement; source: ImageSource; textures: Texture[];
  entries: Map<string, Map<CanvasImageSource, Texture>>;
  x: number; y: number; row: number; alive: boolean;
}
/** Ordered, bounded quad pool. Only small pre-masked source frames cross the
 * Canvas/GPU boundary; accumulated paint stays in a render texture. Atlas pages
 * may evict after flushing, without invalidating any accumulated pixels. */
class StampBatch {
  readonly stats = { stamps: 0, batches: 0, atlasBuilds: 0, atlasEvictions: 0 };
  private pages: Page[] = [];
  private resolved = new WeakMap<PaintStroke, Map<CanvasImageSource, { page: Page; texture: Texture }>>();
  private particles: Particle[] = [];
  private container = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, uvs: true, color: true } });
  private current: Page | null = null;
  private count = 0;
  constructor(private renderer: Renderer, private width: number, private height: number) {}
  get atlasPixels() { return this.pages.reduce((n, p) => n + p.canvas.width * p.canvas.height, 0); }
  get poolSize() { return this.particles.length; }

  draw(stamp: PaintStamp, time: number, assets: Map<string, PaintAsset>, target: RenderTexture) {
    const alpha = stampAlpha(stamp, time);
    const asset = assets.get(stamp.stroke.assetId);
    if (alpha <= 0 || !asset) return;
    const frame = getGifFrameAtTime(asset.gifData, stamp.sourceTime);
    if (!frame) return;
    const s = stamp.stroke;
    const cached = this.resolved.get(s)?.get(frame);
    let page = cached?.page.alive ? cached.page : undefined;
    let texture = page ? cached!.texture : undefined;
    let key = '';
    if (!texture) {
      key = [s.pattern, s.size, s.rotation, s.imageZoom, s.imageRotation, asset.gifData.width, asset.gifData.height].join('/');
      for (const p of this.pages) {
        const found = p.entries.get(key)?.get(frame);
        if (found) { page = p; texture = found; break; }
      }
    }
    if (!texture) {
      const image = createStampImage(s, frame, asset.gifData.width, asset.gifData.height, this.width, this.height);
      const w = image.width + 2, h = image.height + 2;
      page = this.pages.find(p => this.fits(p, w, h));
      if (!page) {
        // One oversize page is permitted for high-resolution exports.
        const side = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(w, h))));
        while (this.pages.length && this.atlasPixels + side * side > ATLAS_PIXELS) {
          this.flush(target);
          this.unbind(target);
          this.release(this.pages.shift()!);
          this.stats.atlasEvictions++;
        }
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = side;
        page = { canvas, source: new ImageSource({ resource: canvas, autoGarbageCollect: false }), textures: [], entries: new Map(), x: 0, y: 0, row: 0, alive: true };
        this.pages.push(page);
      }
      if (page.x + w > page.canvas.width) { page.x = 0; page.y += page.row; page.row = 0; }
      // Flush before changing a texture source used by the queued batch.
      this.flush(target);
      const ctx = page.canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create the GIF Paint atlas context.');
      ctx.drawImage(image, page.x + 1, page.y + 1);
      texture = new Texture({ source: page.source, frame: new Rectangle(page.x + 1, page.y + 1, image.width, image.height) });
      page.source.update();
      page.textures.push(texture);
      let entries = page.entries.get(key);
      if (!entries) { entries = new Map(); page.entries.set(key, entries); }
      entries.set(frame, texture);
      page.x += w; page.row = Math.max(page.row, h);
      image.width = image.height = 0;
      this.stats.atlasBuilds++;
    }
    let resolved = this.resolved.get(s);
    if (!resolved) { resolved = new Map(); this.resolved.set(s, resolved); }
    resolved.set(frame, { page: page!, texture });
    // Never sort by texture: translucent overlapping deposits require source order.
    if (this.current !== page || this.count === BATCH_SIZE) this.flush(target);
    this.current = page!;
    const particle = this.particles[this.count] ??= new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
    particle.texture = texture;
    const position = stampPosition(stamp);
    particle.x = (position.x + 540) * this.width / 1080;
    particle.y = (position.y + 960) * this.height / 1920;
    particle.scaleX = particle.scaleY = stamp.pressure ?? 1;
    particle.alpha = alpha;
    this.count++;
    this.stats.stamps++;
  }
  private fits(p: Page, w: number, h: number) {
    return w <= p.canvas.width && (p.x + w <= p.canvas.width ? p.y + h : p.y + p.row + h) <= p.canvas.height;
  }
  flush(target: RenderTexture) {
    if (!this.count) return;
    this.container.texture = this.particles[0].texture;
    this.container.particleChildren = this.particles.slice(0, this.count);
    this.container.update();
    this.renderer.render({ container: this.container, target, clear: false });
    this.count = 0; this.current = null;
    this.stats.batches++;
  }
  private release(page: Page) {
    page.alive = false;
    for (const texture of page.textures) texture.destroy();
    page.source.destroy(); page.canvas.width = page.canvas.height = 0;
  }
  private unbind(target: RenderTexture) {
    // Pixi's particle pipe shares its shader. Detach the page before destroying
    // its source, which otherwise destroys that shader's active bind group.
    const particle = new Particle({ texture: Texture.WHITE, alpha: 0 });
    this.container.texture = Texture.WHITE;
    this.container.particleChildren = [particle]; this.container.update();
    this.renderer.render({ container: this.container, target, clear: false });
  }
  destroy(target: RenderTexture) {
    this.unbind(target);
    this.count = 0; this.current = null;
    this.container.particleChildren = []; this.container.destroy();
    for (const page of this.pages) this.release(page);
    this.pages = []; this.particles = [];
  }
}

/** Autopaint is the dense-animation prototype. Saved paths and manual drafts
 * remain the reference implementation. Each preview/export session owns two
 * output textures, never a texture or scene node for each historical gesture. */
export class GpuAutopaint {
  readonly sprite = new Sprite();
  readonly stats = { rebuilds: 0, completedFrames: 0 };
  private front: RenderTexture | null = null;
  private back: RenderTexture | null = null;
  private batch: StampBatch | null = null;
  private config: AutopaintSettings | null = null;
  private sources: PaintAsset[] = [];
  private assets = new Map<string, PaintAsset>();
  private sequence: AutopaintSequence | null = null;
  private time = -Infinity;
  private requestedTime = -Infinity;
  private live: PaintStamp[] = [];
  private work: Generator<void> | null = null;
  private width = 0;
  private height = 0;
  get rebuilding() { return this.work !== null; }
  get metrics() { return { ...this.stats, ...this.batch?.stats, atlasPixels: this.batch?.atlasPixels ?? 0,
    renderPixels: this.front ? this.width * this.height * 2 : 0, poolSize: this.batch?.poolSize ?? 0, liveStamps: this.live.length }; }

  render(config: AutopaintSettings | undefined, assets: PaintAsset[], time: number, width: number, height: number, preview: boolean) {
    time = Math.max(0, time);
    if (!config?.enabled) { this.reset(); this.sprite.visible = false; return; }
    this.sprite.visible = true;
    const sources = assets.filter(a => !a.retired);
    const invalid = config !== this.config || width !== this.width || height !== this.height || time < this.requestedTime
      || sources.length !== this.sources.length || sources.some((a, i) => a.id !== this.sources[i].id || a.gifData !== this.sources[i].gifData);
    if (invalid) {
      this.reset(!!this.front && width === this.width && height === this.height); this.width = width; this.height = height; this.config = config; this.sources = sources;
      this.assets = new Map(sources.map(a => [a.id, a]));
      this.sequence = new AutopaintSequence(config, sources);
      if (!this.front) {
        this.front = RenderTexture.create({ width, height }); this.back = RenderTexture.create({ width, height });
        this.clear(this.front); this.clear(this.back);
      }
      this.batch = new StampBatch(this.renderer, width, height);
      this.sprite.texture = this.front;
      this.stats.rebuilds++;
    }
    this.requestedTime = time;
    if (!this.work && time !== this.time) this.work = this.update(time);
    const deadline = performance.now() + 3;
    let steps = 0;
    while (this.work) {
      if (this.work.next().done) { this.work = null; break; }
      if (preview && (++steps >= 512 || performance.now() >= deadline)) break;
    }
  }
  constructor(private renderer: Renderer) {}
  private clear(target: RenderTexture) {
    const empty = new Sprite();
    this.renderer.render({ container: empty, target, clear: true }); empty.destroy();
  }
  private *update(time: number): Generator<void> {
    const lifetime = this.config!.brush.lifetime;
    const rebuilding = this.time === -Infinity;
    // Only reconstruction and exact fading need a second surface. Warm
    // accumulation deposits directly into the persistent front texture.
    const target = lifetime > 0 || rebuilding ? this.back! : this.front!;
    if (rebuilding && lifetime === 0) this.clear(target);
    const hadLive = this.live.length > 0;
    const from = Math.max(this.time, lifetime > 0 ? time - lifetime : -1e-9);
    let operations = 0;
    for (const stamp of this.sequence!.stamps(from, time)) {
      if (lifetime > 0) this.live.push(stamp);
      else this.batch!.draw(stamp, time, this.assets, target);
      if (++operations % BATCH_SIZE === 0) { this.batch!.flush(target); yield; }
    }
    if (lifetime > 0) {
      this.live = this.live.filter(s => stampAlpha(s, time) > 0);
      if (!hadLive && !this.live.length) { this.time = time; this.stats.completedFrames++; return; }
      this.clear(target);
      for (const stamp of this.live) {
        this.batch!.draw(stamp, time, this.assets, target);
        if (++operations % BATCH_SIZE === 0) { this.batch!.flush(target); yield; }
      }
    }
    this.batch!.flush(target);
    if (target === this.back) {
      this.back = this.front; this.front = target; this.sprite.texture = target;
    }
    this.time = time; this.stats.completedFrames++;
  }
  private reset(retainOutput = false) {
    this.work?.return(undefined); this.work = null;
    this.sprite.texture = Texture.EMPTY;
    if (this.batch && this.front) this.batch.destroy(this.front); this.batch = null;
    if (!retainOutput) {
      this.front?.destroy(true); this.back?.destroy(true); this.front = this.back = null;
    }
    this.config = null; this.sources = []; this.assets.clear(); this.sequence = null;
    this.live = []; this.time = this.requestedTime = -Infinity;
  }
  destroy() { this.reset(); this.sprite.destroy(); }
}
