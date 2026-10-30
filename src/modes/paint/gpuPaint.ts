import { Container, ImageSource, Sprite, Texture, type Renderer } from 'pixi.js';
import { GpuAutopaint } from './gpuAutopaint';
import { PaintPreviewRenderer } from './preview';
import { PaintRenderer } from './renderer';
import type { PaintDocument, PaintStroke } from './model';

class CanvasLayer {
  readonly sprite = new Sprite();
  private texture: Texture | null = null;
  private revision = -1;
  update(canvas: HTMLCanvasElement, revision: number) {
    if (this.texture && (this.texture.source.width !== canvas.width || this.texture.source.height !== canvas.height)) {
      this.sprite.texture = Texture.EMPTY; this.texture.destroy(true); this.texture = null;
    }
    if (!this.texture) {
      this.texture = new Texture({ source: new ImageSource({ resource: canvas, autoGarbageCollect: false }) });
      this.sprite.texture = this.texture; this.revision = -1;
    }
    if (this.revision !== revision) this.texture.source.update();
    this.revision = revision;
  }
  destroy() { this.sprite.destroy(); this.texture?.destroy(true); this.texture = null; }
}
const EMPTY_STROKES: PaintStroke[] = [];
/** Explicit opt-in prototype: saved reference paint, retained GPU autopaint,
 * then the independent reference draft. Preview/export never share sessions. */
export class GpuPaintRenderer {
  readonly container = new Container();
  readonly autopaint: GpuAutopaint;
  private painter: PaintRenderer | PaintPreviewRenderer;
  private base = new CanvasLayer();
  private draftLayer = new CanvasLayer();
  private draft: PaintRenderer | null = null;
  constructor(renderer: Renderer, private preview: boolean) {
    this.painter = preview ? new PaintPreviewRenderer() : new PaintRenderer();
    this.autopaint = new GpuAutopaint(renderer);
    this.container.addChild(this.base.sprite, this.autopaint.sprite, this.draftLayer.sprite);
  }
  render(doc: PaintDocument, time: number, width: number, height: number, draft?: PaintStroke | null) {
    const canvas = this.painter.render({ assets: doc.assets, strokes: doc.strokes }, time, width, height);
    this.base.update(canvas, this.painter.revision);
    this.autopaint.render(doc.autopaint, doc.assets, time, width, height, this.preview);
    this.draftLayer.sprite.visible = !!draft;
    if (draft) {
      this.draft ??= new PaintRenderer();
      const canvas = this.draft.render({ assets: doc.assets, strokes: EMPTY_STROKES }, 0, width, height, draft);
      this.draftLayer.update(canvas, this.draft.revision);
    } else if (this.draft) {
      this.draftLayer.destroy(); this.draft.destroy(); this.draft = null;
      this.draftLayer = new CanvasLayer(); this.container.addChild(this.draftLayer.sprite);
    }
    this.container.position.set(-540, -960);
    this.container.scale.set(1080 / width, 1920 / height);
  }
  destroy() {
    this.base.destroy(); this.draftLayer.destroy(); this.draft?.destroy(); this.draft = null;
    this.painter.destroy(); this.autopaint.destroy(); this.container.destroy();
  }
}
