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
    drawImage: (...args: unknown[]) => {
      const image = args[0];
      if (image instanceof RecordingCanvas && !image.context.clip.mock.calls.length && args.length === 5 && args[1] === 0 && args[2] === 0) this.draws.push(...image.draws.map(draw => [...draw]));
      else this.draws.push(args);
    }, globalAlpha: 1
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
  expect(deposits(layerOf(renderer.canvas as unknown as RecordingCanvas))).toEqual(deposits(layerOf(fresh.canvas as unknown as RecordingCanvas)));
});
it('rebuilds fading strokes and removes expired stamps', () => {
  const { renderer, doc, canvases } = setup({ lifetime: 1 });
  renderer.render(doc, 0, 1080, 1920);
  expect(canvases[1].draws.length).toBeGreaterThan(0);
  renderer.render(doc, 2, 1080, 1920);
  expect(canvases[1].draws).toEqual([]);
});
it('invalidates edited strokes and retains a bounded undo checkpoint', () => {
  const { renderer, doc, canvases, stroke } = setup();
  renderer.render(doc, 0, 1080, 1920);
  renderer.render({ ...doc, strokes: [{ ...stroke, pattern: 'stripes' }] }, 0, 1080, 1920);
  expect(renderer.checkpointPixels).toBeGreaterThan(0);
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
  expect(renderer.checkpointPixels).toBeGreaterThan(0);
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
  renderer.render({ ...doc, assets: doc.assets.map(a => ({ ...a, gifData: { ...a.gifData } })) }, 0, 1080, 1920);
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

it.each([0, 1.5])('reconstructs autopaint identically across seeks with lifetime %s and retains one accumulation canvas', async lifetime => {
  const { DEFAULT_AUTOPAINT } = await import('./autopaint');
  const { renderer, doc, canvases } = setup();
  doc.strokes = [];
  doc.autopaint = { ...DEFAULT_AUTOPAINT, enabled: true, brush: { ...DEFAULT_PAINT_SETTINGS, lifetime } };
  for (const time of [0, 0.1, 0.5, 1.3, 2.3, 5]) renderer.render(doc, time, 270, 480);
  const builds = renderer.stats.historyRebuilds;
  const direct = new PaintRenderer(); direct.render(doc, 5, 270, 480);
  expect(deposits(layerOf(renderer.canvas as unknown as RecordingCanvas))).toEqual(deposits(layerOf(direct.canvas as unknown as RecordingCanvas)));
  renderer.render(doc, 5.1, 270, 480);
  expect(renderer.stats.historyRebuilds).toBe(builds);
  expect(renderer.cachedPixels).toBe(270 * 480);
  renderer.render(doc, 0.5, 270, 480);
  direct.render(doc, 0.5, 270, 480);
  expect(deposits(layerOf(renderer.canvas as unknown as RecordingCanvas))).toEqual(deposits(layerOf(direct.canvas as unknown as RecordingCanvas)));
  renderer.render({ ...doc, autopaint: { ...doc.autopaint, enabled: false } }, 1, 270, 480);
  expect((renderer.canvas as unknown as RecordingCanvas).draws).toEqual([]);
  expect(renderer.cachedPixels).toBe(0);
  expect(renderer.stampCachePixels).toBe(0);
  renderer.destroy(); direct.destroy();
  expect(canvases.every(c => c.width === 0 && c.height === 0)).toBe(true);
});

it.each([32, 128, 255])('appends to %i static strokes by drawing only the new dabs', count => {
  const { renderer, doc, stroke } = setup({ opacity: 0.4, scatter: 0.7 });
  doc.strokes = Array.from({ length: count }, (_, i) => ({ ...stroke, id: String(i) }));
  renderer.render(doc, 2, 1080, 1920);
  const layer = layerOf(renderer.canvas as unknown as RecordingCanvas);
  const before = { ...renderer.stats };
  const appended = { ...stroke, id: 'append' };
  const next = { ...doc, strokes: [...doc.strokes, appended] };
  renderer.render(next, 2, 1080, 1920);
  expect(layerOf(renderer.canvas as unknown as RecordingCanvas)).toBe(layer);
  expect(renderer.stats.historyRebuilds).toBe(before.historyRebuilds);
  expect(renderer.stats.stampDraws - before.stampDraws).toBe(buildPaintDabs(appended).length);
  const fresh = new PaintRenderer(); fresh.render(next, 2, 1080, 1920);
  expect(deposits(layer)).toEqual(deposits(layerOf(fresh.canvas as unknown as RecordingCanvas)));
  renderer.render(doc, 2, 1080, 1920);
  expect(renderer.checkpointPixels).toBeGreaterThan(0);
  expect(layerOf(renderer.canvas as unknown as RecordingCanvas).draws).toHaveLength(count * buildPaintDabs(stroke).length);
});

it('copies static pixels only when append expands the cropped bounds', () => {
  const { renderer, doc, stroke } = setup();
  renderer.render(doc, 0, 1080, 1920);
  const old = layerOf(renderer.canvas as unknown as RecordingCanvas);
  const before = { ...renderer.stats };
  const added = { ...stroke, id: 'expanded', points: [{ x: -400, y: -800, time: 0 }] };
  renderer.render({ ...doc, strokes: [...doc.strokes, added] }, 0, 1080, 1920);
  const expanded = layerOf(renderer.canvas as unknown as RecordingCanvas);
  expect(expanded).not.toBe(old);
  expect(expanded.draws[0][0]).toBe(old);
  expect(old.width).toBe(0);
  expect(renderer.stats.stampDraws - before.stampDraws).toBe(1);
  expect(renderer.stats.historyRebuilds).toBe(before.historyRebuilds);
});

it.each([0, 0.4])('retains a draft surface and matches original frames with lifetime %s', lifetime => {
  const { renderer, doc, stroke, canvases } = setup({ lifetime, opacity: 0.4, scatter: 0.7, gifSpeed: 1.7, sourceOffset: 0.2 });
  doc.strokes = [];
  const points = [{ x: 0, y: 0, time: 0 }, { x: 77, y: 11, time: 0.2 },
    { x: 77, y: 11, time: 0.7 }, { x: -50, y: 100, time: 1 }];
  stroke.points = [];
  for (const point of points) {
    stroke.points.push(point);
    const before = renderer.stats.stampDraws;
    const oldCount = buildPaintDabs({ ...stroke, points: stroke.points.slice(0, -1) }).length;
    renderer.render(doc, 10, 270, 480, stroke);
    const draft = layerOf(renderer.canvas as unknown as RecordingCanvas);
    if (lifetime === 0) expect(renderer.stats.stampDraws - before).toBe(buildPaintDabs(stroke).length - oldCount);
    const reference = new PaintRenderer();
    reference.render({ ...doc, strokes: [{ ...stroke, replay: false }] }, 0, 270, 480);
    // Raster caches have different origins; compare source-frame order here.
    expect(deposits(draft).map(d => d[0])).toEqual(deposits(layerOf(reference.canvas as unknown as RecordingCanvas)).map(d => d[0]));
    reference.destroy();
    const stats = { ...renderer.stats }, revision = renderer.revision;
    renderer.render(doc, 20, 270, 480, stroke);
    expect(renderer.stats).toEqual(stats);
    expect(renderer.revision).toBe(revision);
  }
  const draft = layerOf(renderer.canvas as unknown as RecordingCanvas);
  renderer.render(doc, 20, 270, 480);
  expect(draft.width).toBe(0);
  expect((renderer.canvas as unknown as RecordingCanvas).draws).toEqual([]);
  renderer.destroy();
  expect(canvases.every(c => c.width === 0)).toBe(true);
});

it('skips samples that add no dab and resets the draft for replacement, resize and source changes', () => {
  const { renderer, doc, stroke } = setup({ points: [{ x: 0, y: 0, time: 0 }] });
  doc.strokes = [];
  renderer.render(doc, 0, 270, 480, stroke);
  const before = { ...renderer.stats };
  stroke.points.push({ x: 1, y: 0, time: 0.01 });
  renderer.render(doc, 1, 270, 480, stroke);
  expect(renderer.stats).toEqual(before);
  const changes: [PaintStroke, number, PaintDocument['assets']][] = [[{ ...stroke }, 270, doc.assets], [stroke, 540, doc.assets], [stroke, 540, doc.assets.map(a => ({ ...a, gifData: { ...a.gifData } }))]];
  for (const [draft, width, assets] of changes) {
    const old = layerOf(renderer.canvas as unknown as RecordingCanvas);
    renderer.render({ ...doc, assets }, 1, width, 480, draft);
    expect(old.width).toBe(0);
    expect(layerOf(renderer.canvas as unknown as RecordingCanvas).width).toBe(width);
  }
});

it('extends the top static run above active paint without rebuilding other groups', () => {
  const { renderer, doc, stroke } = setup();
  const active = { ...stroke, id: 'active', replay: true };
  const top = { ...stroke, id: 'top' };
  doc.strokes = [stroke, active, top];
  renderer.render(doc, 1, 270, 480);
  const layers = (renderer.canvas as unknown as RecordingCanvas).draws.map(d => d[0]);
  const before = { ...renderer.stats };
  const appended = { ...stroke, id: 'appended', opacity: 0.4 };
  renderer.render({ ...doc, strokes: [...doc.strokes, appended] }, 1, 270, 480);
  expect((renderer.canvas as unknown as RecordingCanvas).draws.map(d => d[0])).toEqual(layers);
  expect(renderer.stats.stampDraws - before.stampDraws).toBe(buildPaintDabs(appended).length);
  expect(renderer.stats.historyRebuilds).toBe(before.historyRebuilds);
});

it('preserves constant-speed draft frame timing on each new sample and skips unchanged samples', () => {
  const { renderer, doc, stroke } = setup({ constantSpeed: true });
  doc.strokes = [];
  stroke.points = [{ x: 0, y: 0, time: 0 }];
  for (const point of [{ x: 100, y: 0, time: 0.1 }, { x: 100, y: 0, time: 0.7 }, { x: -50, y: 0, time: 1.9 }]) {
    stroke.points.push(point);
    renderer.render(doc, 0, 270, 480, stroke);
    const fresh = new PaintRenderer(); fresh.render(doc, 0, 270, 480, { ...stroke });
    expect(deposits(layerOf(renderer.canvas as unknown as RecordingCanvas))).toEqual(deposits(layerOf(fresh.canvas as unknown as RecordingCanvas)));
    fresh.destroy();
    const before = { ...renderer.stats };
    renderer.render(doc, 10, 270, 480, stroke);
    expect(renderer.stats).toEqual(before);
  }
});

it('does work proportional to new deposits throughout a dense gesture', () => {
  const { renderer, doc, stroke } = setup({ size: 24, spacing: 0.1 });
  doc.strokes = [];
  stroke.points = [];
  for (let i = 0; i <= 1000; i++) {
    stroke.points.push({ x: Math.sin(i / 10) * 400, y: Math.cos(i / 10) * 800, time: i / 30 });
    renderer.render(doc, 0, 270, 480, stroke);
  }
  expect(renderer.stats.stampDraws).toBe(buildPaintDabs(stroke).length);
  const before = { ...renderer.stats };
  for (let i = 0; i < 30; i++) renderer.render(doc, i, 270, 480, stroke);
  expect(renderer.stats).toEqual(before);
});

it('invalidates only groups using replaced/removed/previously missing sources', () => {
  const { renderer, doc, stroke } = setup();
  const other = { ...doc.assets[0], id: 'other' };
  doc.assets = [...doc.assets, other];
  doc.strokes = [stroke, { ...stroke, id: 'active', assetId: 'other', replay: true }];
  renderer.render(doc, 1, 270, 480);
  const before = { ...renderer.stats };
  const layers = (renderer.canvas as unknown as RecordingCanvas).draws.map(d => d[0]);
  renderer.render({ ...doc, assets: [...doc.assets, { ...other, id: 'unused' }] }, 1, 270, 480);
  expect(renderer.stats).toEqual(before);
  renderer.render({ ...doc, assets: [doc.assets[0], { ...other, gifData: { ...other.gifData } }] }, 1, 270, 480);
  expect(renderer.stats.historyRebuilds - before.historyRebuilds).toBe(1);
  expect((renderer.canvas as unknown as RecordingCanvas).draws[0][0]).toBe(layers[0]);
  renderer.render({ ...doc, assets: [] }, 1, 270, 480);
  const missing = renderer.stats.historyRebuilds;
  renderer.render(doc, 1, 270, 480);
  expect(renderer.stats.historyRebuilds - missing).toBe(2);
});

it('reuses sampled geometry across group splits, merges, opacity edits and undo', () => {
  const { renderer, doc, stroke } = setup();
  const top = { ...stroke, id: 'top' };
  doc.strokes = [stroke, top];
  renderer.render(doc, 0, 270, 480);
  const before = renderer.stats.geometryBuilds;
  renderer.render({ ...doc, strokes: [stroke, { ...top, replay: true }] }, 1, 270, 480);
  renderer.render({ ...doc, strokes: [{ ...stroke, opacity: 0.1 }, top] }, 1, 270, 480);
  renderer.render(doc, 1, 270, 480);
  expect(renderer.stats.geometryBuilds).toBe(before);
  expect(renderer.stats.checkpointHits).toBeGreaterThan(0);
  const builds = renderer.stats.groupBuilds;
  renderer.render(doc, 2, 270, 480);
  expect(renderer.stats.groupBuilds).toBe(builds);
});

it('restores replay checkpoints without re-depositing history and bounds retained pixels', () => {
  const { renderer, doc, stroke } = setup({ replay: true });
  renderer.render(doc, 5, 270, 480);
  renderer.render(doc, 12, 270, 480);
  const before = renderer.stats.stampDraws;
  renderer.render(doc, 5.1, 270, 480);
  expect(renderer.stats.checkpointHits).toBeGreaterThan(0);
  expect(renderer.stats.stampDraws - before).toBe([...replayStamps(stroke, buildPaintDabs(stroke), 5, 5.1)].length);
  for (let i = 0; i < 40; i++) renderer.render({ ...doc, strokes: [{ ...stroke, opacity: i / 40 }] }, 1, 1080, 1920);
  expect(renderer.checkpointPixels).toBeLessThanOrEqual(12 * 1024 * 1024);
  renderer.destroy();
  expect(renderer.checkpointPixels).toBe(0);
});

it('keeps drafts and published generations responsive while cancelling obsolete reconstruction', async () => {
  const { PaintPreviewRenderer } = await import('./preview');
  const { doc, stroke, canvases } = setup({ replay: true, size: 24, spacing: 0.1 });
  const preview = new PaintPreviewRenderer();
  const finish = (painting: PaintDocument, time: number) => {
    preview.render(painting, time, 270, 480, null, 0);
    let batches = 0;
    while (preview.rebuilding && batches++ < 10000) preview.render(painting, time, 270, 480, null, 0);
    expect(preview.rebuilding).toBe(false);
  };
  finish(doc, 0);
  const published = preview.painter.revision;
  preview.render(doc, 1800, 270, 480, null, 0);
  expect(preview.rebuilding).toBe(true);
  const draft = { ...stroke, replay: false, points: [{ x: 1, y: 1, time: 0 }] };
  preview.render(doc, 1800, 270, 480, draft, 0);
  expect(preview.painter.revision).toBe(published);
  expect((preview.canvas as unknown as RecordingCanvas).draws.at(-1)?.[0]).toBeDefined();
  const latest = { ...doc, strokes: [{ ...stroke, opacity: 0.2 }] };
  finish(latest, 0.1);
  const exact = new PaintRenderer(); exact.render(latest, 0.1, 270, 480);
  expect(deposits(layerOf(preview.painter.canvas as unknown as RecordingCanvas))).toEqual(deposits(layerOf(exact.canvas as unknown as RecordingCanvas)));
  preview.render(latest, 1800, 270, 480, null, 0);
  preview.destroy(); exact.destroy();
  expect(canvases.every(c => c.width === 0)).toBe(true);
});
