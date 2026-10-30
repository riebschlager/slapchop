import type { PaintDocument, PaintStroke } from './model';
import { PaintRenderer } from './renderer';

const EMPTY_STROKES: PaintStroke[] = [];
/** Preview owns its reconstruction session. Each display tick advances bounded
 * batches, leaving a complete frame visible until the current generation ends.
 * Export sessions never consume these partially reconstructed surfaces. */
export class PaintPreviewRenderer {
  readonly canvas = document.createElement('canvas');
  readonly painter = new PaintRenderer();
  private draft: PaintRenderer | null = null;
  private work: Generator<void> | null = null;
  private target: { doc: PaintDocument; time: number; sources: PaintDocument['assets']; width: number; height: number } | null = null;
  private lastTime = 0;
  private baseRevision = -1;
  private draftRevision = -1;
  revision = 0;
  get rebuilding() { return this.work !== null; }

  render(doc: PaintDocument, time: number, width: number, height: number, draft?: PaintStroke | null, budgetMs = 3): HTMLCanvasElement {
    time = Math.max(0, time);
    const used = new Set(doc.strokes.filter(s => !s.hidden).map(s => s.assetId));
    const sources = doc.assets.filter(a => used.has(a.id) || (doc.autopaint?.enabled && !a.retired));
    const target = this.target;
    const invalid = target && (target.doc.strokes !== doc.strokes || target.doc.autopaint !== doc.autopaint
      || width !== target.width || height !== target.height || time < this.lastTime
      || sources.length !== target.sources.length || sources.some((a, i) => a.id !== target.sources[i].id || a.gifData !== target.sources[i].gifData));
    if (invalid && this.work) {
      this.work.return(undefined);
      this.work = null;
      this.painter.cancelRebuild();
    }
    this.lastTime = time;
    if (!this.work) {
      this.target = { doc, time, sources, width, height };
      this.work = this.painter.renderBatches(doc, time, width, height);
    }
    const deadline = performance.now() + budgetMs;
    // A batch is at most 128 stamp operations, 64 input points, or one group setup. Also cap
    // batch count for coarse/quantized timers and predictable cancellation tests.
    for (let batch = 0; batch < 512; batch++) {
      if (this.work.next().done) { this.work = null; break; }
      if (performance.now() >= deadline) break;
    }
    if (draft) {
      this.draft ??= new PaintRenderer();
      this.draft.render({ assets: doc.assets, strokes: EMPTY_STROKES }, 0, width, height, draft);
    } else {
      this.draft?.destroy(); this.draft = null;
    }
    const draftRevision = this.draft?.revision ?? -1;
    const resized = this.canvas.width !== width || this.canvas.height !== height;
    if (resized) { this.canvas.width = width; this.canvas.height = height; }
    if (resized || this.baseRevision !== this.painter.revision || this.draftRevision !== draftRevision) {
      const ctx = this.canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create the GIF Paint preview context.');
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(this.painter.canvas, 0, 0, width, height);
      if (this.draft) ctx.drawImage(this.draft.canvas, 0, 0);
      this.baseRevision = this.painter.revision;
      this.draftRevision = draftRevision;
      this.revision++;
    }
    return this.canvas;
  }
  destroy() {
    this.work?.return(undefined); this.work = null;
    this.painter.destroy(); this.draft?.destroy(); this.draft = null; this.target = null;
    this.canvas.width = 0; this.canvas.height = 0;
  }
}
