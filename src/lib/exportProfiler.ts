/**
 * Opt-in stage timing for the export pipelines.
 *
 * Phase 0 of `docs/architecture/video-export-performance.md`: before any codec
 * or transport change, we need to know which stage actually dominates a given
 * scene. This module is a measurement tool, not a product feature — it is off
 * unless explicitly enabled, and when off every entry point is a direct
 * pass-through so instrumented code pays nothing.
 *
 * Timing here is wall-clock per stage, measured on the JS thread. On the WebGL
 * path that has a specific consequence worth remembering when reading results:
 * `renderer.render()` only queues GPU work, so the cost of the draw shows up
 * in the following `extract.pixels` readback, which is what synchronizes.
 */

/** Per-stage percentile sample budget. Count/total/min/max stay exact. */
const SAMPLE_CAPACITY = 4096;

export interface StageStats {
  stage: string;
  count: number;
  totalMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  /** True when percentiles come from a bounded sample rather than every call. */
  sampled: boolean;
}

export interface PayloadStats {
  name: string;
  count: number;
  totalBytes: number;
  meanBytes: number;
  medianBytes: number;
  p95Bytes: number;
  maxBytes: number;
  sampled: boolean;
}

export interface ExportProfileSummary {
  label: string;
  context: Record<string, string | number | boolean>;
  /**
   * Wall-clock time from the first recorded stage to `summarize()`. The clock
   * starts lazily so a native save-dialog wait between `beginExportProfile`
   * and the first frame does not deflate `effectiveFps`.
   */
  elapsedMs: number;
  frames: number;
  /** Frames divided by elapsed wall time, or 0 before any frame is counted. */
  effectiveFps: number;
  stages: StageStats[];
  /** Byte volumes moved per frame, for reasoning about transport cost. */
  payloads: PayloadStats[];
}

export interface ExportProfiler {
  readonly enabled: boolean;
  /** Time a synchronous stage and return its result. */
  time<T>(stage: string, fn: () => T): T;
  /** Time an asynchronous stage and return its result. */
  timeAsync<T>(stage: string, fn: () => Promise<T>): Promise<T>;
  /** Record a duration measured elsewhere. */
  record(stage: string, ms: number): void;
  /** Record a payload size, so transport cost can be read per byte. */
  recordBytes(name: string, bytes: number): void;
  /** Count one produced frame, for the effective-fps figure. */
  countFrame(): void;
  summarize(): ExportProfileSummary;
}

class NoopExportProfiler implements ExportProfiler {
  readonly enabled = false;
  time<T>(_stage: string, fn: () => T): T {
    return fn();
  }
  timeAsync<T>(_stage: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  record(): void {}
  recordBytes(): void {}
  countFrame(): void {}
  summarize(): ExportProfileSummary {
    return {
      label: 'disabled',
      context: {},
      elapsedMs: 0,
      frames: 0,
      effectiveFps: 0,
      stages: [],
      payloads: []
    };
  }
}

const NOOP_PROFILER = new NoopExportProfiler();

/** Unit-agnostic: holds milliseconds for stages and bytes for payloads. */
interface Accumulator {
  count: number;
  total: number;
  min: number;
  max: number;
  samples: number[];
}

/** Nearest-rank percentile over an already-sorted ascending array. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

class RecordingExportProfiler implements ExportProfiler {
  readonly enabled = true;
  private readonly stages = new Map<string, Accumulator>();
  private readonly payloads = new Map<string, Accumulator>();
  private startedAt: number | null = null;
  private frames = 0;

  constructor(
    private readonly label: string,
    private readonly context: Record<string, string | number | boolean>,
    /** Injectable for deterministic tests of the reservoir path. */
    private readonly random: () => number = Math.random
  ) {}

  time<T>(stage: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.record(stage, performance.now() - start);
    }
  }

  async timeAsync<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.record(stage, performance.now() - start);
    }
  }

  record(stage: string, ms: number): void {
    if (this.startedAt === null) this.startedAt = performance.now() - ms;
    this.add(this.stages, stage, ms);
  }

  recordBytes(name: string, bytes: number): void {
    this.add(this.payloads, name, bytes);
  }

  private add(into: Map<string, Accumulator>, name: string, value: number): void {
    let acc = into.get(name);
    if (!acc) {
      acc = { count: 0, total: 0, min: Infinity, max: 0, samples: [] };
      into.set(name, acc);
    }
    acc.count++;
    acc.total += value;
    if (value < acc.min) acc.min = value;
    if (value > acc.max) acc.max = value;

    // Reservoir sampling keeps percentiles representative of the whole export
    // without retaining a sample per frame for an arbitrarily long render.
    if (acc.samples.length < SAMPLE_CAPACITY) {
      acc.samples.push(value);
    } else {
      const slot = Math.floor(this.random() * acc.count);
      if (slot < SAMPLE_CAPACITY) acc.samples[slot] = value;
    }
  }

  countFrame(): void {
    if (this.startedAt === null) this.startedAt = performance.now();
    this.frames++;
  }

  summarize(): ExportProfileSummary {
    const elapsedMs = this.startedAt === null ? 0 : performance.now() - this.startedAt;
    const stages: StageStats[] = [];
    for (const [stage, acc] of this.stages) {
      const sorted = [...acc.samples].sort((a, b) => a - b);
      stages.push({
        stage,
        count: acc.count,
        totalMs: acc.total,
        meanMs: acc.total / acc.count,
        medianMs: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        minMs: acc.min === Infinity ? 0 : acc.min,
        maxMs: acc.max,
        sampled: acc.count > acc.samples.length
      });
    }
    const payloads: PayloadStats[] = [];
    for (const [name, acc] of this.payloads) {
      const sorted = [...acc.samples].sort((a, b) => a - b);
      payloads.push({
        name,
        count: acc.count,
        totalBytes: acc.total,
        meanBytes: acc.total / acc.count,
        medianBytes: percentile(sorted, 0.5),
        p95Bytes: percentile(sorted, 0.95),
        maxBytes: acc.max,
        sampled: acc.count > acc.samples.length
      });
    }
    payloads.sort((a, b) => b.totalBytes - a.totalBytes);
    // Most-expensive stage first: the whole point of the phase is to identify
    // the dominant one per scene.
    stages.sort((a, b) => b.totalMs - a.totalMs);
    return {
      label: this.label,
      context: { ...this.context },
      elapsedMs,
      frames: this.frames,
      effectiveFps: elapsedMs > 0 ? (this.frames * 1000) / elapsedMs : 0,
      stages,
      payloads
    };
  }
}

/** Test seam: build a recording profiler regardless of the runtime flag. */
export function createExportProfiler(
  label: string,
  context: Record<string, string | number | boolean> = {},
  random?: () => number
): ExportProfiler {
  return new RecordingExportProfiler(label, context, random);
}

export function formatExportProfile(summary: ExportProfileSummary): string {
  const ms = (n: number) => `${n.toFixed(2)}ms`;
  const lines = [
    `[export-profile] ${summary.label}`,
    `  context: ${JSON.stringify(summary.context)}`,
    `  frames: ${summary.frames}  elapsed: ${(summary.elapsedMs / 1000).toFixed(2)}s`
      + `  effective: ${summary.effectiveFps.toFixed(2)} fps`
  ];
  for (const s of summary.stages) {
    const share = summary.elapsedMs > 0 ? (s.totalMs / summary.elapsedMs) * 100 : 0;
    lines.push(
      `  ${s.stage.padEnd(22)} n=${String(s.count).padStart(5)}`
      + `  total=${ms(s.totalMs).padStart(11)} (${share.toFixed(1)}%)`
      + `  mean=${ms(s.meanMs).padStart(9)}  med=${ms(s.medianMs).padStart(9)}`
      + `  p95=${ms(s.p95Ms).padStart(9)}  max=${ms(s.maxMs).padStart(9)}`
      + (s.sampled ? '  [sampled]' : '')
    );
  }
  for (const p of summary.payloads) {
    const mib = (n: number) => `${(n / (1024 * 1024)).toFixed(2)}MiB`;
    // Throughput of the stage that moves this payload, when they share a name.
    const carrier = summary.stages.find((s) => s.stage === p.name);
    const rate = carrier && carrier.totalMs > 0
      ? `  rate=${(p.totalBytes / (1024 * 1024) / (carrier.totalMs / 1000)).toFixed(1)}MiB/s`
      : '';
    lines.push(
      `  ${p.name.padEnd(22)} n=${String(p.count).padStart(5)}`
      + `  total=${mib(p.totalBytes).padStart(11)}`
      + `  mean=${mib(p.meanBytes).padStart(9)}  med=${mib(p.medianBytes).padStart(9)}`
      + `  max=${mib(p.maxBytes).padStart(9)}${rate}`
      + (p.sampled ? '  [sampled]' : '')
    );
  }
  return lines.join('\n');
}

// --- Runtime session wiring -------------------------------------------------
//
// The flag is read from the URL (`?profileExport=1`) or from localStorage
// (`slapchop:profile-export`). The URL form is convenient in `npm run dev`;
// the localStorage form is the only one that works in the packaged Tauri app,
// where the document URL is fixed — and a packaged build is exactly where the
// numbers that matter get measured.

const PROFILE_STORAGE_KEY = 'slapchop:profile-export';

export function isExportProfilingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('profileExport');
  if (param !== null) return param !== '0' && param !== 'false';
  try {
    return window.localStorage.getItem(PROFILE_STORAGE_KEY) === '1';
  } catch {
    // Private-mode / blocked storage: profiling stays off rather than throwing
    // out of an export path.
    return false;
  }
}

/** Set the localStorage flag. Exposed on `window` in dev for console use. */
export function setExportProfilingEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(PROFILE_STORAGE_KEY, '1');
    else window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    console.warn('Could not persist the export profiling flag.');
  }
}

let activeProfiler: ExportProfiler = NOOP_PROFILER;
let lastSummary: ExportProfileSummary | null = null;

/**
 * Start a profile for one export run. Returns the profiler and a finish
 * callback; callers must invoke the callback (in a `finally`) so the renderer
 * stops reporting into a stale session.
 */
export function beginExportProfile(
  label: string,
  context: Record<string, string | number | boolean> = {}
): { profiler: ExportProfiler; finish: () => ExportProfileSummary | null } {
  if (!isExportProfilingEnabled()) {
    return { profiler: NOOP_PROFILER, finish: () => null };
  }
  const profiler = createExportProfiler(label, context);
  activeProfiler = profiler;
  let finished = false;
  return {
    profiler,
    finish: () => {
      if (finished) return lastSummary;
      finished = true;
      const summary = profiler.summarize();
      if (activeProfiler === profiler) activeProfiler = NOOP_PROFILER;
      lastSummary = summary;
      console.info(formatExportProfile(summary));
      return summary;
    }
  };
}

/**
 * The profiler for the export currently in flight, or a no-op. Lets the
 * renderer report its own stages without threading a profiler through
 * `renderExportFrame` and every mode's draw path.
 */
export function getExportProfiler(): ExportProfiler {
  return activeProfiler;
}

export function getLastExportProfile(): ExportProfileSummary | null {
  return lastSummary;
}

if (typeof window !== 'undefined') {
  Object.assign(window as object, {
    __setExportProfiling: setExportProfilingEnabled,
    __getLastExportProfile: getLastExportProfile
  });
}
