import { afterEach, expect, it, vi } from 'vitest';
import type { PaintDocument, PaintStroke } from './model';
import { buildPaintDabs, DEFAULT_PAINT_SETTINGS, replayStamps } from './model';
import { PaintRenderer } from './renderer';

// A recording canvas checks actual raster operations and selected source frames,
// independently of browser GPU availability. Pixel fidelity is also smoke-tested in-browser.
class RecordingCanvas {
  width = 0; height = 0;
  draws: unknown[][] = [];
  context = {
    setTransform: vi.fn(), clearRect: vi.fn(() => { this.draws = []; }), save: vi.fn(), restore: vi.fn(),
    translate: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), rect: vi.fn(), moveTo: vi.fn(), clip: vi.fn(),
    drawImage: (...args: unknown[]) => { this.draws.push(args); }, globalAlpha: 1
  };
  getContext() { return this.context; }
}
const deposits = (canvas: RecordingCanvas) => canvas.draws.map(([image, ...args]) => [
  image instanceof RecordingCanvas ? image.draws[0]?.[0] : image, ...args
]);
const layerOf = (canvas: RecordingCanvas) => canvas.draws[0][0] as RecordingCanvas;
const sources = [{ frame: 'red' }, { frame: 'blue' }];
function setup(patch: Partial<PaintStroke> = {}) {
  const canvases: RecordingCanvas[] = [];
  vi.stubGlobal('Path2D', class { arc = vi.fn(); rect = vi.fn(); moveTo = vi.fn(); });
  vi.stubGlobal('document', { createElement: () => { const canvas = new RecordingCanvas(); canvases.push(canvas); return canvas; } });
  const stroke: PaintStroke = { ...DEFAULT_PAINT_SETTINGS, id: 's', name: 'Stroke', assetId: 'gif', sourceOffset: 0, seed: 1, hidden: false,
    points: [{ x: 0, y: 0, time: 0 }, { x: 100, y: 0, time: 1 }], ...patch };
  const doc: PaintDocument = { strokes: [stroke], assets: [{ id: 'gif', name: 'test.gif', src: '', gifData: {
    width: 100, height: 50, totalDurationMs: 1000, frames: sources.map((image, i) => ({ image: image as unknown as CanvasImageSource,
      delayMs: 500, startTimeMs: i * 500, endTimeMs: (i + 1) * 500 }))
  } }] };
  return { canvases, stroke, doc, renderer: new PaintRenderer() };
}
afterEach(() => vi.unstubAllGlobals());
it('accumulates frozen source frames without repainting or allocating layers on every tick', () => {
  const { renderer, doc, canvases } = setup();
  renderer.render(doc, 0, 1080, 1920);
  const first = deposits(canvases[1]);
  expect(first.some(draw => draw[0] === sources[0])).toBe(true);
  expect(first.some(draw => draw[0] === sources[1])).toBe(true);
  renderer.render(doc, 10, 1080, 1920);
  expect(canvases.filter(c => c.context.clip.mock.calls.length === 0)).toHaveLength(2);
  expect(deposits(canvases[1])).toEqual(first);
});
it('direct seek and sequential replay deposit the same frames and geometry', () => {
  const { renderer, doc, canvases } = setup({ replay: true, direction: 'ping-pong', delay: 0.3 });
  renderer.render(doc, 0, 1080, 1920);
  renderer.render(doc, 0.5, 1080, 1920);
  renderer.render(doc, 2, 1080, 1920);
  const incremental = deposits(canvases[1]);
  const fresh = new PaintRenderer();
  fresh.render(doc, 2, 1080, 1920);
  expect(deposits(layerOf(fresh.canvas as unknown as RecordingCanvas))).toEqual(incremental);
  renderer.render(doc, 0.5, 1080, 1920);
  fresh.render(doc, 0.5, 1080, 1920);
  expect(deposits(canvases[1])).toEqual(deposits(layerOf(fresh.canvas as unknown as RecordingCanvas)));
});
it('rebuilds fading strokes and removes expired stamps', () => {
  const { renderer, doc, canvases } = setup({ lifetime: 1 });
  renderer.render(doc, 0, 1080, 1920);
  expect(canvases[1].draws.length).toBeGreaterThan(0);
  renderer.render(doc, 2, 1080, 1920);
  expect(canvases[1].draws).toEqual([]);
});
it('invalidates edited strokes and releases their old canvas stores', () => {
  const { renderer, doc, canvases, stroke } = setup();
  renderer.render(doc, 0, 1080, 1920);
  renderer.render({ ...doc, strokes: [{ ...stroke, pattern: 'stripes' }] }, 0, 1080, 1920);
  expect(canvases[1].width).toBe(0);
  expect(canvases[2].context.clip).toHaveBeenCalled();
  renderer.destroy();
  expect(canvases.every(c => c.width === 0 && c.height === 0)).toBe(true);
});
it.each([8, 9, 16, 32])('flattens %i static paths and performs no warm raster work', count => {
  const { renderer, doc, canvases, stroke } = setup();
  doc.strokes = Array.from({ length: count }, (_, i) => ({ ...stroke, id: String(i) }));
  renderer.render(doc, 60, 1080, 1920);
  const before = { ...renderer.stats };
  const revision = renderer.revision;
  for (let i = 1; i <= 120; i++) renderer.render(doc, 60 + i / 60, 1080, 1920);
  expect(renderer.stats).toEqual(before);
  expect(renderer.revision).toBe(revision);
  expect(canvases.filter(c => c.context.clip.mock.calls.length === 0)).toHaveLength(2);
  expect(renderer.cachedPixels).toBeLessThan(1080 * 1920);
});
it.each([8, 9, 16, 32])('advances %i active paths without eviction or history reconstruction', count => {
  const { renderer, doc, stroke } = setup({ replay: true });
  doc.strokes = Array.from({ length: count }, (_, i) => ({ ...stroke, id: String(i) }));
  renderer.render(doc, 60, 1080, 1920);
  const before = { ...renderer.stats };
  for (let i = 1; i <= 120; i++) renderer.render(doc, 60 + i / 60, 1080, 1920);
  const expected = [...replayStamps(stroke, buildPaintDabs(stroke), 60, 62)].length * count;
  expect(renderer.stats.stampDraws - before.stampDraws).toBe(expected);
  expect(renderer.stats.historyRebuilds).toBe(before.historyRebuilds);
  expect(renderer.cachedPixels).toBeLessThan(count * 1080 * 1920 / 4);
});
it('keeps static runs between active brushes in stack order and invalidates on reorder/hide/undo', () => {
  const { renderer, doc, stroke, canvases } = setup();
  const active = { ...stroke, id: 'active', replay: true };
  const upper = { ...stroke, id: 'upper', opacity: 0.4 };
  doc.strokes = [stroke, active, upper];
  renderer.render(doc, 1, 1080, 1920);
  const layers = canvases[0].draws.map(d => d[0] as RecordingCanvas);
  expect(layers).toHaveLength(3);
  const before = renderer.stats.historyRebuilds;
  renderer.render(doc, 2, 1080, 1920);
  expect(renderer.stats.historyRebuilds).toBe(before);
  renderer.render({ ...doc, strokes: [upper, active, stroke] }, 2, 1080, 1920);
  expect(canvases[0].draws.map(d => d[0])).toEqual([...layers].reverse());
  renderer.render({ ...doc, strokes: [stroke, { ...active, hidden: true }, upper] }, 2, 1080, 1920);
  expect(canvases[0].draws).toHaveLength(1);
  expect(layers.every(c => c.width === 0)).toBe(true);
  renderer.render(doc, 2, 1080, 1920);
  expect(canvases[0].draws).toHaveLength(3);
});
it('reconstructs fading trails exactly while retaining only the live window', () => {
  const { renderer, doc, canvases } = setup({ replay: true, lifetime: 0.5, opacity: 0.3 });
  renderer.render(doc, 60, 1080, 1920);
  const builds = renderer.stats.historyRebuilds;
  for (let i = 1; i <= 60; i++) renderer.render(doc, 60 + i / 60, 1080, 1920);
  expect(renderer.stats.historyRebuilds).toBe(builds);
  const expected = new PaintRenderer();
  expected.render(doc, 61, 1080, 1920);
  expect(deposits(canvases[1])).toEqual(deposits(layerOf(expected.canvas as unknown as RecordingCanvas)));
  expect(canvases[1].draws.length).toBeLessThanOrEqual(17);
});
it('releases invalid caches for source replacement, resize, empty documents and destruction', () => {
  const { renderer, doc, canvases } = setup();
  renderer.render(doc, 0, 1080, 1920);
  renderer.render({ ...doc, assets: [...doc.assets] }, 0, 1080, 1920);
  expect(canvases[1].width).toBe(0);
  renderer.render(doc, 0, 540, 960);
  expect(canvases[2].width).toBe(0);
  renderer.render({ ...doc, strokes: [] }, 0, 540, 960);
  expect(canvases[0].draws).toEqual([]);
  renderer.destroy();
  expect(canvases.every(c => c.width === 0 && c.height === 0)).toBe(true);
});
it('matches direct reconstruction with dense fractional-time input', () => {
  const { renderer, doc, canvases } = setup({ replay: true, points: Array.from({ length: 31 }, (_, j) => ({ x: j * 3, y: j * 4, time: j / 30 })) });
  for (const time of [0, 0.2, 0.5, 1.7]) renderer.render(doc, time, 270, 480);
  const direct = new PaintRenderer(); direct.render(doc, 1.7, 270, 480);
  expect(deposits(canvases[1])).toEqual(deposits(layerOf(direct.canvas as unknown as RecordingCanvas)));
  expect(renderer.stats.stampDraws).toBe(direct.stats.stampDraws);
});

it('evicts only small stamp images under pressure, never accumulated paint history', () => {
  const { renderer, doc, stroke } = setup({ replay: true, size: 600 });
  doc.strokes = Array.from({ length: 32 }, (_, i) => ({ ...stroke, id: String(i), rotation: i }));
  renderer.render(doc, 60, 1080, 1920);
  const before = { ...renderer.stats };
  renderer.render(doc, 61.1, 1080, 1920);
  expect(renderer.stats.stampBuilds).toBeGreaterThan(before.stampBuilds);
  expect(renderer.stats.historyRebuilds).toBe(before.historyRebuilds);
  expect(renderer.stats.stampDraws - before.stampDraws).toBe([...replayStamps(stroke, buildPaintDabs(stroke), 60, 61.1)].length * 32);
  expect(renderer.stampCachePixels).toBeLessThanOrEqual(4 * 1024 * 1024);
});
it('shares masked GIF frames across matching brushes and releases them after the last owner disappears', () => {
  const { renderer, doc, stroke } = setup({ replay: true });
  doc.strokes = Array.from({ length: 32 }, (_, i) => ({ ...stroke, id: String(i), opacity: 0.2 + i / 100 }));
  renderer.render(doc, 60, 1080, 1920);
  expect(renderer.stats.stampBuilds).toBe(2);
  renderer.render(doc, 61, 1080, 1920);
  expect(renderer.stats.stampBuilds).toBe(2);
  renderer.render({ ...doc, strokes: doc.strokes.slice(0, 1) }, 62, 1080, 1920);
  expect(renderer.stats.stampBuilds).toBe(2);
  expect(renderer.stampCachePixels).toBeGreaterThan(0);
  renderer.render({ ...doc, strokes: [] }, 62, 1080, 1920);
  expect(renderer.stampCachePixels).toBe(0);
});

it('rebuilds a saved path with fewer deposits when stamp spacing increases', () => {
  const { renderer, doc, stroke } = setup();
  renderer.render(doc, 0, 1080, 1920);
  expect(renderer.stats.stampDraws).toBe(3);
  const before = renderer.stats.stampDraws;
  renderer.render({ ...doc, strokes: [{ ...stroke, spacing: 1 }] }, 0, 1080, 1920);
  expect(renderer.stats.stampDraws - before).toBe(1);
});
