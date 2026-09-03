# Video export benchmark protocol

- **Status:** Active
- **Date:** 2026-09-02
- **Baseline recorded:** 2026-09-02 (see below)
- **Scope:** Phase 0 baseline for
  [`video-export-performance.md`](./video-export-performance.md)

This is the repeatable measurement procedure that every later phase of the
video-export performance work is compared against. Phase 0 changes no export
behavior: it adds opt-in stage timing and this protocol, so that a codec or
transport change can be shown to help rather than assumed to.

## Enabling stage timing

Profiling is off by default and costs nothing when off — every instrumented
call site runs a pass-through no-op profiler.

- **Dev server:** append `?profileExport=1` to the URL, for example
  `http://localhost:3000/?profileExport=1`. Combine with `&renderer=2d` to
  profile the Canvas 2D path.
- **Packaged app / `npm run tauri dev`:** the document URL is fixed, so use the
  console instead:

  ```js
  __setExportProfiling(true)   // persists in localStorage
  __setExportProfiling(false)  // turn it back off
  ```

Run an export normally. When it finishes (or fails, or is cancelled) a summary
is printed to the console, most expensive stage first, and the structured
summary object is available as `__getLastExportProfile()` for scripted
collection.

Example:

```text
[export-profile] mp4 export
  context: {"exportType":"mp4","resolution":"1080x1920","fps":30,"duration":5,"renderer":"webgl","native":true,"previewPaused":true}
  frames: 150  elapsed: 42.10s  effective: 3.56 fps
  frame.render           n=  150  total=  18240.00ms (43.3%)  mean=  121.60ms  ...
  png.encode             n=  150  total=  15900.00ms (37.8%)  mean=  106.00ms  ...
  ...
```

The clock starts at the first recorded stage, not when the export button is
pressed, so time spent in the native save dialog does not deflate the effective
frames-per-second figure.

## Stages

| Stage | What it covers |
| --- | --- |
| `frame.render` | The whole `renderExportFrame` call — the sum of the four stages below on the GPU path, or the entire Canvas 2D draw on the fallback path. |
| `scene.sync` | Building the PixiJS scene graph for `(t, state)` at the export resolution. |
| `gpu.draw` | Submitting the draw into the reusable `RenderTexture`. |
| `gpu.readback` | `renderer.extract.pixels`. On WebGL this is where the queued draw actually completes, so it absorbs most GPU cost. |
| `canvas.copy` | `putImageData` into the caller-owned 2D canvas. |
| `png.encode` | `canvas.toBlob('image/png')` plus the Blob-to-`Uint8Array` conversion (native video only). |
| `ipc.writeFrame` | The Tauri invoke plus the Rust-side pipe write. Absorbs ffmpeg backpressure once the OS pipe buffer fills. |
| `loop.yield` | The unconditional per-frame `setTimeout` yield. |
| `ffmpeg.start` / `ffmpeg.finalize` | Process spawn, and the drain/trailer write after stdin EOF. |
| `webcodecs.submit` | `VideoFrame` construction and `encoder.encode` (queueing only). |
| `webcodecs.backpressure` | The browser encode-queue wait, which is where WebCodecs encoding time actually surfaces. |
| `webcodecs.flush` / `mux.finalize` | Encoder drain and in-memory muxing. |

Percentiles come from a bounded per-stage reservoir (4096 samples); count,
total, min, and max are exact for every frame. A `[sampled]` marker on a row
means its median/p95 are estimated from that reservoir.

## Benchmark scene set

Save these as `.slapchop` projects under a local (uncommitted) `benchmarks/`
directory so runs are comparable over time. Each should be visually busy enough
to be representative, not a degenerate best case.

1. **flat-2d** — a handful of solid-color polygon layers with simple motion. The
   low-entropy floor: PNG compresses well and the scene graph is cheap.
2. **grain-fx** — a 2D scene with Master FX grain, bloom, and chromatic
   aberration active. The high-entropy case that works hardest against PNG.
3. **gif-heavy** — GIF landscape or GIF Voronoi mode with several distinct GIFs
   animating. Stresses per-frame texture selection and produces noisy pixels.
4. **landscape-3d** — a 3D mode scene (mesh, flythrough, tunnel, or landscape)
   with camera motion. Stresses `scene.sync` and GPU draw rather than transport.
5. **prores-alpha** — a scene with a transparent background and soft-edged
   content, exported as ProRes 4444. The alpha reference for any encoder change.

## Run matrix

For each scene, with **preview paused** (the default) and no other heavy apps
running:

| Axis | Values |
| --- | --- |
| Format | MP4, WebM, ProRes (scene 5 only for ProRes) |
| Resolution | 1080x1920, 720x1280, 540x960 |
| Frame rate | 30, 60 |
| Duration | 5s |

A full sweep is large; the useful minimum per scene is 1080x1920@30 for all
three formats, plus 1080x1920@60 and 540x960@30 for MP4 to separate
pixel-bound from frame-bound cost. Discard the first run after launch — texture
upload and shader compilation land in the first few frames.

Also record one browser run per scene (`npm run dev`, MP4 via WebCodecs) and
one forced Canvas 2D run (`?renderer=2d&profileExport=1`) at 720x1280@30, so
the renderer-parity paths have a baseline too.

## What to record

Per run:

- scene, format, resolution, fps, renderer (`webgl` / `webgpu` / `canvas2d`);
- wall-clock elapsed and effective fps from the profile header;
- the top three stages by total time, with their share;
- output file size;
- peak process CPU and memory (Activity Monitor, or `/usr/bin/time -l` on the
  packaged binary).

Results table template:

| Scene | Format | Res | fps | Elapsed | Eff. fps | Top stage (%) | 2nd | 3rd | Size | Peak RSS |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: |
| | | | | | | | | | | |

## Recorded baseline (2026-09-02)

macOS arm64, `npm run tauri dev`, WebGL renderer, preview paused, 150 frames
(5s @ 30fps), MP4 / `libx264 medium` CRF 18.

| Res | Elapsed | Eff. fps | `ipc.writeFrame` | `png.encode` | `frame.render` |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1080x1920 | 52.83s | 2.84 | 275.05ms (78.1%) | 53.71ms (15.3%) | 20.33ms (5.8%) |
| 540x960 | 8.14s | 18.43 | 31.82ms (58.6%) | 14.34ms (26.4%) | 7.37ms (13.6%) |

Per-frame means. Rendering breaks down as `scene.sync` 11.15ms,
`gpu.readback` 8.05ms, `canvas.copy` 0.83ms, `gpu.draw` 0.28ms at 1080x1920.

### What the two rows establish

**Transport dominates, and the renderer is nearly free.** At full resolution,
frame production is 5.8% of the export. The GPU readback that Phase 4 of the
performance doc contemplates removing is 2.3%.

**The dominant stage is not the codec.** Quartering the pixel count cut
`ipc.writeFrame` by 8.6x — more than the 4x that a pixel-proportional cost
predicts, and far more than a fixed encoder cost per frame would allow. The
doc's encoder-only benchmark put `libx264 medium` at 97fps at this resolution,
so ffmpeg had roughly 10x headroom over the 2.84fps feed rate and could not
have been applying pipe backpressure. The timing distribution agrees: a tight
med 265 / p95 348 band, rather than the bimodal fast-then-stall signature of a
full pipe.

The mechanism is visible in the code. `write_native_video_frame` takes the
frame as a *named command argument*, so it is nested inside the invoke payload
object rather than sent as Tauri's raw `ArrayBuffer` request body, and is
therefore JSON-serialized per frame. `recordBytes('ipc.writeFrame', ...)` was
added after these runs so the next baseline reports actual PNG bytes and a
MiB/s figure, which will confirm the per-byte cost directly.

### Consequence for sequencing

Phase 1 (codec profiles) and Phase 2 (raw RGBA transport) were swapped for this
codebase on the strength of these rows. Phase 1 targets a stage that is not the
bottleneck at any tested resolution; Phase 2 targets `ipc.writeFrame` and
`png.encode` together — 93.4% of the full-resolution export — because raw
frames remove the PNG encode in JavaScript and the PNG decode inside ffmpeg at
the same time. See the sequencing decision in
[`video-export-performance.md`](./video-export-performance.md).

The remaining three scenes in the set above were not built out for Phase 0. The
two rows already satisfy the exit criterion for the dominant stage, and the
grain-heavy scene is more valuable afterwards as a Phase 2 validation case,
where its larger PNG frames should show an above-average improvement.

## Exit criteria

Phase 0 is done when, for each of the five scenes, the dominant stage is
identified from a recorded run and the run can be reproduced from this document
alone. Those numbers are the comparison baseline for Phase 1 codec profiles and
Phase 2 raw-pixel transport.

## Caveats

- Timings are wall-clock on the JS thread. WebGL's asynchronous draw submission
  means `gpu.draw` will look nearly free and `gpu.readback` expensive; read the
  two together as "GPU frame cost".
- `ipc.writeFrame` conflates IPC overhead with ffmpeg's own throughput, because
  a slow encoder blocks the pipe. A large `ipc.writeFrame` share is a signal to
  test codec settings (Phase 1) before assuming transport is at fault.
- `performance.now()` resolution is coarsened in some browsers; per-frame
  numbers below roughly 0.1ms are not meaningful, though totals still are.
