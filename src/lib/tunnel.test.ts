import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNNEL, TunnelAsset } from '../types';
import { resolveTunnelScene, tunnelUvRect } from './tunnel';

const assets: TunnelAsset[] = [
  { id: 'a', name: 'a.gif', src: 'a', width: 400, height: 200 },
  { id: 'b', name: 'b.png', src: 'b', width: 200, height: 400 }
];

describe('resolveTunnelScene', () => {
  it('is deterministic at an exact time', () => {
    expect(resolveTunnelScene(assets, DEFAULT_TUNNEL, 1.25)).toEqual(
      resolveTunnelScene(assets, DEFAULT_TUNNEL, 1.25)
    );
  });

  it('uses one ordered asset for every eligible pane in a ring', () => {
    const scene = resolveTunnelScene(assets, {
      ...DEFAULT_TUNNEL,
      sides: 6,
      ringCount: 4,
      gifEvery: 2,
      ringPatternOffset: 0,
      speed: 0
    }, 0);
    const ring = scene.panes.filter(pane => pane.ringIndex === 0);
    expect(ring).toHaveLength(6);
    expect(ring.filter(pane => pane.asset).map(pane => pane.asset?.id)).toEqual(['a', 'a', 'a']);
    expect(ring.filter(pane => !pane.asset).every(pane => pane.color !== null)).toBe(true);
  });

  it('can shift occupancy around successive rings', () => {
    const scene = resolveTunnelScene(assets, {
      ...DEFAULT_TUNNEL,
      sides: 6,
      ringCount: 4,
      gifEvery: 3,
      ringPatternOffset: 1,
      speed: 0
    }, 0);
    const first = scene.panes.filter(pane => pane.ringIndex === 0 && pane.asset).map(pane => pane.sideIndex);
    const second = scene.panes.filter(pane => pane.ringIndex === 1 && pane.asset).map(pane => pane.sideIndex);
    expect(first).toEqual([0, 3]);
    expect(second).toEqual([2, 5]);
  });

  it('advances GIF phase independently by ring', () => {
    const gifAssets: TunnelAsset[] = [{
      id: 'gif',
      name: 'loop.gif',
      src: 'gif',
      gifData: { width: 100, height: 100, totalDurationMs: 4000, frames: [] }
    }];
    const scene = resolveTunnelScene(gifAssets, { ...DEFAULT_TUNNEL, speed: 0, ringPhase: 0.25 }, 2);
    expect(scene.panes.find(pane => pane.ringIndex === 0)?.sourceTime).toBe(2);
    expect(scene.panes.find(pane => pane.ringIndex === 1)?.sourceTime).toBe(3);
    expect(scene.panes.find(pane => pane.ringIndex === -1)?.sourceTime).toBe(5);
  });
});

describe('tunnelUvRect', () => {
  it('cover-crops a wide source for a square pane', () => {
    expect(tunnelUvRect(2, 1, 1, 0, 0)).toEqual({ u0: 0.25, v0: 0, u1: 0.75, v1: 1 });
  });

  it('zooms and clamps offsets inside the source', () => {
    const uv = tunnelUvRect(1, 1, 2, 1, -1);
    expect(uv).toEqual({ u0: 0.5, v0: 0, u1: 1, v1: 0.5 });
  });
});
