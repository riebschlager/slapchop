import { describe, expect, it } from 'vitest';
import { restoreProjectDocument } from '../../lib/project';
import { DEFAULT_RINGS } from './model';
import { DEFAULT_LANDSCAPE } from '../../types';

const base = {
  app: 'slapchop' as const, version: 7 as const, savedAt: '', canvasBg: '#000000',
  layers: [], polygonLayers: [], mesh3dLayers: [], flythroughAssets: [], tunnelAssets: [],
  gifVoronoiAssets: [], landscapeTerrainAssets: [], landscapeSkySources: [],
  landscape: { ...DEFAULT_LANDSCAPE, flightSpeed: 345 }, assets: {},
  ringsAssets: [{ id: 'ring-a', name: 'a.png', width: 300, height: 150, assetId: 'a' }],
  rings: { ...DEFAULT_RINGS, speed: -400, gifsPerRing: 17, shuffle: true }
};

describe('GIF Rings project compatibility', () => {
  it('restores ring configuration and embedded sources while retaining landscape data in V7', () => {
    const doc = restoreProjectDocument(JSON.parse(JSON.stringify(base)), new Map([['a', { src: 'blob:a' }]]));
    expect(doc.rings).toEqual(base.rings);
    expect(doc.ringsAssets[0]).toMatchObject({ id: 'ring-a', src: 'blob:a', width: 300 });
    expect(doc.landscape.flightSpeed).toBe(345);
  });
  it('opens V6 with a fresh empty ring library', () => {
    const doc = restoreProjectDocument({ ...base, version: 6 });
    expect(doc.rings).toEqual(DEFAULT_RINGS);
    expect(doc.ringsAssets).toEqual([]);
    expect(doc.landscape.flightSpeed).toBe(345);
  });
  it('reports missing embedded sources', () => {
    expect(() => restoreProjectDocument(base)).toThrow('GIF Rings source “a.png” is missing');
  });
});
