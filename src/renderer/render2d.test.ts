import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA3D, DEFAULT_FLYTHROUGH, DEFAULT_GIF_VORONOI, DEFAULT_LANDSCAPE, DEFAULT_MASTER_FX, DEFAULT_TUNNEL, Layer, PolygonLayer } from '../types';
import { renderFrame, RenderState } from './render2d';

function createRecordingCanvas() {
  const trace: string[] = [];
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, property) {
      return (...args: unknown[]) => {
        trace.push(`${String(property)}:${JSON.stringify(args)}`);
        return undefined;
      };
    },
    set(_target, property, value) {
      trace.push(`${String(property)}=${String(value)}`);
      return true;
    }
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context
  } as unknown as HTMLCanvasElement;
  return { canvas, trace };
}

const polygon: PolygonLayer = {
  id: 'polygon',
  name: 'Triangle',
  points: [{ x: -100, y: 100 }, { x: 0, y: -100 }, { x: 100, y: 100 }],
  textureScale: 1,
  textureRotation: 0,
  textureOffsetX: 0,
  textureOffsetY: 0,
  opacity: 1,
  blendMode: 'normal',
  strokeColor: '#ffffff',
  strokeWidth: 2,
  fillColor: '#6366f1',
  symmetry: 'none',
  radialSegments: 6
};

const inactiveLegacyLayer: Layer = {
  id: 'legacy-layer',
  name: 'Legacy Voronoi',
  src: '',
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  symmetry: 'voronoi',
  radialSegments: 6,
  blendMode: 'screen',
  opacity: 1
};

function state(appMode: RenderState['appMode'], layers: Layer[] = []): RenderState {
  return {
    appMode,
    layers,
    polygonLayers: [polygon],
    mesh3dLayers: [],
    camera3d: DEFAULT_CAMERA3D,
    flythroughAssets: [],
    flythrough: DEFAULT_FLYTHROUGH,
    tunnelAssets: [],
    tunnel: DEFAULT_TUNNEL,
    gifVoronoiAssets: [],
    gifVoronoi: DEFAULT_GIF_VORONOI,
    landscapeTerrainAssets: [],
    landscapeSkySources: [],
    landscape: DEFAULT_LANDSCAPE,
    canvasBg: '#000000',
    masterFx: DEFAULT_MASTER_FX
  };
}

function renderTrace(renderState: RenderState, time = 1.25): string[] {
  const recording = createRecordingCanvas();
  renderFrame(recording.canvas, time, renderState, 540, 960);
  return recording.trace;
}

describe('renderFrame mode boundary', () => {
  it('is deterministic for the same active-mode snapshot and time', () => {
    expect(renderTrace(state('polygon'))).toEqual(renderTrace(state('polygon')));
  });

  it('renders only the active mode and ignores inactive legacy content', () => {
    const symmetryTrace = renderTrace(state('symmetry'));
    const polygonTrace = renderTrace(state('polygon'));
    const polygonWithInactiveLayer = renderTrace(state('polygon', [inactiveLegacyLayer]));

    expect(symmetryTrace.some(entry => entry.startsWith('beginPath:'))).toBe(false);
    expect(polygonTrace.some(entry => entry.startsWith('beginPath:'))).toBe(true);
    expect(polygonWithInactiveLayer).toEqual(polygonTrace);
  });

  it('renders flythrough GIF planes deterministically in the fallback', () => {
    const flythroughState: RenderState = {
      ...state('flythrough'),
      flythroughAssets: [{
        id: 'fly-gif',
        name: 'wide.gif',
        src: '',
        gifData: {
          width: 320,
          height: 180,
          totalDurationMs: 1000,
          frames: [{
            image: {} as CanvasImageSource,
            delayMs: 1000,
            startTimeMs: 0,
            endTimeMs: 1000
          }]
        }
      }],
      flythrough: { ...DEFAULT_FLYTHROUGH, particleCount: 3 }
    };

    const first = renderTrace(flythroughState, 0.5);
    const second = renderTrace(flythroughState, 0.5);
    expect(first).toEqual(second);
    expect(first.some(entry => entry.startsWith('drawImage:'))).toBe(true);
  });

  it('renders the palette-only tunnel deterministically in the fallback', () => {
    const tunnelState: RenderState = {
      ...state('tunnel'),
      tunnel: { ...DEFAULT_TUNNEL, sides: 4, ringCount: 6, speed: 0, fogEnabled: false }
    };
    const first = renderTrace(tunnelState, 0.5);
    expect(first).toEqual(renderTrace(tunnelState, 0.5));
    expect(first.some(entry => entry.startsWith('fill:'))).toBe(true);
  });

  it('renders a deterministic GIF Voronoi mosaic in the fallback', () => {
    const gifVoronoiState: RenderState = {
      ...state('gif-voronoi'),
      gifVoronoiAssets: [{
        id: 'mosaic-gif',
        name: 'wide.gif',
        src: '',
        width: 320,
        height: 180,
        gifData: {
          width: 320,
          height: 180,
          totalDurationMs: 1000,
          frames: [{
            image: {} as CanvasImageSource,
            delayMs: 1000,
            startTimeMs: 0,
            endTimeMs: 1000
          }]
        }
      }],
      gifVoronoi: { ...DEFAULT_GIF_VORONOI, cellCount: 6, occupancy: 1 }
    };
    const first = renderTrace(gifVoronoiState, 0.5);
    expect(first).toEqual(renderTrace(gifVoronoiState, 0.5));
    expect(first.filter(entry => entry.startsWith('drawImage:'))).toHaveLength(6);
  });

  it('morphs GIF Voronoi geometry over time when point drift is enabled', () => {
    const gifVoronoiState: RenderState = {
      ...state('gif-voronoi'),
      gifVoronoi: {
        ...DEFAULT_GIF_VORONOI,
        cellCount: 8,
        pointDriftAmount: 0.5,
        pointDriftSpeed: 0.2
      }
    };

    const first = renderTrace(gifVoronoiState, 0.5);
    expect(first).toEqual(renderTrace(gifVoronoiState, 0.5));
    expect(first).not.toEqual(renderTrace(gifVoronoiState, 1.5));
  });

  it('renders a deterministic noise landscape in the fallback', () => {
    const landscapeState: RenderState = {
      ...state('landscape'),
      landscape: { ...DEFAULT_LANDSCAPE, meshColumns: 4, meshRows: 8, flightSpeed: 0 }
    };
    const first = renderTrace(landscapeState, 0.5);
    expect(first).toEqual(renderTrace(landscapeState, 0.5));
    expect(first.some(entry => entry.startsWith('arc:'))).toBe(true);
    expect(first.some(entry => entry.startsWith('lineTo:'))).toBe(true);
  });

  it('animates the landscape from document time when motion is enabled', () => {
    const landscapeState: RenderState = {
      ...state('landscape'),
      landscape: {
        ...DEFAULT_LANDSCAPE,
        meshColumns: 4,
        meshRows: 8,
        flightSpeed: 0,
        motionSkyCenterX: { type: 'sine', speed: 1, amplitude: 240, phase: 0 },
        motionCameraHeight: { type: 'sine', speed: 0.5, amplitude: 300, phase: 0 }
      }
    };
    const first = renderTrace(landscapeState, 0.25);
    expect(first).toEqual(renderTrace(landscapeState, 0.25));
    expect(first).not.toEqual(renderTrace(landscapeState, 0.75));
  });
});
