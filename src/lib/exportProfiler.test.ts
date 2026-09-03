import { describe, expect, it, vi } from 'vitest';
import { createExportProfiler, formatExportProfile } from './exportProfiler';

describe('createExportProfiler', () => {
  it('accumulates exact count, total, min and max per stage', () => {
    const profiler = createExportProfiler('test');
    profiler.record('a', 10);
    profiler.record('a', 30);
    profiler.record('a', 20);
    profiler.record('b', 5);

    const stages = Object.fromEntries(profiler.summarize().stages.map((s) => [s.stage, s]));
    expect(stages.a.count).toBe(3);
    expect(stages.a.totalMs).toBe(60);
    expect(stages.a.meanMs).toBe(20);
    expect(stages.a.minMs).toBe(10);
    expect(stages.a.maxMs).toBe(30);
    expect(stages.a.sampled).toBe(false);
    expect(stages.b.count).toBe(1);
  });

  it('orders stages by total time so the dominant stage reads first', () => {
    const profiler = createExportProfiler('test');
    profiler.record('cheap', 1);
    profiler.record('expensive', 100);
    profiler.record('middle', 10);

    expect(profiler.summarize().stages.map((s) => s.stage))
      .toEqual(['expensive', 'middle', 'cheap']);
  });

  it('reports nearest-rank median and p95', () => {
    const profiler = createExportProfiler('test');
    for (let i = 1; i <= 100; i++) profiler.record('s', i);

    const [stage] = profiler.summarize().stages;
    expect(stage.medianMs).toBe(50);
    expect(stage.p95Ms).toBe(95);
  });

  it('bounds retained samples and flags the summary as sampled', () => {
    // Always replacing slot 0 keeps the reservoir deterministic for the test.
    const profiler = createExportProfiler('test', {}, () => 0);
    for (let i = 0; i < 5000; i++) profiler.record('s', 1);

    const [stage] = profiler.summarize().stages;
    expect(stage.count).toBe(5000);
    expect(stage.sampled).toBe(true);
  });

  it('times a synchronous stage and returns its value', () => {
    const profiler = createExportProfiler('test');
    expect(profiler.time('s', () => 42)).toBe(42);
    expect(profiler.summarize().stages[0].count).toBe(1);
  });

  it('records a stage even when the timed work throws', () => {
    const profiler = createExportProfiler('test');
    expect(() => profiler.time('s', () => { throw new Error('boom'); })).toThrow('boom');
    expect(profiler.summarize().stages[0].count).toBe(1);
  });

  it('times an asynchronous stage', async () => {
    const profiler = createExportProfiler('test');
    await expect(profiler.timeAsync('s', async () => 'done')).resolves.toBe('done');
    expect(profiler.summarize().stages[0].count).toBe(1);
  });

  it('derives effective fps from counted frames and elapsed wall time', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    const profiler = createExportProfiler('test');
    for (let i = 0; i < 60; i++) profiler.countFrame();
    now.mockReturnValue(2000);

    const summary = profiler.summarize();
    expect(summary.frames).toBe(60);
    expect(summary.effectiveFps).toBeCloseTo(30, 5);
    now.mockRestore();
  });

  it('starts the clock at the first recorded stage, not at construction', () => {
    const now = vi.spyOn(performance, 'now');
    // A long idle gap (e.g. the native save dialog) before any work happens.
    now.mockReturnValue(0);
    const profiler = createExportProfiler('test');
    now.mockReturnValue(10_000);
    for (let i = 0; i < 30; i++) profiler.countFrame();
    now.mockReturnValue(11_000);

    expect(profiler.summarize().effectiveFps).toBeCloseTo(30, 5);
    now.mockRestore();
  });

  it('reports zero elapsed and fps when nothing was recorded', () => {
    const summary = createExportProfiler('test').summarize();
    expect(summary.elapsedMs).toBe(0);
    expect(summary.effectiveFps).toBe(0);
    expect(summary.stages).toEqual([]);
  });
});

describe('recordBytes', () => {
  it('summarizes payload sizes separately from stage timings', () => {
    const profiler = createExportProfiler('test');
    profiler.record('ipc.writeFrame', 100);
    profiler.recordBytes('ipc.writeFrame', 1000);
    profiler.recordBytes('ipc.writeFrame', 3000);

    const summary = profiler.summarize();
    expect(summary.stages).toHaveLength(1);
    expect(summary.payloads).toHaveLength(1);
    expect(summary.payloads[0]).toMatchObject({
      name: 'ipc.writeFrame',
      count: 2,
      totalBytes: 4000,
      meanBytes: 2000,
      maxBytes: 3000
    });
  });

  it('does not start the elapsed clock, since no work has been timed', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    const profiler = createExportProfiler('test');
    profiler.recordBytes('ipc.writeFrame', 1000);
    now.mockReturnValue(5000);

    expect(profiler.summarize().elapsedMs).toBe(0);
    now.mockRestore();
  });
});

describe('formatExportProfile', () => {
  it('includes the label, frame count and every stage', () => {
    const profiler = createExportProfiler('mp4 export', { fps: 30 });
    profiler.record('png.encode', 12);
    profiler.countFrame();

    const text = formatExportProfile(profiler.summarize());
    expect(text).toContain('mp4 export');
    expect(text).toContain('"fps":30');
    expect(text).toContain('png.encode');
  });

  it('reports payload throughput for a stage that carries bytes', () => {
    const profiler = createExportProfiler('test');
    profiler.record('ipc.writeFrame', 1000);
    profiler.recordBytes('ipc.writeFrame', 10 * 1024 * 1024);

    // 10MiB moved in 1s.
    expect(formatExportProfile(profiler.summarize())).toContain('rate=10.0MiB/s');
  });
});
