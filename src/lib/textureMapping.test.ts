import { describe, expect, it } from 'vitest';
import { Matrix3, Vector2 } from 'three';
import { rotateTextureUv, textureMirrorAxes } from './textureMapping';
import { tunnelUvRect } from './tunnel';
import { gifVoronoiCoverRect } from './gifVoronoi';

describe('texture mapping', () => {
  it('rotates about the texture center without clipping coordinates needed for tiling', () => {
    expect(rotateTextureUv(0.5, 0.5, 37)).toEqual([0.5, 0.5]);
    const rotated = rotateTextureUv(2, 0.5, 90);
    expect(rotated[0]).toBeCloseTo(0.5);
    expect(rotated[1]).toBeCloseTo(2);
    const restored = rotateTextureUv(...rotated, -90);
    expect(restored[0]).toBeCloseTo(2);
    expect(restored[1]).toBeCloseTo(0.5);
  });

  it('matches terrain GPU UV transforms including image Y orientation', () => {
    const repeat = 2;
    const angle = 37;
    const offsetX = 0.2;
    const offsetY = -0.3;
    const matrix = new Matrix3().setUvTransform(offsetX, offsetY, repeat, -repeat, -angle * Math.PI / 180, 0.5, 0.5);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const gpu = new Vector2(u, v).applyMatrix3(matrix);
      const cpu = rotateTextureUv(u, v, angle);
      expect((cpu[0] - 0.5) * repeat + 0.5 + offsetX).toBeCloseTo(gpu.x);
      expect((cpu[1] - 0.5) * repeat + 0.5 - offsetY).toBeCloseTo(1 - gpu.y);
    }
  });

  it('keeps mirror axes independent', () => {
    expect(textureMirrorAxes('repeat')).toEqual([false, false]);
    expect(textureMirrorAxes('clamp')).toEqual([false, false]);
    expect(textureMirrorAxes('mirror')).toEqual([true, true]);
    expect(textureMirrorAxes('mirror-x')).toEqual([true, false]);
    expect(textureMirrorAxes('mirror-y')).toEqual([false, true]);
  });

  it('allows tunnel repetition outside the image while preserving legacy crop offsets', () => {
    expect(tunnelUvRect(1, 1, 2, 1, -1)).toEqual({ u0: 0.5, v0: 0, u1: 1, v1: 0.5 });
    expect(tunnelUvRect(1, 1, 0.5, 0, 0, 'mirror')).toEqual({ u0: -0.5, v0: -0.5, u1: 1.5, v1: 1.5 });
    expect(tunnelUvRect(1, 1, 1, 1, -1, 'repeat')).toEqual({ u0: 1, v0: -1, u1: 2, v1: 0 });
  });

  it('allows Voronoi tiles smaller than their cell for visible repetition', () => {
    expect(gifVoronoiCoverRect(100, 100, { minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0.5, 0, 0))
      .toEqual({ x: 50, y: 50, width: 100, height: 100 });
    expect(gifVoronoiCoverRect(100, 100, { minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0.5, 1, -1))
      .toEqual({ x: 100, y: 0, width: 100, height: 100 });
  });
});
