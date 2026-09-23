import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearHistory, getDocumentSnapshot, useStore } from './store';
import type { PolygonTextureFolder } from './types';

const initial = getDocumentSnapshot();
afterEach(() => {
  useStore.getState().setPolygonTextureFolder(null);
  useStore.getState().loadDocument(initial);
  clearHistory();
  vi.restoreAllMocks();
});

const folder = (name: string, ids: string[]): PolygonTextureFolder => ({
  name,
  assets: ids.map(id => ({ id, name: `${id}.gif`, src: `blob:${id}` }))
});

describe('Tiled GIF texture folder', () => {
  it('gives every newly created shape a texture from the folder', () => {
    const loops = folder('loops', ['a', 'b', 'c']);
    useStore.getState().setPolygonTextureFolder(loops);
    const store = useStore.getState();
    store.addPresetPolygon('triangle');
    store.finishDrawingPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]);
    store.finishBrushStroke({ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], pressures: [0.5, 0.5] }, 1);
    const created = useStore.getState().polygonLayers.slice(-3);
    const sources = new Set(loops.assets.map(asset => asset.src));
    for (const poly of created) expect(sources.has(poly.src!)).toBe(true);
    // Consecutive shapes avoid repeating the previous shape's texture.
    expect(created[1].src).not.toBe(created[0].src);
    expect(created[2].src).not.toBe(created[1].src);
  });

  it('shuffles a shape to a different folder texture', () => {
    useStore.getState().setPolygonTextureFolder(folder('loops', ['a', 'b']));
    useStore.getState().addPresetPolygon('hexagon');
    const poly = useStore.getState().polygonLayers.at(-1)!;
    useStore.getState().shufflePolygonTexture(poly.id);
    expect(useStore.getState().polygonLayers.at(-1)!.src).not.toBe(poly.src);
  });

  it('releases replaced folder textures that no shape still uses', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    useStore.getState().setPolygonTextureFolder(folder('only', ['kept']));
    useStore.getState().setPolygonTextureFolder(folder('two', ['used', 'unused']));
    useStore.getState().addPresetPolygon('star');
    const used = useStore.getState().polygonLayers.at(-1)!.src!;
    useStore.getState().setPolygonTextureFolder(folder('next', ['z']));
    expect(revoke).toHaveBeenCalledWith('blob:kept');
    expect(revoke).toHaveBeenCalledWith(used === 'blob:used' ? 'blob:unused' : 'blob:used');
    expect(revoke).not.toHaveBeenCalledWith(used);
  });
});
