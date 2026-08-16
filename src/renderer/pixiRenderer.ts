import {
  autoDetectRenderer,
  Container,
  Graphics,
  ImageSource,
  RenderTexture,
  Renderer,
  Sprite,
  Texture,
  TilingSprite,
  type BLEND_MODES
} from 'pixi.js';
import 'pixi.js/advanced-blend-modes';
import './hueBlend';
import { GifData, Layer, PolygonLayer } from '../types';
import { getGifFrameIndexAtTime } from '../lib/gifUtils';
import { applyMotion, getInstances } from '../lib/motion';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState, getCachedImage } from './render2d';

// The app's BlendMode strings are identical to Pixi's names. The advanced set
// ('color-dodge', 'color-burn', 'saturation', 'color', 'luminosity') comes from
// the advanced-blend-modes import; 'hue' is registered by ./hueBlend.
function toBlendMode(mode: string): BLEND_MODES {
  return mode as BLEND_MODES;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const DEG = Math.PI / 180;

interface SymmetryNode {
  container: Container;
  sprites: Sprite[];
}

interface PolygonNode {
  container: Container;
  tiler: TilingSprite;
  maskG: Graphics;
  fillG: Graphics;
  strokeG: Graphics;
  // Change-detection keys so Graphics geometry is only rebuilt when needed.
  pointsRef: PolygonLayer['points'] | null;
  fillColor: string | undefined;
  strokeColor: string | undefined;
  strokeWidth: number;
}

/**
 * GPU renderer: mirrors the document into a Pixi scene graph each frame and
 * renders it with WebGPU (WebGL fallback). Pure function of (t, state) like
 * the Canvas 2D path — exports extract any (t, resolution) deterministically.
 */
export class PixiSceneRenderer {
  private renderer: Renderer;
  private stage = new Container();
  private bg = new Graphics();
  private root = new Container();
  private symContainer = new Container();
  private polyContainer = new Container();

  private symNodes = new Map<string, SymmetryNode>();
  private polyNodes = new Map<string, PolygonNode>();
  private symOrder = '';
  private polyOrder = '';

  private gifTextures = new Map<GifData, Texture[]>();
  private staticTextures = new Map<string, Texture>();

  private bgW = 0;
  private bgH = 0;
  private bgColor = '';

  private constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.stage.addChild(this.bg, this.root);
    this.root.addChild(this.symContainer, this.polyContainer);
  }

  static async create(canvas: HTMLCanvasElement): Promise<PixiSceneRenderer> {
    const renderer = await autoDetectRenderer({
      preference: 'webgpu',
      canvas,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      antialias: true,
      backgroundAlpha: 0
    });
    return new PixiSceneRenderer(renderer);
  }

  get rendererType(): string {
    return this.renderer.name; // 'webgpu' | 'webgl'
  }

  /** Render the scene at time t to the live canvas. */
  render(t: number, state: RenderState) {
    this.sync(t, state, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.renderer.render(this.stage);
  }

  /**
   * Render the scene at time t into an offscreen RenderTexture at an arbitrary
   * resolution and return the pixels as a canvas. Used by the export paths.
   */
  extract(t: number, state: RenderState, width: number, height: number): HTMLCanvasElement {
    this.sync(t, state, width, height);
    const rt = RenderTexture.create({ width, height });
    this.renderer.render({ container: this.stage, target: rt });
    const out = this.renderer.extract.canvas(rt) as HTMLCanvasElement;
    rt.destroy(true);
    return out;
  }

  destroy() {
    for (const arr of this.gifTextures.values()) arr.forEach((tx) => tx.destroy(true));
    this.gifTextures.clear();
    for (const tx of this.staticTextures.values()) tx.destroy(true);
    this.staticTextures.clear();
    this.stage.destroy({ children: true });
    this.renderer.destroy();
  }

  // ---------------------------------------------------------------- scene sync

  private sync(t: number, state: RenderState, width: number, height: number) {
    this.layout(width, height, state.canvasBg);

    const symVisible = state.appMode === 'symmetry';
    this.symContainer.visible = symVisible;
    this.polyContainer.visible = !symVisible;

    // Node membership tracks the document in both modes so deletions (and
    // undo of deletions) are handled even while the other mode is active.
    this.reconcileSymNodes(state.layers);
    this.reconcilePolyNodes(state.polygonLayers);

    if (symVisible) {
      state.layers.forEach((layer) => this.syncSymmetryLayer(this.symNodes.get(layer.id)!, layer, t));
    } else {
      state.polygonLayers.forEach((poly) => this.syncPolygon(this.polyNodes.get(poly.id)!, poly, t));
    }

    this.sweepTextures(state);
  }

  private layout(width: number, height: number, bgColor: string) {
    if (this.bgW !== width || this.bgH !== height || this.bgColor !== bgColor) {
      this.bg.clear().rect(0, 0, width, height).fill(bgColor);
      this.bgW = width;
      this.bgH = height;
      this.bgColor = bgColor;
    }
    this.root.position.set(width / 2, height / 2);
    this.root.scale.set(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
  }

  private reconcileSymNodes(layers: Layer[]) {
    const ids = new Set(layers.map((l) => l.id));
    for (const [id, node] of this.symNodes) {
      if (!ids.has(id)) {
        node.container.destroy({ children: true });
        this.symNodes.delete(id);
      }
    }
    for (const layer of layers) {
      if (!this.symNodes.has(layer.id)) {
        const container = new Container();
        this.symNodes.set(layer.id, { container, sprites: [] });
      }
    }
    const order = layers.map((l) => l.id).join('\n');
    if (order !== this.symOrder) {
      this.symContainer.removeChildren();
      layers.forEach((l) => this.symContainer.addChild(this.symNodes.get(l.id)!.container));
      this.symOrder = order;
    }
  }

  private reconcilePolyNodes(polys: PolygonLayer[]) {
    const ids = new Set(polys.map((p) => p.id));
    for (const [id, node] of this.polyNodes) {
      if (!ids.has(id)) {
        node.container.destroy({ children: true });
        this.polyNodes.delete(id);
      }
    }
    for (const poly of polys) {
      if (!this.polyNodes.has(poly.id)) {
        this.polyNodes.set(poly.id, this.createPolygonNode());
      }
    }
    const order = polys.map((p) => p.id).join('\n');
    if (order !== this.polyOrder) {
      this.polyContainer.removeChildren();
      polys.forEach((p) => this.polyContainer.addChild(this.polyNodes.get(p.id)!.container));
      this.polyOrder = order;
    }
  }

  private createPolygonNode(): PolygonNode {
    const container = new Container();
    const tiler = new TilingSprite({ texture: Texture.EMPTY, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    // Cover the full canvas; local origin lands on the canvas top-left so the
    // tile transform matches the Canvas 2D pattern space exactly.
    tiler.position.set(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    const maskG = new Graphics();
    const fillG = new Graphics();
    const strokeG = new Graphics();
    tiler.mask = maskG;
    container.addChild(tiler, fillG, maskG, strokeG);
    return {
      container, tiler, maskG, fillG, strokeG,
      pointsRef: null, fillColor: undefined, strokeColor: undefined, strokeWidth: -1
    };
  }

  // ------------------------------------------------------------ symmetry mode

  private syncSymmetryLayer(node: SymmetryNode, layer: Layer, t: number) {
    let texture: Texture | null = null;
    if (!layer.hidden) {
      if (layer.gifData) {
        const idx = getGifFrameIndexAtTime(layer.gifData, t, layer.gifSpeed ?? 1);
        if (idx >= 0) texture = this.getGifTextures(layer.gifData)[idx];
      }
      if (!texture) texture = this.getStaticTexture(layer.src);
    }
    node.container.visible = texture !== null;
    if (!texture) return;

    const instances = getInstances(layer, t);
    while (node.sprites.length < instances.length) {
      const sp = new Sprite();
      sp.anchor.set(0.5);
      node.sprites.push(sp);
      node.container.addChild(sp);
    }
    while (node.sprites.length > instances.length) {
      node.sprites.pop()!.destroy();
    }
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const sp = node.sprites[i];
      sp.texture = texture;
      sp.position.set(inst.x, inst.y);
      sp.rotation = inst.rotation * DEG;
      sp.scale.set(inst.scaleX, inst.scaleY);
      sp.alpha = clamp01(inst.opacity);
      sp.blendMode = toBlendMode(inst.blendMode);
    }
  }

  // ------------------------------------------------------------- polygon mode

  private syncPolygon(node: PolygonNode, polygon: PolygonLayer, t: number) {
    const visible = !polygon.hidden && polygon.points && polygon.points.length >= 3;
    node.container.visible = visible;
    if (!visible) return;

    node.container.alpha = clamp01(polygon.opacity);
    node.container.blendMode = toBlendMode(polygon.blendMode);

    let texture: Texture | null = null;
    if (polygon.gifData) {
      const idx = getGifFrameIndexAtTime(polygon.gifData, t, polygon.gifSpeed ?? 1);
      if (idx >= 0) texture = this.getGifTextures(polygon.gifData)[idx];
    }
    if (!texture && polygon.src) texture = this.getStaticTexture(polygon.src);

    const geometryChanged = node.pointsRef !== polygon.points;
    if (geometryChanged) {
      node.maskG.clear().poly(polygon.points, true).fill(0xffffff);
    }

    if (texture) {
      node.tiler.visible = true;
      node.fillG.visible = false;
      node.tiler.texture = texture;
      const scaleVal = Math.max(0.01, applyMotion(polygon.textureScale ?? 1, polygon.motionTextureScale, t));
      const rotationVal = applyMotion(polygon.textureRotation ?? 0, polygon.motionTextureRotation, t);
      const offsetX = applyMotion(polygon.textureOffsetX ?? 0, polygon.motionTextureOffsetX, t);
      const offsetY = applyMotion(polygon.textureOffsetY ?? 0, polygon.motionTextureOffsetY, t);
      node.tiler.tileScale.set(scaleVal, scaleVal);
      node.tiler.tileRotation = rotationVal * DEG;
      node.tiler.tilePosition.set(offsetX, offsetY);
    } else {
      node.tiler.visible = false;
      node.fillG.visible = true;
      const fillColor = polygon.fillColor || '#6366f1';
      if (geometryChanged || node.fillColor !== fillColor) {
        node.fillG.clear().poly(polygon.points, true).fill(fillColor);
        node.fillColor = fillColor;
      }
    }

    const hasStroke = polygon.strokeWidth > 0 && !!polygon.strokeColor && polygon.strokeColor !== 'transparent';
    if (geometryChanged || node.strokeColor !== polygon.strokeColor || node.strokeWidth !== polygon.strokeWidth) {
      node.strokeG.clear();
      if (hasStroke) {
        node.strokeG.poly(polygon.points, true).stroke({
          width: polygon.strokeWidth,
          color: polygon.strokeColor,
          join: 'round'
        });
      }
      node.strokeColor = polygon.strokeColor;
      node.strokeWidth = polygon.strokeWidth;
    }

    node.pointsRef = polygon.points;
  }

  // ----------------------------------------------------------------- textures

  private getGifTextures(gif: GifData): Texture[] {
    let arr = this.gifTextures.get(gif);
    if (!arr) {
      arr = gif.frames.map(
        (f) => new Texture({ source: new ImageSource({ resource: f.image as ImageBitmap }) })
      );
      this.gifTextures.set(gif, arr);
    }
    return arr;
  }

  private getStaticTexture(src?: string): Texture | null {
    if (!src) return null;
    const cached = this.staticTextures.get(src);
    if (cached) return cached;
    const img = getCachedImage(src);
    if (!img) return null; // not decoded yet; retried next frame
    const tex = new Texture({ source: new ImageSource({ resource: img }) });
    this.staticTextures.set(src, tex);
    return tex;
  }

  /**
   * GPU memory doesn't garbage-collect itself: destroy textures whose source
   * layer no longer exists in the document. The underlying ImageBitmaps are
   * left intact, so undoing a delete rebuilds textures from them.
   */
  private sweepTextures(state: RenderState) {
    const gifs = new Set<GifData>();
    const srcs = new Set<string>();
    for (const l of state.layers) {
      if (l.gifData) gifs.add(l.gifData);
      if (l.src) srcs.add(l.src);
    }
    for (const p of state.polygonLayers) {
      if (p.gifData) gifs.add(p.gifData);
      if (p.src) srcs.add(p.src);
    }
    for (const [gif, arr] of this.gifTextures) {
      if (!gifs.has(gif)) {
        arr.forEach((tx) => tx.destroy(true));
        this.gifTextures.delete(gif);
      }
    }
    for (const [src, tex] of this.staticTextures) {
      if (!srcs.has(src)) {
        tex.destroy(true);
        this.staticTextures.delete(src);
      }
    }
  }
}
