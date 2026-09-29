import { afterEach, expect, it, vi } from 'vitest';
import { saveProject, restoreProjectDocument } from '../../lib/project';
import { saveBlob } from '../../lib/native';
import { clearHistory, getDocumentSnapshot, redo, undo, useStore } from '../../store';
import { normalizeGrid } from './model';

vi.mock('../../lib/native', () => ({ saveBlob: vi.fn() }));
const initial = getDocumentSnapshot();
afterEach(() => { useStore.getState().loadDocument(initial); clearHistory(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('embeds and restores GIF Grid assets and all independent controls in V9', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['gif'], { type: 'image/gif' }) }));
  vi.stubGlobal('FileReader', class {
    result = 'data:image/gif;base64,Z2lm';
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  const grid = normalizeGrid({ rows: 7, columns: 9, shuffle: true, cellPhase: 0.25, margin: 35,
    x: { amount: 1.8, speed: 0.14, phase: 0.6, frequency: 2, harmonic: 0.7, reverse: true, weights: [1, 2] } });
  const gifData = { width: 100, height: 50, totalDurationMs: 1000, frames: [] };
  useStore.getState().loadDocument({ ...initial, grid, gridAssets: [{ id: 'gif', name: 'test.gif', src: 'blob:gif', gifData }] });
  await saveProject();
  const blob = vi.mocked(saveBlob).mock.calls.at(-1)![0];
  const payload = JSON.parse(await blob.text());
  expect(payload.version).toBe(9);
  expect(payload.gridAssets[0].src).toBeUndefined();
  const id = payload.gridAssets[0].assetId;
  expect(payload.assets[id].dataUrl).toBe('data:image/gif;base64,Z2lm');
  const restored = restoreProjectDocument(payload, new Map([[id, { src: 'blob:restored', gifData }]]));
  expect(restored.grid).toEqual(grid);
  expect(restored.gridAssets[0].gifData).toBe(gifData);
  expect(() => restoreProjectDocument(payload)).toThrow('GIF Grid source');
});
it('opens V1 with an empty independent grid and default settings', () => {
  const restored = restoreProjectDocument({ app: 'slapchop', version: 1, savedAt: '', canvasBg: '#000000', layers: [], polygonLayers: [], assets: {} });
  expect(restored.gridAssets).toEqual([]);
  expect(restored.grid).toEqual(normalizeGrid());
});
it('undoes and redoes grid controls and removal while preserving mode and other content', () => {
  vi.useFakeTimers();
  const gifData = { width: 1, height: 1, totalDurationMs: 100, frames: [] };
  useStore.getState().loadDocument({ ...initial, gridAssets: [{ id: 'a', name: 'a.gif', src: 'a', gifData }] });
  clearHistory();
  useStore.getState().setAppMode('gif-grid');
  vi.advanceTimersByTime(400);
  useStore.getState().updateGrid({ rows: 13 });
  undo();
  expect(useStore.getState().grid.rows).toBe(initial.grid.rows);
  redo();
  expect(useStore.getState().grid.rows).toBe(13);
  vi.advanceTimersByTime(400);
  useStore.getState().removeGridAsset('a');
  undo();
  expect(useStore.getState().gridAssets).toHaveLength(1);
  expect(useStore.getState().appMode).toBe('gif-grid');
  expect(useStore.getState().rings).toEqual(initial.rings);
});
