import { describe, expect, it } from 'vitest';
import { DEFAULT_FLYTHROUGH, DEFAULT_GIF_VORONOI, DEFAULT_LANDSCAPE, DEFAULT_TUNNEL } from '../types';
import { restoreProjectDocument } from './project';

describe('restoreProjectDocument', () => {
  it('preserves legacy Voronoi fields while restoring a V1 project', () => {
    const payload = {
      app: 'slapchop' as const,
      version: 1 as const,
      savedAt: '2025-01-01T00:00:00.000Z',
      canvasBg: '#123456',
      layers: [{
        id: 'legacy-layer',
        name: 'Legacy Voronoi Layer',
        assetId: 'missing-layer-asset',
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        symmetry: 'voronoi' as const,
        radialSegments: 6,
        symmetryParams: {
          originX: 0,
          originY: 0,
          spiralGrowth: 0.85,
          spiralAngleStep: 25,
          spiralInstances: 10,
          wallpaperLattice: 'p6' as const,
          wallpaperCellSize: 260,
          poincareRings: 4,
          poincareRadius: 480,
          voronoiCells: 27,
          voronoiSeed: 42,
          voronoiPhaseVariation: 0.75
        },
        blendMode: 'screen' as const,
        opacity: 0.8
      }],
      polygonLayers: [{
        id: 'legacy-polygon',
        name: 'Legacy Voronoi Polygon',
        points: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 0, y: 100 }],
        textureScale: 1,
        textureRotation: 0,
        textureOffsetX: 0,
        textureOffsetY: 0,
        opacity: 1,
        blendMode: 'normal' as const,
        strokeColor: '#ffffff',
        strokeWidth: 2,
        symmetry: 'voronoi' as const,
        radialSegments: 6
      }],
      assets: {}
    };

    const document = restoreProjectDocument(payload);

    expect(document.layers[0].symmetry).toBe('voronoi');
    expect(document.layers[0].symmetryParams?.voronoiCells).toBe(27);
    expect(document.layers[0].symmetryParams?.voronoiSeed).toBe(42);
    expect(document.polygonLayers[0].symmetry).toBe('voronoi');
    expect(document.layers[0].src).toBe('');
    expect(document.mesh3dLayers).toEqual([]);
    expect(document.flythroughAssets).toEqual([]);
    expect(document.flythrough.particleCount).toBeGreaterThan(0);
    expect(document.tunnelAssets).toEqual([]);
    expect(document.tunnel.sides).toBe(DEFAULT_TUNNEL.sides);
    expect(document.gifVoronoiAssets).toEqual([]);
    expect(document.gifVoronoi.cellCount).toBe(DEFAULT_GIF_VORONOI.cellCount);
    expect(document.landscapeTerrainAssets).toEqual([]);
    expect(document.landscapeSkySources).toEqual([]);
    expect(document.landscape.heightScale).toBe(DEFAULT_LANDSCAPE.heightScale);
  });

  it('restores a V3 flythrough library and its mode-owned config', () => {
    const payload = {
      app: 'slapchop' as const,
      version: 3 as const,
      savedAt: '2026-08-23T00:00:00.000Z',
      canvasBg: '#000000',
      layers: [],
      polygonLayers: [],
      mesh3dLayers: [],
      flythroughAssets: [{ id: 'source-1', name: 'comet.gif', width: 320, height: 180, assetId: 'gif-asset' }],
      flythrough: { ...DEFAULT_FLYTHROUGH, particleCount: 88, speed: 900, plane: 'xz' as const },
      assets: {}
    };

    const document = restoreProjectDocument(payload);

    expect(document.flythroughAssets[0]).toMatchObject({
      id: 'source-1',
      name: 'comet.gif',
      width: 320,
      height: 180,
      src: ''
    });
    expect(document.flythrough.particleCount).toBe(88);
    expect(document.flythrough.speed).toBe(900);
    expect(document.flythrough.plane).toBe('xz');
    expect(document.flythrough.depth).toBeGreaterThan(0);
  });

  it('restores a V4 tunnel library, palette, and procedural configuration', () => {
    const payload = {
      app: 'slapchop' as const,
      version: 4 as const,
      savedAt: '2026-08-24T00:00:00.000Z',
      canvasBg: '#000000',
      layers: [],
      polygonLayers: [],
      mesh3dLayers: [],
      flythroughAssets: [],
      tunnelAssets: [{ id: 'wall-1', name: 'wall.png', width: 800, height: 600, assetId: 'wall-asset' }],
      tunnel: { ...DEFAULT_TUNNEL, sides: 4, gifEvery: 3, palette: ['#112233', '#abcdef'] },
      assets: {}
    };

    const document = restoreProjectDocument(payload);

    expect(document.tunnelAssets[0]).toMatchObject({ id: 'wall-1', name: 'wall.png', src: '' });
    expect(document.tunnel.sides).toBe(4);
    expect(document.tunnel.gifEvery).toBe(3);
    expect(document.tunnel.palette).toEqual(['#112233', '#abcdef']);
  });

  it('restores a V5 GIF Voronoi library and keeps older mode data', () => {
    const gifData = { width: 320, height: 180, totalDurationMs: 1000, frames: [] };
    const payload = {
      app: 'slapchop' as const,
      version: 5 as const,
      savedAt: '2026-08-27T00:00:00.000Z',
      canvasBg: '#000000',
      layers: [],
      polygonLayers: [],
      mesh3dLayers: [],
      flythroughAssets: [],
      tunnelAssets: [],
      tunnel: { ...DEFAULT_TUNNEL, sides: 12 },
      gifVoronoiAssets: [{
        id: 'mosaic-1',
        name: 'mosaic.gif',
        width: 320,
        height: 180,
        assetId: 'mosaic-asset'
      }],
      gifVoronoi: {
        ...DEFAULT_GIF_VORONOI,
        cellCount: 64,
        arrangement: 'radial' as const,
        palette: ['#123456', '#abcdef']
      },
      assets: {}
    };
    const materialized = new Map([['mosaic-asset', { src: 'blob:mosaic', gifData }]]);
    const document = restoreProjectDocument(payload, materialized);

    expect(document.gifVoronoiAssets[0]).toMatchObject({
      id: 'mosaic-1',
      name: 'mosaic.gif',
      src: 'blob:mosaic',
      gifData
    });
    expect(document.gifVoronoi.cellCount).toBe(64);
    expect(document.gifVoronoi.arrangement).toBe('radial');
    expect(document.gifVoronoi.palette).toEqual(['#123456', '#abcdef']);
    expect(document.tunnel.sides).toBe(12);

    const legacyPayload = JSON.parse(JSON.stringify(payload));
    delete legacyPayload.gifVoronoi.pointDriftAmount;
    delete legacyPayload.gifVoronoi.pointDriftSpeed;
    const legacyDocument = restoreProjectDocument(legacyPayload, materialized);
    expect(legacyDocument.gifVoronoi.pointDriftAmount).toBe(0);
    expect(legacyDocument.gifVoronoi.pointDriftSpeed).toBe(DEFAULT_GIF_VORONOI.pointDriftSpeed);
  });

  it('restores a V6 landscape terrain and independently mapped sky folders', () => {
    const gifData = { width: 240, height: 180, totalDurationMs: 1000, frames: [] };
    const payload = {
      app: 'slapchop' as const,
      version: 6 as const,
      savedAt: '2026-08-29T00:00:00.000Z',
      canvasBg: '#000000',
      layers: [],
      polygonLayers: [],
      mesh3dLayers: [],
      flythroughAssets: [],
      tunnelAssets: [],
      gifVoronoiAssets: [],
      landscapeTerrainAssets: [{ id: 'terrain-1', name: 'ground.gif', width: 240, height: 180, assetId: 'terrain-asset' }],
      landscapeSkySources: [{
        id: 'sky-1',
        name: 'Solar folder',
        textureScale: 1.5,
        textureOffsetX: 0.2,
        textureOffsetY: -0.1,
        textureRotation: 12,
        gifSpeed: 0.75,
        motionTextureRotation: { type: 'noise' as const, speed: 0.3, amplitude: 45, phase: 1.2 },
        assets: [{ id: 'sky-gif-1', name: 'sun.gif', width: 240, height: 180, assetId: 'sky-asset' }]
      }],
      landscape: {
        ...DEFAULT_LANDSCAPE,
        skyCircleCount: 11,
        ridgeAmount: 0.9,
        motionCameraX: { type: 'sine' as const, speed: 0.25, amplitude: 500, phase: 0 }
      },
      assets: {}
    };
    const materialized = new Map([
      ['terrain-asset', { src: 'blob:terrain', gifData }],
      ['sky-asset', { src: 'blob:sky', gifData }]
    ]);
    const document = restoreProjectDocument(payload, materialized);

    expect(document.landscapeTerrainAssets[0]).toMatchObject({ name: 'ground.gif', src: 'blob:terrain', gifData });
    expect(document.landscapeSkySources[0]).toMatchObject({
      name: 'Solar folder',
      textureScale: 1.5,
      motionTextureRotation: { type: 'noise', amplitude: 45 }
    });
    expect(document.landscapeSkySources[0].assets[0]).toMatchObject({ name: 'sun.gif', src: 'blob:sky', gifData });
    expect(document.landscape.skyCircleCount).toBe(11);
    expect(document.landscape.ridgeAmount).toBe(0.9);
    expect(document.landscape.motionCameraX).toEqual({ type: 'sine', speed: 0.25, amplitude: 500, phase: 0 });
  });
});

it('round-trips additive texture fields across every texture editor', async () => {
  const { createNewPolygonLayer } = await import('./polygonUtils');
  const { createMesh3dLayer } = await import('./mesh3dUtils');
  const payload = {
    app: 'slapchop' as const, version: 6 as const, savedAt: '', canvasBg: '#000000',
    layers: [],
    polygonLayers: [createNewPolygonLayer('fill', [], { textureTiling: 'mirror-x', textureRotation: 37 })],
    mesh3dLayers: [createMesh3dLayer('mesh', 'plane', { uvTiling: 'mirror-y', uvRotation: 72 })],
    flythroughAssets: [], tunnelAssets: [], gifVoronoiAssets: [], landscapeTerrainAssets: [],
    tunnel: { ...DEFAULT_TUNNEL, textureRotation: 23, textureTiling: 'mirror' as const },
    gifVoronoi: { ...DEFAULT_GIF_VORONOI, textureRotation: 51, textureTiling: 'mirror-x' as const, coverZoom: 0.5 },
    landscape: { ...DEFAULT_LANDSCAPE, terrainTextureRotation: 18, terrainTextureTiling: 'repeat' as const },
    landscapeSkySources: [{ id: 'sky', name: 'Sky', assets: [], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureRotation: 39, textureTiling: 'mirror-y' as const, gifSpeed: 1 }],
    assets: {}
  };
  const restored = restoreProjectDocument(JSON.parse(JSON.stringify(payload)));
  expect(restored.polygonLayers[0]).toMatchObject({ textureTiling: 'mirror-x', textureRotation: 37 });
  expect(restored.mesh3dLayers[0]).toMatchObject({ uvTiling: 'mirror-y', uvRotation: 72 });
  expect(restored.tunnel).toMatchObject({ textureRotation: 23, textureTiling: 'mirror' });
  expect(restored.gifVoronoi).toMatchObject({ textureRotation: 51, textureTiling: 'mirror-x', coverZoom: 0.5 });
  expect(restored.landscape).toMatchObject({ terrainTextureRotation: 18, terrainTextureTiling: 'repeat' });
  expect(restored.landscapeSkySources[0]).toMatchObject({ textureRotation: 39, textureTiling: 'mirror-y' });
});
