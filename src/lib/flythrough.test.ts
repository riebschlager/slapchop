import { describe, expect, it } from 'vitest';
import { DEFAULT_FLYTHROUGH, FlythroughAsset } from '../types';
import { resolveFlythroughParticles } from './flythrough';

const assets: FlythroughAsset[] = [
  { id: 'wide', name: 'wide.gif', src: 'wide', gifData: { frames: [], totalDurationMs: 1000, width: 400, height: 200 } },
  { id: 'tall', name: 'tall.gif', src: 'tall', gifData: { frames: [], totalDurationMs: 1000, width: 100, height: 300 } }
];

describe('resolveFlythroughParticles', () => {
  it('is deterministic for a time and seed', () => {
    const a = resolveFlythroughParticles(assets, DEFAULT_FLYTHROUGH, 1.25);
    const b = resolveFlythroughParticles(assets, DEFAULT_FLYTHROUGH, 1.25);
    expect(a).toEqual(b);
  });

  it('preserves each GIF aspect ratio on its plane', () => {
    const particles = resolveFlythroughParticles(assets, { ...DEFAULT_FLYTHROUGH, particleCount: 30 }, 0);
    for (const particle of particles) {
      const expected = particle.asset.id === 'wide' ? 2 : 1 / 3;
      expect(particle.width / particle.height).toBeCloseTo(expected, 8);
    }
  });

  it('moves particles toward the camera and wraps them deterministically', () => {
    const config = { ...DEFAULT_FLYTHROUGH, particleCount: 1, speed: 100, depth: 1000 };
    const atZero = resolveFlythroughParticles(assets, config, 0)[0];
    const later = resolveFlythroughParticles(assets, config, 0.25)[0];
    expect(later.z).toBeGreaterThan(atZero.z);
  });
});
