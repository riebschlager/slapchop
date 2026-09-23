import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveProject, restoreProjectDocument } from '../../lib/project';
import { saveBlob } from '../../lib/native';
import { clearHistory, getDocumentSnapshot, redo, undo, useStore } from '../../store';
import { DEFAULT_RINGS } from './model';

vi.mock('../../lib/native', () => ({ saveBlob: vi.fn() }));
const initial = getDocumentSnapshot();
afterEach(() => {
  useStore.getState().loadDocument(initial);
  clearHistory();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ring document integration', () => {
  it('saves a self-contained ring library with all ring settings and restores it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['source'], { type: 'image/png' }) }));
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,c291cmNl';
      onload?: () => void;
      readAsDataURL() { this.onload?.(); }
    });
    const rings = { ...DEFAULT_RINGS, gifsPerRing: 19, speed: -500, ringPhase: 0.3 };
    useStore.getState().loadDocument({ ...initial, rings, ringsAssets: [
      { id: 'saved', name: 'source.png', src: 'blob:source', width: 20, height: 40 }
    ] });
    await saveProject();
    const blob = vi.mocked(saveBlob).mock.calls.at(-1)![0];
    const payload = JSON.parse(await blob.text());
    expect(payload.version).toBe(8);
    expect(payload.ringsAssets[0].src).toBeUndefined();
    const id = payload.ringsAssets[0].assetId;
    expect(payload.assets[id].dataUrl).toBe('data:image/png;base64,c291cmNl');
    const restored = restoreProjectDocument(payload, new Map([[id, { src: 'blob:restored' }]]));
    expect(restored.rings).toEqual(rings);
    expect(restored.ringsAssets[0]).toMatchObject({ src: 'blob:restored', width: 20, height: 40 });
  });
  it('undoes settings and library edits without changing the active mode or tunnel', () => {
    vi.useFakeTimers();
    clearHistory();
    const tunnel = useStore.getState().tunnel;
    useStore.getState().setAppMode('rings');
    vi.advanceTimersByTime(400);
    useStore.getState().updateRings({ gifsPerRing: 23 });
    undo();
    expect(useStore.getState().rings.gifsPerRing).toBe(initial.rings.gifsPerRing);
    expect(useStore.getState().appMode).toBe('rings');
    redo();
    expect(useStore.getState().rings.gifsPerRing).toBe(23);
    expect(useStore.getState().tunnel).toBe(tunnel);
  });
});
