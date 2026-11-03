import { afterEach, expect, it, vi } from 'vitest';
import { restoreProjectDocument, saveProject } from '../../lib/project';
import { saveBlob } from '../../lib/native';
import { clearHistory, getDocumentSnapshot, redo, undo, useStore } from '../../store';
import { DEFAULT_PAINT_SETTINGS, type PaintStroke } from './model';
import { restorePaint } from './project';
import { createRingsResourceTracker } from '../rings/resources';

vi.mock('../../lib/native', () => ({ saveBlob: vi.fn() }));
const initial = getDocumentSnapshot();
const gifData = { width: 20, height: 40, totalDurationMs: 1000, frames: [] };
const source = { id: 'gif', name: 'paint.gif', src: 'blob:paint', gifData };
const stroke: PaintStroke = { ...DEFAULT_PAINT_SETTINGS, id: 's', name: 'First stroke', assetId: 'gif', hidden: false, sourceOffset: 0.25, seed: 42,
  points: [{ x: -100, y: -50, time: 0 }, { x: 100, y: 200, time: 1 }] };
const serialized = () => ({ version: 1, assets: [{ id: 'gif', name: 'paint.gif', assetId: 'embedded' }], strokes: [structuredClone(stroke)] });
const materialized = new Map([['embedded', { src: 'blob:restored', gifData }]]);
afterEach(() => { useStore.getState().loadDocument(initial); clearHistory(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('saves V14 with embedded sources, every stroke control, and original timing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['gif'], { type: 'image/gif' }) }));
  vi.stubGlobal('FileReader', class {
    result = 'data:image/gif;base64,Z2lm'; onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  const painted = { ...stroke, replay: true, pattern: 'bristle' as const, lifetime: 4, direction: 'ping-pong' as const,
    constantSpeed: true, imageZoom: 1.2, imageRotation: 30, phase: 0.4, speed: 0.5 };
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [painted] } });
  await saveProject();
  const payload = JSON.parse(await vi.mocked(saveBlob).mock.calls.at(-1)![0].text());
  expect(payload.version).toBe(14);
  expect(payload.paint.assets[0].src).toBeUndefined();
  const assetId = payload.paint.assets[0].assetId;
  expect(payload.assets[assetId].dataUrl).toBe('data:image/gif;base64,Z2lm');
  const restored = restoreProjectDocument(payload, new Map([[assetId, { src: 'blob:restored', gifData }]]));
  expect(restored.paint.strokes).toEqual([painted]);
  expect(restored.paint.assets[0]).toMatchObject({ src: 'blob:restored', gifData });
  expect(restored.grid).toEqual(initial.grid);
});
it('opens old projects with an empty painting', () => {
  const restored = restoreProjectDocument({ app: 'slapchop', version: 1, savedAt: '', canvasBg: '#000000', layers: [], polygonLayers: [], assets: {} });
  expect(restored.paint).toEqual({ assets: [], strokes: [] });
});
it('clears all saved strokes in one undo step while keeping current sources and tool settings', () => {
  const retired = { ...source, id: 'retired', retired: true };
  const strokes = [stroke, { ...stroke, id: 'active', assetId: retired.id, replay: true, hidden: true }];
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source, retired], strokes } });
  useStore.getState().selectPaintAsset(source.id);
  useStore.getState().selectPaintStroke('active');
  useStore.getState().updatePaintTool({ spacing: 0.8 });
  const tool = useStore.getState().paintTool;
  clearHistory();

  useStore.getState().clearPaintStrokes();
  expect(useStore.getState().paint).toEqual({ assets: [source], strokes: [] });
  expect(useStore.getState().selectedPaintStrokeId).toBeNull();
  expect(useStore.getState().paintAssetId).toBe(source.id);
  expect(useStore.getState().paintTool).toEqual(tool);
  expect(useStore.temporal.getState().pastStates).toHaveLength(1);
  useStore.getState().clearPaintStrokes();
  expect(useStore.temporal.getState().pastStates).toHaveLength(1);

  undo();
  expect(useStore.getState().paint).toEqual({ assets: [source, retired], strokes });
  redo();
  expect(useStore.getState().paint).toEqual({ assets: [source], strokes: [] });
});
it.each(['missing source', 'duplicate stroke', 'nonfinite', 'backwards time', 'oversized coordinates', 'too many points'])(
  'rejects invalid paint data: %s', problem => {
    const payload = serialized();
    if (problem === 'missing source') payload.strokes[0].assetId = 'missing';
    if (problem === 'duplicate stroke') payload.strokes.push(payload.strokes[0]);
    if (problem === 'nonfinite') payload.strokes[0].points[0].x = NaN;
    if (problem === 'backwards time') payload.strokes[0].points[1].time = -1;
    if (problem === 'oversized coordinates') payload.strokes[0].points[0].x = 541;
    if (problem === 'too many points') payload.strokes[0].points = Array.from({ length: 10001 }, () => ({ x: 0, y: 0, time: 0 }));
    expect(() => restorePaint(payload, materialized)).toThrow('GIF Paint');
  }
);
it('keeps each completed stroke as one undo step, excluding the draft, selection, and clock', () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 100000);
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [] } });
  clearHistory();
  useStore.getState().setAppMode('gif-paint');
  useStore.getState().setPaintDraft(stroke);
  expect(useStore.temporal.getState().pastStates).toHaveLength(0);
  useStore.getState().commitPaintStroke(stroke);
  useStore.getState().commitPaintStroke({ ...stroke, id: 'second' });
  useStore.getState().selectPaintStroke('second');
  useStore.getState().restartPaint(200);
  undo(); expect(useStore.getState().paint.strokes.map(s => s.id)).toEqual(['s']);
  undo(); expect(useStore.getState().paint.strokes).toEqual([]);
  redo(); expect(useStore.getState().paint.strokes.map(s => s.id)).toEqual(['s']);
  expect(useStore.getState().selectedPaintStrokeId).toBe('second');
  expect(useStore.getState().paintEpoch).toBe(200);
  expect(useStore.getState().appMode).toBe('gif-paint');
  expect(useStore.getState().polygonLayers).toEqual(initial.polygonLayers);
});
it('removes a used source from the chooser without breaking the painting, then releases it when no undo state needs it', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const tracker = createRingsResourceTracker(); tracker.remember([source]);
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [stroke] } });
  useStore.getState().removePaintAsset('gif');
  expect(useStore.getState().paint.assets[0].retired).toBe(true);
  tracker.sweep([{ paint: useStore.getState().paint }]);
  expect(revoke).not.toHaveBeenCalled();
  useStore.getState().deletePaintStroke('s');
  expect(useStore.getState().paint.assets).toEqual([]);
  tracker.sweep([{ paint: { assets: [], strokes: [] } }, { paint: { assets: [source], strokes: [stroke] } }]);
  expect(revoke).not.toHaveBeenCalled();
  tracker.sweep([{ paint: { assets: [], strokes: [] } }]);
  expect(revoke).toHaveBeenCalledWith('blob:paint');
});

it('undoes discrete stroke edits independently even immediately after painting', () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 200000);
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [] } });
  clearHistory();
  useStore.getState().commitPaintStroke(stroke);
  useStore.getState().updatePaintStroke('s', { hidden: true });
  undo();
  expect(useStore.getState().paint.strokes).toHaveLength(1);
  expect(useStore.getState().paint.strokes[0].hidden).toBe(false);
  useStore.getState().updatePaintStroke('s', { replay: true });
  undo();
  expect(useStore.getState().paint.strokes[0].replay).toBe(false);
});

it('saves new manual gestures as static even if an old tool preset requested replay', () => {
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [] } });
  useStore.getState().commitPaintStroke({ ...stroke, replay: true });
  expect(useStore.getState().paint.strokes[0].replay).toBe(false);
  useStore.getState().updatePaintStroke(stroke.id, { replay: true });
  expect(useStore.getState().paint.strokes[0].replay).toBe(true);
});
it('preserves explicit V12 replay and fading settings without a timing migration', () => {
  const payload = serialized();
  payload.strokes[0] = { ...payload.strokes[0], replay: true, lifetime: 0.5, phase: 0.3 };
  expect(restorePaint(payload, materialized).strokes[0]).toEqual(payload.strokes[0]);
});

it('round-trips autopaint settings and sources using paint payload V2', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['gif'], { type: 'image/gif' }) }));
  vi.stubGlobal('FileReader', class {
    result = 'data:image/gif;base64,Z2lm'; onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  const { DEFAULT_AUTOPAINT } = await import('./autopaint');
  const autopaint = { ...DEFAULT_AUTOPAINT, enabled: true, seed: 809, gesture: 'flicks' as const, pause: 2.5,
    brush: { ...DEFAULT_AUTOPAINT.brush, pattern: 'stripes' as const, lifetime: 3, imageRotation: 20 } };
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [stroke], autopaint } });
  await saveProject();
  const payload = JSON.parse(await vi.mocked(saveBlob).mock.calls.at(-1)![0].text());
  expect(payload.paint.version).toBe(2);
  const restored = restoreProjectDocument(payload, new Map([[payload.paint.assets[0].assetId, { src: 'blob:restored', gifData }]]));
  expect(restored.paint.autopaint).toEqual(autopaint);
  expect(restored.paint.strokes).toEqual([stroke]);
  expect(() => restorePaint({ ...payload.paint, autopaint: { brush: null } }, materialized)).toThrow('GIF Paint');
});
it('undoes autopaint configuration and preserves it when clearing or deleting manual strokes', () => {
  useStore.getState().loadDocument({ ...initial, paint: { assets: [source], strokes: [stroke] } });
  clearHistory();
  useStore.getState().updateAutopaint({ enabled: true });
  undo(); expect(useStore.getState().paint.autopaint).toBeUndefined();
  redo(); expect(useStore.getState().paint.autopaint?.enabled).toBe(true);
  const settings = useStore.getState().paint.autopaint;
  useStore.getState().deletePaintStroke(stroke.id);
  expect(useStore.getState().paint.autopaint).toBe(settings);
  undo();
  useStore.getState().clearPaintStrokes();
  expect(useStore.getState().paint.autopaint).toBe(settings);
});
