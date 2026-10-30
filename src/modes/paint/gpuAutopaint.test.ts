import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPAINT, AutopaintSequence } from './autopaint';
import { DEFAULT_PAINT_SETTINGS, stampAlpha } from './model';
import type { PaintAsset } from './model';

const resources = vi.hoisted(() => ({ textures: [] as { destroyed: boolean }[], sources: [] as { destroyed: boolean }[] }));
vi.mock('pixi.js', () => {
  class ImageSource { destroyed = false; constructor(public options: unknown) { resources.sources.push(this); } update() {} destroy() { this.destroyed = true; } }
  class Texture {
    destroyed = false;
    static EMPTY = new Texture(); static WHITE = new Texture();
    constructor(public options?: unknown) { resources.textures.push(this); }
    destroy() { this.destroyed = true; }
  }
  class RenderTexture extends Texture { static create(options: unknown) { return new RenderTexture(options); } }
  class Sprite { texture = Texture.EMPTY; visible = true; destroy() {} }
  class Particle { texture: Texture; x = 0; y = 0; scaleX = 1; scaleY = 1; alpha = 1; constructor(options: { texture: Texture }) { this.texture = options.texture; } }
  class ParticleContainer { texture = Texture.EMPTY; particleChildren: Particle[] = []; update() {} destroy() {} }
  return { Texture, RenderTexture, ImageSource, Sprite, Particle, ParticleContainer, Rectangle: class {} };
});
import { GpuAutopaint } from './gpuAutopaint';
import type { Renderer } from 'pixi.js';

const frame = {} as CanvasImageSource;
const assets: PaintAsset[] = [{ id: 'a', name: 'a', src: '', gifData: { width: 20, height: 20, totalDurationMs: 100,
  frames: [{ image: frame, startTimeMs: 0, endTimeMs: 100, delayMs: 100 }] } }];
const config = { ...DEFAULT_AUTOPAINT, enabled: true, brush: { ...DEFAULT_PAINT_SETTINGS, size: 24, spacing: .1 } };
function setup() {
  const render = vi.fn();
  const painter = new GpuAutopaint({ render } as unknown as Renderer);
  return { painter, render };
}
beforeEach(() => {
  resources.textures.length = 0; resources.sources.length = 0;
  vi.stubGlobal('Path2D', class { arc() {} rect() {} moveTo() {} });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ setTransform() {}, rotate() {}, clip() {}, drawImage() {} }) }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('only deposits new accumulating stamps and skips all GPU work at unchanged time', () => {
  const { painter, render } = setup();
  painter.render(config, assets, 2, 270, 480, false);
  const before = painter.metrics; render.mockClear();
  painter.render(config, assets, 2, 270, 480, false);
  expect(render).not.toHaveBeenCalled(); expect(painter.metrics).toEqual(before);
  painter.render(config, assets, 2.5, 270, 480, false);
  const expected = [...new AutopaintSequence(config, assets).stamps(2, 2.5)].length;
  expect(painter.metrics.stamps! - before.stamps!).toBe(expected);
  expect(painter.metrics.rebuilds).toBe(before.rebuilds);
  expect(painter.metrics.renderPixels).toBe(270 * 480 * 2);
  painter.destroy();
});
it('retains only the exact linear lifetime window, including forward jumps', () => {
  const { painter } = setup(); const fading = { ...config, brush: { ...config.brush, lifetime: .5 } };
  for (const time of [1, 1.1, 30]) {
    painter.render(fading, assets, time, 270, 480, false);
    const expected = [...new AutopaintSequence(fading, assets).stamps(time - .5, time)].filter(s => stampAlpha(s, time) > 0).length;
    expect(painter.metrics.liveStamps).toBe(expected);
  }
  painter.destroy();
});
it('keys invalidation by palette order and decoded identity rather than metadata', () => {
  const { painter } = setup(); painter.render(config, assets, 1, 270, 480, false);
  const rebuilds = painter.metrics.rebuilds;
  painter.render(config, [{ ...assets[0], name: 'renamed' }], 1.1, 270, 480, false);
  expect(painter.metrics.rebuilds).toBe(rebuilds);
  painter.render(config, [{ ...assets[0], gifData: { ...assets[0].gifData } }], 1.2, 270, 480, false);
  expect(painter.metrics.rebuilds).toBe(rebuilds + 1);
  painter.destroy();
});
it('reconstructs on backward seek, brush edit, and resolution change', () => {
  const { painter } = setup(); painter.render(config, assets, 1, 270, 480, false);
  painter.render(config, assets, .1, 270, 480, false);
  expect(painter.metrics.stamps).toBe([...new AutopaintSequence(config, assets).stamps(-1e-9, .1)].length);
  const edited = { ...config, brush: { ...config.brush, opacity: .4 } };
  painter.render(edited, assets, .2, 270, 480, false);
  painter.render(edited, assets, .2, 540, 960, false);
  expect(painter.metrics.rebuilds).toBe(4);
  expect(painter.metrics.renderPixels).toBe(540 * 960 * 2);
  painter.destroy(); expect(resources.textures.every(t => t.destroyed)).toBe(true);
  expect(resources.sources.every(s => s.destroyed)).toBe(true);
});
it('cancels pending reconstruction on edits and releases all work on disable', () => {
  const { painter } = setup();
  vi.spyOn(performance, 'now').mockImplementation((() => { let t = 0; return () => t += 10; })());
  const dense = { ...config, duration: .15, pause: 0, reach: 1800 };
  painter.render(dense, assets, 30, 270, 480, true);
  expect(painter.rebuilding).toBe(true);
  painter.render({ ...dense, seed: 20 }, assets, 0, 270, 480, false);
  expect(painter.rebuilding).toBe(false);
  expect(painter.metrics.poolSize).toBeLessThanOrEqual(2048);
  painter.render(undefined, assets, 0, 270, 480, true);
  expect(painter.metrics.renderPixels).toBe(0); expect(painter.metrics.atlasPixels).toBe(0);
  expect(painter.sprite.visible).toBe(false);
  expect(resources.textures.every(t => t.destroyed)).toBe(true);
  painter.destroy(); vi.restoreAllMocks();
});
it('evicts atlas pages under source-frame pressure without allocating history surfaces', () => {
  const { painter } = setup();
  const many = [{ ...assets[0], gifData: { ...assets[0].gifData, totalDurationMs: 1200,
    frames: Array.from({ length: 120 }, (_, i) => ({ image: {} as CanvasImageSource, startTimeMs: i * 10, endTimeMs: (i + 1) * 10, delayMs: 10 })) } }];
  const large = { ...config, duration: 3, pause: 0, reach: 1800, brush: { ...config.brush, size: 600 } };
  painter.render(large, many, 60, 270, 480, false);
  expect(painter.metrics.atlasEvictions).toBeGreaterThan(0);
  expect(painter.metrics.atlasPixels).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(painter.metrics.renderPixels).toBe(270 * 480 * 2);
  painter.destroy();
});

it('does no raster work during an empty fading pause', () => {
  const { painter, render } = setup();
  const paused = { ...config, duration: .15, pause: 10, brush: { ...config.brush, lifetime: .1 } };
  painter.render(paused, assets, .1, 270, 480, false);
  painter.render(paused, assets, 1, 270, 480, false);
  render.mockClear();
  painter.render(paused, assets, 1.1, 270, 480, false);
  expect(render).not.toHaveBeenCalled(); expect(painter.metrics.liveStamps).toBe(0);
  painter.destroy();
});
