import {
  autoDetectRenderer,
  BlurFilter,
  CanvasSource,
  ColorMatrixFilter,
  Container,
  Filter,
  Graphics,
  ImageSource,
  NoiseFilter,
  RenderTexture,
  Renderer,
  Sprite,
  Texture,
  TilingSprite,
  type BLEND_MODES
} from 'pixi.js';
import 'pixi.js/advanced-blend-modes';
import './hueBlend';
import { RgbSplitFilter } from './filters/rgbSplitFilter';
import { DuotoneFilter } from './filters/duotoneFilter';
import { ScanlinesFilter } from './filters/scanlinesFilter';
import { GifData, Layer, PolygonLayer, PolygonPoint } from '../types';
import { getGifFrameIndexAtTime } from '../lib/gifUtils';
import {
  applyMotion,
  getDeformedPoints,
  getInstances,
  getModulatedLayer,
  getPolygonSymmetryTransforms,
  resolveSymmetryParams
} from '../lib/motion';
import { getVoronoiCells, VoronoiCell } from '../lib/voronoi';
import { CANVAS_HEIGHT, CANVAS_WIDTH, RenderState, getCachedImage, getLayerSize } from './render2d';
import type { ThreeSceneRenderer } from './threeRenderer';
import type { FlythroughRenderer } from './flythroughRenderer';
import type { TunnelRenderer } from './tunnelRenderer';
import type { LandscapeRenderer } from './landscapeRenderer';
import {
  buildGifVoronoiLayout,
  gifVoronoiCoverRect,
  gifVoronoiGeometryFrameKey,
  gifVoronoiSourceTime,
  GifVoronoiCell
} from '../lib/gifVoronoi';
import { isNative } from '../lib/native';

// The app's BlendMode strings are identical to Pixi's names. The advanced set
// ('color-dodge', 'color-burn', 'saturation', 'color', 'luminosity') comes from
// the advanced-blend-modes import; 'hue' is registered by ./hueBlend.
function toBlendMode(mode: string): BLEND_MODES {
  return mode as BLEND_MODES;
}

// Dev flag: ?renderer=webgl forces the native backend in a browser session.
function isWebglForced(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('renderer') === 'webgl';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const DEG = Math.PI / 180;

// A masked copy of the layer's own sprite, used only in voronoi mode. Mask
// and sprite live in the same wrapper so displacing the wrapper moves both
// together (a rigid "shard"), matching the Canvas 2D voronoi path.
interface VoronoiShardNode {
  wrapper: Container;
  sprite: Sprite;
  maskG: Graphics;
}

interface SymmetryNode {
  container: Container;
  sprites: Sprite[];
  shards: VoronoiShardNode[];
  voronoiKey: string;
  voronoiCells: VoronoiCell[];
}

// One instance per symmetrized copy. Pixi display objects can only have a
// single parent, so each copy needs its own mask/tiler/fill/stroke set,
// pooled the same way SymmetryNode pools sprites.
interface PolygonInstanceNode {
  wrapper: Container;
  tiler: TilingSprite;
  maskG: Graphics;
  fillG: Graphics;
  strokeG: Graphics;
}

// One shard per Voronoi cell. Two nested container masks (outer = parent
// shape, inner = this cell) intersect automatically through Pixi's render
// pipeline — no polygon-polygon boolean math needed, same idea as chaining
// two ctx.clip() calls in the Canvas 2D path.
interface PolygonVoronoiShardNode {
  outer: Container;
  parentMaskG: Graphics;
  inner: Container;
  cellMaskG: Graphics;
  tiler: TilingSprite;
  fillG: Graphics;
  strokeG: Graphics;
}

interface PolygonNode {
  container: Container;
  instances: PolygonInstanceNode[];
  voronoiShards: PolygonVoronoiShardNode[];
  voronoiKey: string;
  voronoiCells: VoronoiCell[];
  // Change-detection keys so Graphics geometry is only rebuilt when needed.
  pointsRef: PolygonLayer['points'] | null;
  fillColor: string | undefined;
  strokeColor: string | undefined;
  strokeWidth: number;
}

interface GifVoronoiCellNode {
  wrapper: Container;
  content: Container;
  sprite: Sprite;
  fill: Sprite;
  maskG: Graphics;
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
  private gifVoronoiContainer = new Container();
  private mesh3dSprite = new Sprite();
  private flythroughSprite = new Sprite();
  private tunnelSprite = new Sprite();
  private landscapeSprite = new Sprite();

  // Lazily created (and lazily *imported* — three.js is a ~600KB dependency
  // that only users who touch 3D mode should ever download) on first use.
  // The 3D scene renders to its own offscreen canvas (see threeRenderer.ts);
  // mesh3dTexture wraps that canvas as a Pixi texture so the 3D output
  // composites through the same Master FX stack.
  private three: ThreeSceneRenderer | null = null;
  private threeLoading: Promise<void> | null = null;
  private destroyed = false;
  private mesh3dTexture: Texture<CanvasSource> | null = null;
  private mesh3dTexW = 0;
  private mesh3dTexH = 0;
  private flythroughRenderer: FlythroughRenderer | null = null;
  private flythroughLoading: Promise<void> | null = null;
  private flythroughTexture: Texture<CanvasSource> | null = null;
  private flythroughTexW = 0;
  private flythroughTexH = 0;
  private tunnelRenderer: TunnelRenderer | null = null;
  private tunnelLoading: Promise<void> | null = null;
  private tunnelTexture: Texture<CanvasSource> | null = null;
  private tunnelTexW = 0;
  private tunnelTexH = 0;
  private landscapeRenderer: LandscapeRenderer | null = null;
  private landscapeLoading: Promise<void> | null = null;
  private landscapeTexture: Texture<CanvasSource> | null = null;
  private landscapeTexW = 0;
  private landscapeTexH = 0;

  private symNodes = new Map<string, SymmetryNode>();
  private polyNodes = new Map<string, PolygonNode>();
  private symOrder = '';
  private polyOrder = '';
  private gifVoronoiNodes: GifVoronoiCellNode[] = [];
  private gifVoronoiLayout: GifVoronoiCell[] = [];
  private gifVoronoiLayoutKey = '';
  private gifVoronoiGeometryKey = '';
  private gifVoronoiGutterG = new Graphics();
  private gifVoronoiGutterKey = '';

  private gifTextures = new Map<GifData, Texture[]>();
  private staticTextures = new Map<string, Texture>();

  private rgbSplitFilter = new RgbSplitFilter();
  private duotoneFilter = new DuotoneFilter();
  private scanlinesFilter = new ScanlinesFilter();
  private noiseFilter = new NoiseFilter();
  private blurFilter = new BlurFilter();
  private colorMatrixFilter = new ColorMatrixFilter();

  private bgW = 0;
  private bgH = 0;
  private bgColor = '';
  private exportTarget: RenderTexture | null = null;
  private exportTargetW = 0;
  private exportTargetH = 0;

  private constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.stage.addChild(this.bg, this.root, this.mesh3dSprite, this.flythroughSprite, this.tunnelSprite, this.landscapeSprite);
    this.root.addChild(this.symContainer, this.polyContainer, this.gifVoronoiContainer);
    this.gifVoronoiContainer.addChild(this.gifVoronoiGutterG);
    this.mesh3dSprite.visible = false;
    this.flythroughSprite.visible = false;
    this.tunnelSprite.visible = false;
    this.landscapeSprite.visible = false;
  }

  static async create(canvas: HTMLCanvasElement): Promise<PixiSceneRenderer> {
    const renderer = await autoDetectRenderer({
      // The Tauri shell runs on WKWebView, where WebGL is the only reliable
      // backend. `?renderer=webgl` reproduces that native path in a browser so
      // GPU parity can be checked without a native build.
      preference: isNative() || isWebglForced() ? 'webgl' : 'webgpu',
      canvas,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      antialias: true,
      backgroundAlpha: 0,
      gcActive: false
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
   * Render the scene at time t into a reusable offscreen RenderTexture and
   * copy its pixels into the caller-owned canvas. Long exports must not create
   * a new GPU render target and DOM canvas for every frame.
   */
  extract(t: number, state: RenderState, width: number, height: number, target: HTMLCanvasElement): void {
    this.sync(t, state, width, height);
    if (!this.exportTarget || this.exportTargetW !== width || this.exportTargetH !== height) {
      this.exportTarget?.destroy(true);
      this.exportTarget = RenderTexture.create({ width, height });
      this.exportTargetW = width;
      this.exportTargetH = height;
    }
    this.renderer.render({ container: this.stage, target: this.exportTarget });
    const extracted = this.renderer.extract.pixels(this.exportTarget);
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const ctx = target.getContext('2d');
    if (!ctx) throw new Error('Could not create the export canvas context.');
    ctx.putImageData(new ImageData(extracted.pixels, extracted.width, extracted.height), 0, 0);
  }

  destroy() {
    this.destroyed = true;
    for (const arr of this.gifTextures.values()) arr.forEach((tx) => tx.destroy(true));
    this.gifTextures.clear();
    for (const tx of this.staticTextures.values()) tx.destroy(true);
    this.staticTextures.clear();
    this.three?.destroy();
    this.flythroughRenderer?.destroy();
    this.tunnelRenderer?.destroy();
    this.landscapeRenderer?.destroy();
    this.mesh3dTexture?.destroy(true);
    this.flythroughTexture?.destroy(true);
    this.tunnelTexture?.destroy(true);
    this.landscapeTexture?.destroy(true);
    this.exportTarget?.destroy(true);
    this.exportTarget = null;
    // Masks are children of the nodes they clip, so the stage teardown below
    // frees them along with everything else in the tree.
    this.gifVoronoiNodes = [];
    this.symNodes.clear();
    this.polyNodes.clear();
    this.rgbSplitFilter.destroy();
    this.duotoneFilter.destroy();
    this.scanlinesFilter.destroy();
    this.noiseFilter.destroy();
    this.blurFilter.destroy();
    this.colorMatrixFilter.destroy();
    this.stage.destroy({ children: true });
    this.renderer.destroy();
  }

  // ---------------------------------------------------------------- scene sync

  private sync(t: number, state: RenderState, width: number, height: number) {
    this.layout(
      width,
      height,
      state.appMode === 'tunnel'
        ? state.tunnel.voidColor
        : state.appMode === 'gif-voronoi'
          ? state.gifVoronoi.backgroundColor
          : state.appMode === 'landscape'
            ? state.landscape.skyBackgroundColor
          : state.canvasBg
    );

    const symVisible = state.appMode === 'symmetry';
    const mesh3dVisible = state.appMode === '3d';
    const flythroughVisible = state.appMode === 'flythrough';
    const tunnelVisible = state.appMode === 'tunnel';
    const gifVoronoiVisible = state.appMode === 'gif-voronoi';
    const landscapeVisible = state.appMode === 'landscape';
    this.symContainer.visible = symVisible;
    this.polyContainer.visible = state.appMode === 'polygon';
    this.gifVoronoiContainer.visible = gifVoronoiVisible;
    this.mesh3dSprite.visible = mesh3dVisible;
    this.flythroughSprite.visible = flythroughVisible;
    this.tunnelSprite.visible = tunnelVisible;
    this.landscapeSprite.visible = landscapeVisible;
    if (!tunnelVisible && this.tunnelRenderer) {
      this.tunnelRenderer.destroy();
      this.tunnelRenderer = null;
      this.tunnelTexture?.destroy(true);
      this.tunnelTexture = null;
      this.tunnelSprite.texture = Texture.EMPTY;
      this.tunnelTexW = 0;
      this.tunnelTexH = 0;
    }
    if (!landscapeVisible && this.landscapeRenderer) {
      this.landscapeRenderer.destroy();
      this.landscapeRenderer = null;
      this.landscapeTexture?.destroy(true);
      this.landscapeTexture = null;
      this.landscapeSprite.texture = Texture.EMPTY;
      this.landscapeTexW = 0;
      this.landscapeTexH = 0;
    }

    // Node membership tracks the document in every mode so deletions (and
    // undo of deletions) are handled even while another mode is active.
    this.reconcileSymNodes(state.layers);
    this.reconcilePolyNodes(state.polygonLayers);

    if (landscapeVisible) {
      this.syncLandscape(t, state, width, height);
    } else if (gifVoronoiVisible) {
      this.syncGifVoronoi(t, state);
    } else if (tunnelVisible) {
      this.syncTunnel(t, state, width, height);
    } else if (flythroughVisible) {
      this.syncFlythrough(t, state, width, height);
    } else if (mesh3dVisible) {
      this.syncMesh3d(t, state, width, height);
    } else if (symVisible) {
      state.layers.forEach((layer) => this.syncSymmetryLayer(this.symNodes.get(layer.id)!, layer, t));
    } else {
      state.polygonLayers.forEach((poly) => this.syncPolygon(this.polyNodes.get(poly.id)!, poly, t));
    }

    this.syncMasterFx(t, state, width, height);
    this.sweepTextures(state);
  }

  // ------------------------------------------------------------ GIF landscape

  private syncLandscape(t: number, state: RenderState, width: number, height: number) {
    if (!this.landscapeRenderer) {
      if (!this.landscapeLoading) {
        this.landscapeLoading = import('./landscapeRenderer')
          .then(mod => {
            if (this.destroyed) return;
            this.landscapeRenderer = mod.LandscapeRenderer.create();
          })
          .finally(() => {
            this.landscapeLoading = null;
          });
      }
      return;
    }
    const canvas = this.landscapeRenderer.renderToCanvas(
      t,
      state.landscapeTerrainAssets,
      state.landscapeSkySources,
      state.landscape,
      width,
      height
    );
    if (!this.landscapeTexture) {
      this.landscapeTexture = new Texture({ source: new CanvasSource({ resource: canvas, width, height }) });
      this.landscapeSprite.texture = this.landscapeTexture;
    } else if (this.landscapeTexW !== width || this.landscapeTexH !== height) {
      this.landscapeTexture.source.resize(width, height, 1);
    }
    this.landscapeTexW = width;
    this.landscapeTexH = height;
    this.landscapeTexture.source.update();
    this.landscapeSprite.position.set(0, 0);
    this.landscapeSprite.width = width;
    this.landscapeSprite.height = height;
  }

  // ---------------------------------------------------------- GIF Voronoi

  private createGifVoronoiCellNode(): GifVoronoiCellNode {
    const wrapper = new Container();
    const content = new Container();
    const sprite = new Sprite();
    const fill = new Sprite(Texture.WHITE);
    const maskG = new Graphics();
    sprite.anchor.set(0.5);
    fill.anchor.set(0.5);
    content.addChild(fill, sprite);
    content.mask = maskG;
    // The mask has to be in the scene graph or Pixi never updates its
    // transform: it stays at the render group's origin while the content sits
    // under the centred `root`, so the two never overlap and every cell is
    // clipped away. As a sibling of the content it shares the untransformed
    // design space the cell polygon was built in.
    wrapper.addChild(content, maskG);
    return { wrapper, content, sprite, fill, maskG };
  }

  private syncGifVoronoi(t: number, state: RenderState) {
    const config = state.gifVoronoi;
    const stageBounds = {
      minX: -CANVAS_WIDTH / 2,
      minY: -CANVAS_HEIGHT / 2,
      maxX: CANVAS_WIDTH / 2,
      maxY: CANVAS_HEIGHT / 2
    };
    const geometryKey = gifVoronoiGeometryFrameKey(config, t);
    const geometryChanged = geometryKey !== this.gifVoronoiGeometryKey;
    const layoutKey = [
      geometryKey,
      config.arrangement,
      config.occupancy,
      config.blankFill,
      config.blankColor,
      config.palette.join(','),
      state.gifVoronoiAssets.map(asset => asset.id).join(',')
    ].join('|');
    const layoutChanged = layoutKey !== this.gifVoronoiLayoutKey;
    if (layoutChanged) {
      this.gifVoronoiLayout = buildGifVoronoiLayout(state.gifVoronoiAssets, config, stageBounds, t);
      this.gifVoronoiLayoutKey = layoutKey;
    }

    let nodeCreated = false;
    while (this.gifVoronoiNodes.length < this.gifVoronoiLayout.length) {
      const node = this.createGifVoronoiCellNode();
      this.gifVoronoiNodes.push(node);
      this.gifVoronoiContainer.addChild(node.wrapper);
      nodeCreated = true;
    }
    while (this.gifVoronoiNodes.length > this.gifVoronoiLayout.length) {
      const node = this.gifVoronoiNodes.pop()!;
      node.wrapper.destroy({ children: true });
    }

    const needsRedrawGeometry = geometryChanged || nodeCreated;
    if (geometryChanged) {
      this.gifVoronoiGeometryKey = geometryKey;
    }

    for (let index = 0; index < this.gifVoronoiLayout.length; index++) {
      const cell = this.gifVoronoiLayout[index];
      const node = this.gifVoronoiNodes[index];
      if (needsRedrawGeometry) {
        node.maskG.clear().poly(cell.points, true).fill(0xffffff);
      }

      node.fill.position.set(
        (cell.bounds.minX + cell.bounds.maxX) / 2,
        (cell.bounds.minY + cell.bounds.maxY) / 2
      );
      node.fill.width = cell.bounds.maxX - cell.bounds.minX;
      node.fill.height = cell.bounds.maxY - cell.bounds.minY;

      if (cell.asset) {
        const sourceTime = gifVoronoiSourceTime(cell, config, t, stageBounds);
        const frameIndex = getGifFrameIndexAtTime(cell.asset.gifData, sourceTime, 1);
        const textures = this.getGifTextures(cell.asset.gifData);
        const texture = textures[frameIndex] ?? Texture.EMPTY;
        const rect = gifVoronoiCoverRect(
          cell.asset.width,
          cell.asset.height,
          cell.bounds,
          config.coverZoom,
          config.coverOffsetX,
          config.coverOffsetY
        );
        node.sprite.visible = true;
        node.fill.visible = false;
        node.sprite.texture = texture;
        node.sprite.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
        node.sprite.width = rect.width;
        node.sprite.height = rect.height;
      } else {
        node.sprite.visible = false;
        node.fill.visible = cell.blankColor !== null;
        if (cell.blankColor) node.fill.tint = cell.blankColor;
        node.fill.alpha = clamp01(config.blankOpacity);
      }
    }

    const gutterKey = `${geometryKey}|${config.gutterWidth}|${config.gutterColor}`;
    if (gutterKey !== this.gifVoronoiGutterKey) {
      this.gifVoronoiGutterG.clear();
      if (config.gutterWidth > 0) {
        for (const cell of this.gifVoronoiLayout) {
          this.gifVoronoiGutterG.poly(cell.points, true).stroke({
            width: config.gutterWidth,
            color: config.gutterColor,
            join: 'round'
          });
        }
      }
      this.gifVoronoiGutterKey = gutterKey;
    }

    if (
      this.gifVoronoiGutterG.parent === this.gifVoronoiContainer &&
      this.gifVoronoiContainer.getChildIndex(this.gifVoronoiGutterG) !==
        this.gifVoronoiContainer.children.length - 1
    ) {
      this.gifVoronoiContainer.setChildIndex(
        this.gifVoronoiGutterG,
        this.gifVoronoiContainer.children.length - 1
      );
    }
  }

  // --------------------------------------------------------------- GIF tunnel

  private syncTunnel(t: number, state: RenderState, width: number, height: number) {
    if (!this.tunnelRenderer) {
      if (!this.tunnelLoading) {
        this.tunnelLoading = import('./tunnelRenderer')
          .then((mod) => {
            if (this.destroyed) return;
            this.tunnelRenderer = mod.TunnelRenderer.create();
          })
          .finally(() => {
            this.tunnelLoading = null;
          });
      }
      return;
    }

    const canvas = this.tunnelRenderer.renderToCanvas(
      t,
      state.tunnelAssets,
      state.tunnel,
      width,
      height
    );
    if (!this.tunnelTexture) {
      this.tunnelTexture = new Texture({ source: new CanvasSource({ resource: canvas, width, height }) });
      this.tunnelSprite.texture = this.tunnelTexture;
    } else if (this.tunnelTexW !== width || this.tunnelTexH !== height) {
      this.tunnelTexture.source.resize(width, height, 1);
    }
    this.tunnelTexW = width;
    this.tunnelTexH = height;
    this.tunnelTexture.source.update();
    this.tunnelSprite.position.set(0, 0);
    this.tunnelSprite.width = width;
    this.tunnelSprite.height = height;
  }

  // ----------------------------------------------------------- flythrough mode

  private syncFlythrough(t: number, state: RenderState, width: number, height: number) {
    if (!this.flythroughRenderer) {
      if (!this.flythroughLoading) {
        this.flythroughLoading = import('./flythroughRenderer').then((mod) => {
          if (this.destroyed) return;
          this.flythroughRenderer = mod.FlythroughRenderer.create();
        });
      }
      return;
    }

    const canvas = this.flythroughRenderer.renderToCanvas(
      t,
      state.flythroughAssets,
      state.flythrough,
      width,
      height
    );
    if (!this.flythroughTexture) {
      this.flythroughTexture = new Texture({ source: new CanvasSource({ resource: canvas, width, height }) });
      this.flythroughSprite.texture = this.flythroughTexture;
    } else if (this.flythroughTexW !== width || this.flythroughTexH !== height) {
      this.flythroughTexture.source.resize(width, height, 1);
    }
    this.flythroughTexW = width;
    this.flythroughTexH = height;
    this.flythroughTexture.source.update();
    this.flythroughSprite.position.set(0, 0);
    this.flythroughSprite.width = width;
    this.flythroughSprite.height = height;
  }

  // -------------------------------------------------------------------- 3D mode

  /**
   * Renders the 3D scene into its own offscreen canvas (threeRenderer.ts)
   * and composites that canvas as a single full-frame sprite, so the 3D
   * output still passes through the Master FX filter stack below. The
   * sprite is flipped vertically because Three renders with a standard
   * Y-up camera while the rest of this app treats +Y as down — see
   * threeRenderer.ts's module comment for why the flip lives here instead
   * of inside the 3D scene's own transforms.
   */
  private syncMesh3d(t: number, state: RenderState, width: number, height: number) {
    if (!this.three) {
      if (!this.threeLoading) {
        this.threeLoading = import('./threeRenderer').then((mod) => {
          if (this.destroyed) return;
          this.three = mod.ThreeSceneRenderer.create();
        });
      }
      // Still loading three.js: nothing to composite yet this frame, the
      // sprite just keeps showing nothing (Texture.EMPTY) until it resolves.
      return;
    }
    const canvas = this.three.renderToCanvas(t, state.mesh3dLayers, state.camera3d, width, height);

    if (!this.mesh3dTexture) {
      this.mesh3dTexture = new Texture({ source: new CanvasSource({ resource: canvas, width, height }) });
      this.mesh3dSprite.texture = this.mesh3dTexture;
    } else if (this.mesh3dTexW !== width || this.mesh3dTexH !== height) {
      this.mesh3dTexture.source.resize(width, height, 1);
    }
    this.mesh3dTexW = width;
    this.mesh3dTexH = height;
    this.mesh3dTexture.source.update();

    this.mesh3dSprite.anchor.set(0.5);
    this.mesh3dSprite.position.set(width / 2, height / 2);
    this.mesh3dSprite.width = width;
    this.mesh3dSprite.height = height;
    // Assign the flip absolutely, never as `*= -1`: Pixi's width/height
    // setters preserve the existing scale sign, so a relative flip toggles
    // on and off once per sync and makes the composite alternate between
    // upright and mirrored frames.
    this.mesh3dSprite.scale.y = -Math.abs(this.mesh3dSprite.scale.y);
  }

  private syncMasterFx(t: number, state: RenderState, width: number, height: number) {
    const fx = state.masterFx;
    if (!fx || !fx.enabled) {
      if (this.stage.filters && (this.stage.filters as Filter[]).length > 0) {
        this.stage.filters = [];
      }
      return;
    }

    const activeFilters: Filter[] = [];

    // 1. Duotone / Color Gradient Map
    if (fx.duotoneEnabled && fx.duotoneIntensity > 0) {
      this.duotoneFilter.setColors(fx.duotoneShadowColor, fx.duotoneHighlightColor, fx.duotoneIntensity);
      activeFilters.push(this.duotoneFilter);
    }

    // 2. Color Adjustments
    if (fx.colorAdjustEnabled) {
      const hue = applyMotion(fx.hueRotate, fx.motionHueRotate, t);
      const hasAdjustment = fx.brightness !== 0 || fx.contrast !== 0 || fx.saturation !== 0 || hue !== 0;
      if (hasAdjustment) {
        this.colorMatrixFilter.reset();
        if (fx.brightness !== 0) {
          this.colorMatrixFilter.brightness(Math.max(0, 1 + fx.brightness), false);
        }
        if (fx.contrast !== 0) {
          this.colorMatrixFilter.contrast(fx.contrast, false);
        }
        if (fx.saturation > 0) {
          this.colorMatrixFilter.saturate(fx.saturation * 2, false);
        } else if (fx.saturation < 0) {
          this.colorMatrixFilter.desaturate();
        }
        if (hue !== 0) {
          this.colorMatrixFilter.hue(hue, false);
        }
        activeFilters.push(this.colorMatrixFilter);
      }
    }

    // 3. Bloom / Soft Glow
    if (fx.bloomEnabled && fx.bloomStrength > 0) {
      this.blurFilter.strength = fx.bloomStrength * (width / CANVAS_WIDTH);
      this.blurFilter.quality = fx.bloomQuality || 3;
      activeFilters.push(this.blurFilter);
    }

    // 4. RGB Split / Chromatic Aberration
    if (fx.rgbSplitEnabled) {
      const offsetPx = applyMotion(fx.rgbSplitOffset, fx.motionRgbSplitOffset, t) * (width / CANVAS_WIDTH);
      const angleRad = (fx.rgbSplitAngle * Math.PI) / 180;
      const dx = (Math.cos(angleRad) * offsetPx) / width;
      const dy = (Math.sin(angleRad) * offsetPx) / height;
      this.rgbSplitFilter.setOffset(dx, dy);
      activeFilters.push(this.rgbSplitFilter);
    }

    // 5. CRT Scanlines
    if (fx.scanlinesEnabled && fx.scanlinesOpacity > 0) {
      const scanTime = (t * (fx.scanlinesSpeed ?? 0.5)) % 1000;
      this.scanlinesFilter.setParams(fx.scanlinesCount || 360, fx.scanlinesOpacity, scanTime);
      activeFilters.push(this.scanlinesFilter);
    }

    // 6. Film Grain / Noise
    if (fx.noiseEnabled && fx.noiseAmount > 0) {
      this.noiseFilter.noise = fx.noiseAmount;
      this.noiseFilter.seed = (t * (fx.noiseSpeed ?? 1) * 10) % 1000;
      activeFilters.push(this.noiseFilter);
    }

    const currentFilters = (this.stage.filters as Filter[]) || [];
    let filtersChanged = currentFilters.length !== activeFilters.length;
    if (!filtersChanged) {
      for (let i = 0; i < activeFilters.length; i++) {
        if (currentFilters[i] !== activeFilters[i]) {
          filtersChanged = true;
          break;
        }
      }
    }
    if (filtersChanged) {
      this.stage.filters = activeFilters;
    }
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
        this.symNodes.set(layer.id, { container, sprites: [], shards: [], voronoiKey: '', voronoiCells: [] });
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
    return {
      container, instances: [], voronoiShards: [], voronoiKey: '', voronoiCells: [],
      pointsRef: null, fillColor: undefined, strokeColor: undefined, strokeWidth: -1
    };
  }

  private createPolygonInstanceNode(): PolygonInstanceNode {
    const wrapper = new Container();
    const tiler = new TilingSprite({ texture: Texture.EMPTY, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    // Cover the full canvas; local origin lands on the canvas top-left so the
    // tile transform matches the Canvas 2D pattern space exactly.
    tiler.position.set(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    const maskG = new Graphics();
    const fillG = new Graphics();
    const strokeG = new Graphics();
    tiler.mask = maskG;
    wrapper.addChild(tiler, fillG, maskG, strokeG);
    return { wrapper, tiler, maskG, fillG, strokeG };
  }

  // ------------------------------------------------------------ symmetry mode

  private syncSymmetryLayer(node: SymmetryNode, layer: Layer, t: number) {
    let texture: Texture | null = null;
    if (!layer.hidden) {
      if (layer.gifData) {
        const idx = getGifFrameIndexAtTime(layer.gifData, t, layer.gifSpeed ?? 1);
        if (idx >= 0) {
          const textures = this.getGifTextures(layer.gifData);
          texture = textures[Math.min(idx, textures.length - 1)] ?? null;
        }
      }
      if (!texture) texture = this.getStaticTexture(layer.src);
    }
    node.container.visible = texture !== null;
    if (!texture) return;

    if (layer.symmetry === 'voronoi') {
      this.syncSymmetryVoronoi(node, layer, texture, t);
      while (node.sprites.length > 0) node.sprites.pop()!.destroy();
      return;
    }
    while (node.shards.length > 0) node.shards.pop()!.wrapper.destroy({ children: true });

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

  /**
   * Voronoi for an image layer shatters the sprite into masked shards
   * rather than tiling a pattern (Layer has no tiling concept, unlike
   * PolygonLayer). Each shard is a wrapper containing both the sprite and
   * its cell mask, displaced together a small deterministic amount along
   * its own phase — a "shattered glass" mosaic, matching the Canvas 2D path.
   */
  private syncSymmetryVoronoi(node: SymmetryNode, layer: Layer, texture: Texture, t: number) {
    const m = getModulatedLayer(layer, t);
    const { w, h } = getLayerSize(layer);
    const halfW = (w * Math.abs(m.scaleX)) / 2;
    const halfH = (h * Math.abs(m.scaleY)) / 2;
    const bounds = { minX: m.x - halfW, minY: m.y - halfH, maxX: m.x + halfW, maxY: m.y + halfH };

    const params = resolveSymmetryParams(layer.symmetryParams);
    const key = `${bounds.minX}|${bounds.minY}|${bounds.maxX}|${bounds.maxY}|${params.voronoiCells}|${params.voronoiSeed}`;
    let needsRedraw = node.voronoiKey !== key;
    if (needsRedraw) {
      node.voronoiCells = getVoronoiCells(bounds, params.voronoiCells, params.voronoiSeed);
      node.voronoiKey = key;
    }
    const cells = node.voronoiCells;

    while (node.shards.length < cells.length) {
      const wrapper = new Container();
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      const maskG = new Graphics();
      wrapper.addChild(sprite, maskG);
      sprite.mask = maskG;
      node.shards.push({ wrapper, sprite, maskG });
      node.container.addChild(wrapper);
      needsRedraw = true;
    }
    while (node.shards.length > cells.length) {
      node.shards.pop()!.wrapper.destroy({ children: true });
    }

    const jitter = params.voronoiPhaseVariation * 30;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const shard = node.shards[i];
      const angle = cell.phase * Math.PI * 2;
      const dx = Math.cos(angle) * jitter * cell.phase;
      const dy = Math.sin(angle) * jitter * cell.phase;

      shard.wrapper.position.set(dx, dy);
      shard.wrapper.alpha = clamp01(m.opacity);
      shard.wrapper.blendMode = toBlendMode(m.blendMode);
      if (needsRedraw) {
        shard.maskG.clear().poly(cell.points, true).fill(0xffffff);
      }
      shard.sprite.texture = texture;
      shard.sprite.position.set(m.x, m.y);
      shard.sprite.rotation = m.rotation * DEG;
      shard.sprite.scale.set(m.scaleX, m.scaleY);
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
      if (idx >= 0) {
        const textures = this.getGifTextures(polygon.gifData);
        texture = textures[Math.min(idx, textures.length - 1)] ?? null;
      }
    }
    if (!texture && polygon.src) texture = this.getStaticTexture(polygon.src);

    const points = getDeformedPoints(polygon, t);
    // Vertex noise makes `points` a fresh array every frame even when the
    // source `polygon.points` reference hasn't changed, so the reference
    // check alone can't detect it — force a redraw every frame while it's
    // actively animating (Canvas 2D redraws every frame regardless, so this
    // only affects the cached-geometry Pixi path).
    const isAnimatingVertices = !!polygon.vertexNoise && polygon.vertexNoise.type !== 'none';
    const shapeChanged = isAnimatingVertices || node.pointsRef !== polygon.points;
    const fillColor = polygon.fillColor || '#6366f1';

    if ((polygon.symmetry ?? 'none') === 'voronoi') {
      this.syncPolygonVoronoi(node, polygon, points, texture, t, shapeChanged);
      while (node.instances.length > 0) node.instances.pop()!.wrapper.destroy({ children: true });
      node.pointsRef = polygon.points;
      node.fillColor = fillColor;
      node.strokeColor = polygon.strokeColor;
      node.strokeWidth = polygon.strokeWidth;
      return;
    }
    while (node.voronoiShards.length > 0) node.voronoiShards.pop()!.outer.destroy({ children: true });

    let geometryChanged = shapeChanged;
    let styleChanged = geometryChanged || node.fillColor !== fillColor;
    let strokeChanged = geometryChanged || node.strokeColor !== polygon.strokeColor || node.strokeWidth !== polygon.strokeWidth;

    const transforms = getPolygonSymmetryTransforms(polygon);
    while (node.instances.length < transforms.length) {
      const inst = this.createPolygonInstanceNode();
      node.instances.push(inst);
      node.container.addChild(inst.wrapper);
      // A freshly created instance's Graphics are empty regardless of
      // whether the polygon's own data changed this frame — force its
      // first draw.
      geometryChanged = true;
      styleChanged = true;
      strokeChanged = true;
    }
    while (node.instances.length > transforms.length) {
      node.instances.pop()!.wrapper.destroy({ children: true });
    }

    const origin = resolveSymmetryParams(polygon.symmetryParams);
    const scaleVal = Math.max(0.01, applyMotion(polygon.textureScale ?? 1, polygon.motionTextureScale, t));
    const rotationVal = applyMotion(polygon.textureRotation ?? 0, polygon.motionTextureRotation, t);
    const offsetX = applyMotion(polygon.textureOffsetX ?? 0, polygon.motionTextureOffsetX, t);
    const offsetY = applyMotion(polygon.textureOffsetY ?? 0, polygon.motionTextureOffsetY, t);
    const hasStroke = polygon.strokeWidth > 0 && !!polygon.strokeColor && polygon.strokeColor !== 'transparent';

    for (let i = 0; i < transforms.length; i++) {
      const tr = transforms[i];
      const inst = node.instances[i];

      // Rigid transform around the symmetry origin — pivot and position at
      // the same point cancel translation, leaving only rotate/mirror/scale
      // around it, matching the Canvas 2D wrapping transform exactly.
      inst.wrapper.pivot.set(origin.originX, origin.originY);
      inst.wrapper.position.set(origin.originX, origin.originY);
      inst.wrapper.rotation = tr.rotationDeg * DEG;
      inst.wrapper.scale.set((tr.mirrorX ? -1 : 1) * tr.scaleMult, (tr.mirrorY ? -1 : 1) * tr.scaleMult);

      if (geometryChanged) {
        inst.maskG.clear().poly(points, true).fill(0xffffff);
      }

      if (texture) {
        inst.tiler.visible = true;
        inst.fillG.visible = false;
        inst.tiler.texture = texture;
        inst.tiler.tileScale.set(scaleVal, scaleVal);
        inst.tiler.tileRotation = rotationVal * DEG;
        inst.tiler.tilePosition.set(offsetX, offsetY);
      } else {
        inst.tiler.visible = false;
        inst.fillG.visible = true;
        if (styleChanged) {
          inst.fillG.clear().poly(points, true).fill(fillColor);
        }
      }

      if (strokeChanged) {
        inst.strokeG.clear();
        if (hasStroke) {
          inst.strokeG.poly(points, true).stroke({
            width: polygon.strokeWidth,
            color: polygon.strokeColor,
            join: 'round'
          });
        }
      }
    }

    node.pointsRef = polygon.points;
    node.fillColor = fillColor;
    node.strokeColor = polygon.strokeColor;
    node.strokeWidth = polygon.strokeWidth;
  }

  private createPolygonVoronoiShardNode(): PolygonVoronoiShardNode {
    // Two nested container masks: outer clips to the parent shape, inner
    // clips to this cell — Pixi composes nested masks through the render
    // pipeline automatically, so their intersection needs no polygon-
    // polygon boolean math (same idea as chaining two ctx.clip() calls).
    const outer = new Container();
    const parentMaskG = new Graphics();
    const inner = new Container();
    const cellMaskG = new Graphics();
    const tiler = new TilingSprite({ texture: Texture.EMPTY, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    tiler.position.set(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    const fillG = new Graphics();
    const strokeG = new Graphics();

    inner.addChild(tiler, fillG, strokeG, cellMaskG);
    inner.mask = cellMaskG;
    outer.addChild(parentMaskG, inner);
    outer.mask = parentMaskG;

    return { outer, parentMaskG, inner, cellMaskG, tiler, fillG, strokeG };
  }

  /**
   * Voronoi is a subdivision/masking effect, not a repeat-and-transform
   * one, so it bypasses getPolygonSymmetryTransforms entirely: each shard
   * is its own two-level-masked node (parent shape ∩ cell), textured with
   * the same pattern at a small deterministic per-cell phase offset.
   */
  private syncPolygonVoronoi(
    node: PolygonNode,
    polygon: PolygonLayer,
    points: PolygonPoint[],
    texture: Texture | null,
    t: number,
    shapeChanged: boolean
  ) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const params = resolveSymmetryParams(polygon.symmetryParams);
    const key = `${minX}|${minY}|${maxX}|${maxY}|${params.voronoiCells}|${params.voronoiSeed}`;
    let cellsChanged = node.voronoiKey !== key;
    if (cellsChanged) {
      node.voronoiCells = getVoronoiCells({ minX, minY, maxX, maxY }, params.voronoiCells, params.voronoiSeed);
      node.voronoiKey = key;
    }
    const cells = node.voronoiCells;

    while (node.voronoiShards.length < cells.length) {
      const shard = this.createPolygonVoronoiShardNode();
      node.voronoiShards.push(shard);
      node.container.addChild(shard.outer);
      cellsChanged = true;
    }
    while (node.voronoiShards.length > cells.length) {
      node.voronoiShards.pop()!.outer.destroy({ children: true });
    }

    const shapeNeedsRedraw = shapeChanged || cellsChanged;
    const scaleVal = Math.max(0.01, applyMotion(polygon.textureScale ?? 1, polygon.motionTextureScale, t));
    const rotationVal = applyMotion(polygon.textureRotation ?? 0, polygon.motionTextureRotation, t);
    const baseOffsetX = applyMotion(polygon.textureOffsetX ?? 0, polygon.motionTextureOffsetX, t);
    const baseOffsetY = applyMotion(polygon.textureOffsetY ?? 0, polygon.motionTextureOffsetY, t);
    const fillColor = polygon.fillColor || '#6366f1';
    const hasStroke = polygon.strokeWidth > 0 && !!polygon.strokeColor && polygon.strokeColor !== 'transparent';
    const spread = 400 * params.voronoiPhaseVariation;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const shard = node.voronoiShards[i];

      if (shapeNeedsRedraw) {
        shard.parentMaskG.clear().poly(points, true).fill(0xffffff);
      }
      if (cellsChanged) {
        shard.cellMaskG.clear().poly(cell.points, true).fill(0xffffff);
      }

      if (texture) {
        shard.tiler.visible = true;
        shard.fillG.visible = false;
        shard.tiler.texture = texture;
        shard.tiler.tileScale.set(scaleVal, scaleVal);
        shard.tiler.tileRotation = rotationVal * DEG;
        const phaseX = (cell.phase - 0.5) * spread;
        const phaseY = (((cell.phase * 7.3) % 1) - 0.5) * spread;
        shard.tiler.tilePosition.set(baseOffsetX + phaseX, baseOffsetY + phaseY);
      } else {
        shard.tiler.visible = false;
        shard.fillG.visible = true;
        if (cellsChanged) {
          shard.fillG.clear().poly(cell.points, true).fill(fillColor);
        }
      }

      if (cellsChanged) {
        shard.strokeG.clear();
        if (hasStroke) {
          shard.strokeG.poly(cell.points, true).stroke({
            width: polygon.strokeWidth,
            color: polygon.strokeColor,
            join: 'round'
          });
        }
      }
    }
  }

  // ----------------------------------------------------------------- textures

  private getGifTextures(gif: GifData): Texture[] {
    let arr = this.gifTextures.get(gif);
    if (!arr) {
      arr = gif.frames.map(
        (f) => new Texture({ source: new ImageSource({ resource: f.image as ImageBitmap, autoGarbageCollect: false }) })
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
    const tex = new Texture({ source: new ImageSource({ resource: img, autoGarbageCollect: false }) });
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
    for (const asset of state.gifVoronoiAssets) {
      gifs.add(asset.gifData);
      if (asset.src) srcs.add(asset.src);
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
