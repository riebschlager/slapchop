import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNNEL, DEFAULT_TUNNEL_SCALE_MOTION, TunnelAsset, TunnelConfig } from '../types';
import { resolveTunnelScene, tunnelPaneScale, tunnelUvRect } from './tunnel';

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

describe('tunnelPaneScale', () => {
  const withMotion = (updates: Partial<typeof DEFAULT_TUNNEL_SCALE_MOTION>): TunnelConfig => ({
    ...DEFAULT_TUNNEL,
    textureScale: 1.2,
    textureScaleMotion: { ...DEFAULT_TUNNEL_SCALE_MOTION, ...updates }
  });

  it('uses the static UV scale when sweep and noise are off', () => {
    expect(tunnelPaneScale(withMotion({}), 3, 2, 1.7)).toBe(1.2);
    expect(tunnelPaneScale(DEFAULT_TUNNEL, 3, 2, 1.7)).toBe(DEFAULT_TUNNEL.textureScale);
  });

  it('sweeps between the user range at the configured speed', () => {
    const config = withMotion({ sweep: true, min: 0.5, max: 2.5, speed: 0.5, ringSpread: 0 });
    expect(tunnelPaneScale(config, 0, 0, 0)).toBeCloseTo(1.5);
    expect(tunnelPaneScale(config, 0, 0, 0.5)).toBeCloseTo(2.5);
    expect(tunnelPaneScale(config, 0, 0, 1.5)).toBeCloseTo(0.5);
    expect(tunnelPaneScale(config, 7, 3, 0.5)).toBeCloseTo(2.5);
  });

  it('travels the sweep down the tunnel by ring spread', () => {
    const config = withMotion({ sweep: true, min: 0, max: 2, speed: 1, ringSpread: 0.25 });
    // Ring 1 at t reaches the phase ring 0 had a quarter cycle earlier.
    expect(tunnelPaneScale(config, 1, 0, 0.5)).toBeCloseTo(tunnelPaneScale(config, 0, 0, 0.25));
  });

  it('adds bounded, deterministic noise that differs per pane', () => {
    const config = withMotion({ noise: true, noiseAmplitude: 0.3, noisePeriod: 0.5 });
    const samples = Array.from({ length: 200 }, (_, index) => tunnelPaneScale(config, index % 9, index % 5, index * 0.037));
    expect(samples.every(scale => scale >= 0.9 && scale <= 1.5)).toBe(true);
    expect(new Set(samples.map(scale => scale.toFixed(4))).size).toBeGreaterThan(100);
    expect(tunnelPaneScale(config, 2, 1, 3.3)).toBe(tunnelPaneScale(config, 2, 1, 3.3));
    expect(tunnelPaneScale(config, 2, 1, 3.3)).not.toBe(tunnelPaneScale(config, 2, 2, 3.3));
  });

  it('drives the UV rect of GIF panes only', () => {
    const config = { ...withMotion({ sweep: true, min: 2, max: 2 }), speed: 0, gifEvery: 2, sides: 4 };
    const ring = resolveTunnelScene(assets, config, 0).panes.filter(pane => pane.ringIndex === 0);
    const gifPane = ring.find(pane => pane.asset)!;
    expect(gifPane.uv.u1 - gifPane.uv.u0).toBeLessThan(0.5);
  });
});
