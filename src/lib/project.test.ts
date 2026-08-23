import { describe, expect, it } from 'vitest';
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
  });
});
