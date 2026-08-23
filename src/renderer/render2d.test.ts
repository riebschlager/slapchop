import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA3D, DEFAULT_MASTER_FX, Layer, PolygonLayer } from '../types';
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
});
