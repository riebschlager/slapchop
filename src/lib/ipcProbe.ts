/**
 * Throwaway IPC transport probe for Phase 2 of
 * `docs/architecture/video-export-performance.md`.
 *
 * Answers the question the Phase 0 baseline left open: a raw RGBA frame is
 * ~4x larger than the PNG it replaces, so removing PNG only pays off if a raw
 * Tauri body moves 8.29MB fast enough to keep a full-resolution export fed.
 * This measures both transport shapes against no encoder at all, which is the
 * ceiling the reworked pipeline would be built against.
 *
 * Run it from the devtools console in `npm run tauri dev`:
 *
 *   await __runIpcProbe()
 *
 * Delete this module and `src-tauri/src/ipc_probe.rs` once Phase 2 lands.
 */

import { createExportProfiler, formatExportProfile } from './exportProfiler';
import { isNative } from './native';

/** Uncompressed RGBA bytes for each export resolution. */
const FRAME_SIZES = [
  { label: '1080x1920', bytes: 1080 * 1920 * 4 },
  { label: '720x1280', bytes: 720 * 1280 * 4 },
  { label: '540x960', bytes: 540 * 960 * 4 }
];

/**
 * The JSON arm is orders of magnitude slower and allocates heavily, so it gets
 * fewer iterations. Both arms are timed per call, so the counts only affect
 * confidence, not comparability.
 */
const RAW_ITERATIONS = 30;
const JSON_ITERATIONS = 8;

/**
 * High-entropy bytes. Raw transport is content-independent, but the JSON path's
 * cost scales with the decimal width of each byte, and real PNG/compressed
 * payloads are close to uniform.
 */
function makePayload(bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes);
  // crypto.getRandomValues caps at 65536 bytes per call.
  for (let offset = 0; offset < bytes; offset += 65536) {
    crypto.getRandomValues(buffer.subarray(offset, Math.min(bytes, offset + 65536)));
  }
  return buffer;
}

export interface IpcProbeRow {
  transport: 'raw' | 'json';
  label: string;
  bytes: number;
  iterations: number;
  medianMs: number;
  meanMs: number;
  mibPerSecond: number;
}

export async function runIpcTransportProbe(): Promise<IpcProbeRow[]> {
  if (!isNative()) throw new Error('The IPC probe only runs in the Tauri app.');
  const { invoke } = await import('@tauri-apps/api/core');

  const report = async (line: string) => {
    console.info(`[ipc-probe] ${line}`);
    // Mirrored to stdout so a build without devtools can still be measured.
    await invoke('probe_report', { line }).catch(() => {});
  };

  const rows: IpcProbeRow[] = [];
  for (const { label, bytes } of FRAME_SIZES) {
    const payload = makePayload(bytes);

    for (const transport of ['raw', 'json'] as const) {
      const iterations = transport === 'raw' ? RAW_ITERATIONS : JSON_ITERATIONS;
      const send = transport === 'raw'
        // A payload that *is* a buffer view is sent as octet-stream untouched.
        // The job id would travel in a header in the real implementation.
        ? () => invoke<number>('probe_raw_frame', payload)
        // Nested in an object, so Tauri's replacer expands the view via
        // Array.from and JSON.stringify — today's native export shape.
        : () => invoke<number>('probe_json_frame', { jobId: 'probe', frame: payload });

      // Warm up once: the first call pays for protocol setup and JIT.
      const echoed = await send();
      if (echoed !== bytes) {
        throw new Error(`Probe echoed ${echoed} bytes for a ${bytes}-byte ${transport} payload.`);
      }

      const profiler = createExportProfiler(`${transport} ${label}`);
      for (let i = 0; i < iterations; i++) {
        profiler.recordBytes(transport, bytes);
        await profiler.timeAsync(transport, send);
      }
      const summary = profiler.summarize();
      const stage = summary.stages[0];
      rows.push({
        transport,
        label,
        bytes,
        iterations,
        medianMs: stage.medianMs,
        meanMs: stage.meanMs,
        mibPerSecond: (bytes / (1024 * 1024)) / (stage.medianMs / 1000)
      });
      console.info(formatExportProfile(summary));
    }
  }

  await report('transport  frame       MiB     median    MiB/s   implied fps');
  for (const r of rows) {
    await report(
      `${r.transport.padEnd(9)}  ${r.label.padEnd(10)}`
      + `  ${(r.bytes / (1024 * 1024)).toFixed(2).padStart(5)}`
      + `  ${r.medianMs.toFixed(2).padStart(8)}ms`
      + `  ${r.mibPerSecond.toFixed(1).padStart(7)}`
      + `  ${(1000 / r.medianMs).toFixed(1).padStart(11)}`
    );
  }

  // The decision criterion: transport alone must clear the frame rate, with
  // headroom, since rendering and encoding still have to fit in the budget.
  await report('--- raw transport vs. required frame rate ---');
  for (const r of rows.filter((row) => row.transport === 'raw')) {
    for (const fps of [30, 60]) {
      const budgetMs = 1000 / fps;
      const share = (r.medianMs / budgetMs) * 100;
      await report(
        `raw ${r.label} @ ${fps}fps: ${r.medianMs.toFixed(2)}ms of the `
        + `${budgetMs.toFixed(2)}ms frame budget (${share.toFixed(1)}%)`
        + (share < 100 ? '' : ' — TRANSPORT-BOUND')
      );
    }
  }
  return rows;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window as object, { __runIpcProbe: runIpcTransportProbe });
}
