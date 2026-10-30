# GIF Paint performance and replay architecture

Measured October 25, 2026 in the local macOS in-app browser. These are synthetic
compositor measurements, not a frame-rate guarantee for every GPU or GIF library.

## Rendering and compatibility

The document retains every editable path. Consecutive static paths flatten into
one cropped background per uninterrupted static run. Active and fading paths keep
their own cropped surfaces between those backgrounds, preserving stack order and
per-stamp opacity. Normal forward accumulation only deposits new stamps; those
surfaces never participate in LRU eviction. Undo, editing, hiding, deletion,
reordering, asset changes, output resizing, and backward seeks reconcile or rebuild
the affected caches from the original paths.

A separate 4-million-pixel LRU stores pre-masked GIF frames, shared by source frame
and brush geometry (opacity and scatter apply when depositing). Eviction rebuilds
only a small stamp image. Static runs release stamp images after flattening. All
surfaces release their backing stores on invalidation and destruction. One stamp
image is permitted above that budget for unusually large output sizes.

Pre-masking also avoids a browser clipping/batching discrepancy found during pixel
QA: the initial direct-clipping implementation could render different brush edges
when identical operations were divided across frames. Stamp-image compositing
reduces sequential/direct-seek differences to less than one premultiplied channel
level in the mixed-pattern browser fixture. Initial V12 edge antialiasing can
change slightly; GIF source times, opacity, scatter, linear fade and replay timing
are unchanged.

New manual gestures always commit with replay disabled. Only a selected saved path
can be activated in the inspector. The first activation starts the shared clock;
later activations join that timeline, including reconstruction of prior deposits.
Deactivation restores original hand-painted stamps; Restart explicitly clears
replay accumulation. V12 replay flags and positive lifetimes remain readable and
round-trip without migration. Positive legacy lifetimes also fade original paint
when replay is disabled. Animation export reconstructs from replay time zero.

Linear fading redraws the live lifetime window with cached stamps. It cannot be
replaced by a single exponential-decay surface without changing overlap/opacity.
Forward jumps skip already-expired deposits. Binary search finds only new dabs
within the relevant replay passes, avoiding full-path scans on warm frames.

The Canvas compositor remains shared between Pixi and Canvas 2D. Pixi only uploads
a changed composite. GPU render targets were deferred: incremental deposits and
stamp sharing remove the measured cliff without introducing another brush
rasterization implementation. Active full-frame uploads remain a possible GPU
bottleneck and are not included in the compositor timings below.

## Reproduce

Run `npm run dev`, then open `/scripts/paint-benchmark.html` and choose **Run
benchmark** or **Verify seek pixels**. An optional `?baseline=/baseline.mjs` can
load a locally captured module exporting the old `PaintRenderer`. The measured
baseline was captured from the initial implementation before these changes.

The fixture uses 1080 × 1920 output, three 128 × 96 animated source frames with
transparent holes, five brush patterns, size 180, opacity 0.7, seeded scatter,
and 31 recorded points per path. It seeks to time 60, flushes that cold render,
then measures 12 forward frames at 60 Hz, including synchronous raster readback.
Some samples contain no new deposits; static median times round to zero.
Cold seek time includes reconstruction and readback. The short run and other
local workloads make timings approximate; operation counts and rebuild counters
provide the stable regression signal.

## Results

| Paths | Static stamp draws/frame, old → new | All-active draws/frame, old → new | All-active median ms, old → new | New active p95 ms |
| --- | ---: | ---: | ---: | ---: |
| 8 | 0 → 0 | 5.33 → 5.33 | 8.1 → 5.6 | 12.2 |
| 9 | 315 → 0 | 19258.5 → 6 | 128.6 → 6.8 | 12.2 |
| 16 | 560 → 0 | 34237.3 → 10.67 | 226.2 → 6.7 | 14.7 |
| 32 | 1120 → 0 | 68474.7 → 21.33 | 450.4 → 9.9 | 16.1 |

| Paths | Four active: median ms, old → new | All active, 0.5s trails: median ms, old → new | Static cache MiB | Active cache MiB |
| --- | ---: | ---: | ---: | ---: |
| 8 | 8.9 → 5.1 | 7.5 → 6.5 | 2.34 | 5.7 |
| 9 | 71.8 → 6 | 12.6 → 6.5 | 3.08 | 6.32 |
| 16 | 70.5 → 6.1 | 18 → 7.3 | 3.82 | 11.41 |
| 32 | 76.7 → 6.8 | 26 → 8.1 | 6.77 | 22.82 |

Every current forward-playback case reported **zero history rebuilds**. All static
cases performed zero warm stamp draws and no composite changes. Every active
fixture had zero warm mask builds after brush geometry/frame sharing. The stamp
image cache occupied 3.78 MiB for all-active cases (separate from surface totals).

At 32 active paths the cold time-60 seek took 258.3 ms.
A separate 32-path full-stage spread used 252.33 MiB of cropped
surfaces and measured 17.7 ms median / 126.4 ms p95,
again with zero forward history rebuilds. Full-stage composition remains expensive.

Memory figures estimate RGBA surface backing stores, excluding decoded GIF frames,
the final output canvas, GPU copies, browser allocation overhead and undo history.
They are not process RSS measurements.

## Limits and validation

No extra active-brush count cap was added. The representative 32-path painting is
practical; full-stage bounds, unique brush styles, GIF frame count, and live trail
density are better predictors of cost than path count alone. The existing
256-path document bound remains. Many full-stage active paths can consume hundreds
of MiB and hitch; long cold seeks still reconstruct accumulated history and can
block. Exact trails remain proportional to the live deposit count. Manual draft
preview still resamples/redraws the unfinished gesture; this work optimizes saved
painting and active-path playback, not that separate gesture-preview cost.

Unit tests cover 8/9/16/32 static and active paths for 120 warm forward frames,
new-deposit counts, cache-pressure mask eviction without history rebuilding,
shared stamp ownership, seek/restart, fading, stack changes, invalidation,
destruction, static gesture defaults, V12 round-trip, undo, and logarithmic dab
lookup on a 10,001-dab path.

The browser pixel fixture covers five patterns, rotation, zoom, scatter, opacity,
mixed static/active ordering, fading, forward seeks, and backward seeks. It passed
with a maximum premultiplied-channel difference below 1 (tolerance 2).

The development-only `/scripts/paint-smoke.html` mounts the production app with a
generated animated GIF. It captures the download boundary in memory because OS
file choosers are unavailable to the test browser, then exercises the production
`saveProject` / `openProject` and GIF encoder/decoder. Both default WebGPU and
`?renderer=2d` passed painting, saved-path editing, undo/redo, activation, Restart,
V12 save/open, and a 0.5-second five-frame export. A 32-active-path painting at
replay time 60 also rendered and exported in both backends; both encoded GIFs
were 359,054 bytes. No browser console errors were recorded. Native Tauri dialogs
and packaging were not exercised; no native implementation changed.

Final validation: `npm run typecheck`, `npm run lint`, `npm test` (425 tests in
46 files), and `npm run build` all passed. The build reports non-blocking large
chunk and mixed static/dynamic import warnings. No dependencies or native files
changed. `git diff --check` passed.

## October 26, 2026: interaction, autopaint, and scaling audit

This section evaluates the current implementation, including autopaint. It is a
recommendation, not an implemented renderer redesign. The October 25 results above
remain historical measurements of their original fixture.

### Method and limits

The new development-only `/scripts/paint-performance-audit.html` exercises the
production `PaintRenderer`, `renderFrame`, and `PixiSceneRenderer`. Run one suite at
a time; use a fresh page for presentation measurements. `?renderer=webgl` selects
the desktop-style GPU backend in Chrome, **not WKWebView itself**.

Environment: local macOS in-app browser, Chrome 156, PixiJS 8.19.0, 1080 × 1920,
Master FX disabled. Interaction tests use 30 forward samples; presentation tests
use 30 or 60 animation-frame samples. Synthetic sources deliberately share a small
source image to isolate path/compositor cost; the focused cache-pressure case uses
120 distinct frames and 32 brush rotations. These are short synthetic workloads,
not representative real-folder decode benchmarks or native input-latency tests.
Timers are quantized; readings of 0 ms mean below measurement resolution.

Two timing methods are recorded separately:

- **Submission plus forced raster completion:** `render()` followed by a 1 × 1
  `getImageData()` read. Useful for accounting for queued work and export-like
  synchronization; unsuitable as a direct live-FPS prediction.
- **Presentation:** draw to a displayed canvas on successive animation frames,
  with no synchronous pixel readback. Record JS submission and callback intervals.
  These intervals indicate scheduling/throughput, not measured pen-to-photon
  latency or isolated GPU execution time.

The distinction mattered. A presentation run after the large readback workload
reported about 100 ms for the moving draft; fresh-page presentation runs with the
same fixture took about 1–2 ms of JS work and maintained an approximately 8.3 ms
callback cadence. Browser raster/backend/resource state is a confounder; this audit
did not prove which heuristic caused the difference. Do not report the slower run
as ordinary drawing latency or claim that a backend change alone fixes it.
[Canvas context attributes](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)
can affect acceleration, and repeated readback is itself an intrusive measurement.

### What was measured

Clean presentation results, median JS submission / p95 in milliseconds:

| Workload | WebGPU | WebGL | Median callback interval |
| --- | ---: | ---: | ---: |
| 128 settled static strokes | 0.2 / 1.0 | 0.2 / 0.8 | 8.3 ms |
| 128 saved strokes + a 484-dab moving draft | 1.4 / 2.9 | 1.6 / 1.8 | 8.3 ms |
| 32 full-stage active paths | 0.6 / 0.8 | 0.5 / 0.6 | 8.3 ms |
| 60-second stationary draft, 1,801 dabs | 3.1 / 3.5 | 3.2 / 3.4 | 8.3 ms |
| Dense moving draft, 7,259 dabs | 12.7 / 15.3 | 12.5 / 14.7 | 15.1–16.3 ms |
| Eight active paths, 10-second linear lifetime | 1.6 / 1.7 | 1.6 / 1.7 | 8.3 ms |
| Fast, dense autopaint, 10-second lifetime | 67.1 / 72.8 | 65.2 / 70.7 | 66.7 ms |

The dense manual brush uses size 24 and spacing 0.1 on an approximately 17,400-pixel
path. The autopaint stress case uses size 24, spacing 0.1, duration 0.15 seconds,
no pause, reach 1,800, and lifetime 10 seconds. It is an allowed extreme rather
than the default. Its 30 frames drew 1,166,893 stamps: about 38,896 per update.
The same dense manual draft drew all 7,259 stamps on **each** of 30 updates.
The 60-second stationary draft redrew 54,030 stamps across those updates even
though its recorded input did not change during the test.

Additional observations from the forced-completion tests:

- Settled 32/128/256-stroke paintings performed zero warm stamp draws, stamp
  builds, history rebuilds, and composites. Their common static-group bounds used
  about 6.51 MiB. Many saved strokes are already cheap while left unchanged.
- Appending after 32/128/255 short strokes redrew 363/1,419/2,816 stamps. A new
  stroke alone contained 11 dabs. The 256th commit took 20.3/20.5/22.2 ms in three
  focused repetitions, including raster synchronization. This is a pen-up rebuild
  measurement, not a measured end-to-end pen-up delay.
- Editing one old stroke in a 128-stroke static run redrew all 1,408 stamps.
  Adding an unused source did the same because asset-array identity invalidates
  every paint cache.
- Full-stage bounds for 32 active paths used about 251.89 MiB of accumulation
  surfaces, before final output, GPU texture, decoded GIFs, browser overhead, and
  export resources. This allocation is independent of whether the GPU presents
  the simple synthetic fixture quickly.
- Default accumulating autopaint used one 7.91 MiB surface. Active forward
  playback at time 600.6 deposited nine new stamps in 30 frames and did not
  reconstruct history. A separate time-600 sample fell entirely inside a pause;
  its zero work must not be mistaken for the active case.
- Cold default-autopaint reconstruction at 60/600/3,600 seconds took
  76.5/636.8/4,153.8 ms, including raster completion. It drew 453/4,164/26,041 stamps.
  Steady accumulation has bounded surface storage; cold reconstruction work grows
  with elapsed time. Configuration edits discard that surface and reconstruct at
  the current time, so old sessions can make inspector scrubbing expensive.
- In the large unique-brush cache-pressure case, all 32 new deposits required
  rebuilding stamp images. The 4-million-pixel LRU prevents unbounded stamp-image
  growth but can churn when rotations, source frames, and large brushes vary.

The existing playback benchmark was also rerun: unchanged static cases still
performed zero raster work, warm replay cases had zero history rebuilds, and the
seek-pixel verifier passed (maximum premultiplied-channel difference below 1,
no pixels over tolerance 2). Its fixture differs from this audit; absolute timing
numbers should not be mixed across fixtures.

### Why the costs grow

**The draft is not incremental.** `renderer.ts` rebuilds its brush mask, calls
`buildPaintDabs()` over the entire recorded path, allocates `originalStamps()`, and
redraws the entire gesture whenever a draft exists. A stationary, unchanged draft
also forces this every display frame. It then clears and recomposites saved
surfaces. At a stable deposition rate, per-frame work grows with gesture length;
total work over a long gesture can grow quadratically with its duration.

**Flattening is invalidated by append.** Static-run reuse requires exactly the
same stroke count and stroke object identities. Adding one stroke changes the
run, so every old path is resampled and restamped. Over many equal-sized commits,
this accumulates approximately quadratic rebuild work. Ordinary settled playback
avoids that work, which is why idle-only benchmarks miss the interaction problem.

**Dynamic pixel work depends on coverage and density.** Every changed composite
clears the final full-size canvas and draws all cached surfaces. Each active path
owns a rectangular cache: a thin diagonal or looping path can have almost
full-stage bounds despite sparse paint. Fading clears and redraws every live
stamp, including stamps whose birth and position have not changed.

For a moving path of length D, brush width B, and spacing fraction s, stamp count
is approximately D / (B × s), plus stationary holds at 30 stamps/second. Nominal
stamp pixel area grows with B², so a larger brush can have fewer calls but more
pixel work. Fading adds a live-stamp count proportional to deposition rate ×
lifetime. Count, fill area, lifetime, overlap, source variety, and cache misses
matter more than saved-path count alone.

**The GPU path still uses the Canvas compositor.** Pixi receives the completed
canvas as one texture, updating it when the paint revision changes. A full
1080 × 1920 RGBA image is 7.91 MiB; updating at 60 Hz represents about 475 MiB/s
of logical image data. This is not measured bus traffic: browsers may use shared
or accelerated surfaces. No partial texture updates are requested by this code.
Clean simple cases were fast, so this audit does **not** establish texture upload
as their dominant bottleneck. Dense replay has substantial Canvas/JS work before
Pixi can present it.

**Memory extends beyond paint surfaces.** GIF import eagerly decodes all frames
into full-size ImageBitmaps. A 512 × 512, 100-frame GIF represents about 100 MiB of
RGBA pixels; 20 such GIFs represent roughly 1.95 GiB before extra copies. The
256-source bound is not a memory budget. Undo structurally shares paths and
assets rather than deep-copying every document, but it deliberately retains
otherwise removed sources until no history needs them. Library thumbnails also
use animated GIF `<img>` elements, potentially adding browser-side animation and
decoding work. Decode time, real-folder memory, and thumbnail cost were inspected
in code, not measured in this synthetic audit.

Secondary CPU work includes per-frame group construction and potentially
quadratic cache matching across active groups, twice-per-frame stamp-owner
pruning, linear asset lookup and string key construction per stamp, and temporary
arrays/objects. Autopaint additionally regenerates paths and dabs and re-sorts the
folder palette while revisiting a gesture on successive frames. These deserve
profiling after redundant raster work is removed; optimizing the existing binary
GIF-frame lookup or adding React memoization is unlikely to be the first win.

### Recommended sequence

1. **Make manual drawing and append incremental first.** Maintain a persistent
   draft surface with a point/sample revision, last processed segment, spacing
   carry, hold-frame cursor, and stable dab indices. Deposit only new dabs; skip
   work if no sample or hold deposit changed. Retain original event/source timing.
   Appending at the top of an unchanged static run should add only the new stroke
   to its raster cache, growing or copying bounds only when required. Preserve
   undoable source paths independently of the cache. Test operation counts, not
   brittle millisecond assertions. This directly fixes both growth patterns
   without requiring a second brush renderer.
2. **Make invalidation local and rebuilding interruptible.** Reuse per-stroke
   geometry/dabs across group changes; key source dependencies by used asset
   identity, not the whole library array. Cache the render-group plan until the
   stroke array changes. Cache autopaint's seeded palette and current gesture.
   Add bounded checkpoints and cancellable background reconstruction for undo,
   seeks, and long sessions. Checkpoints help the same configuration; changing
   opacity/geometry retroactively still invalidates affected pixels. Keep drawing
   responsive while an older painting rebuilds, and swap only a completed current
   generation into view.
3. **Prototype a retained GPU paint backend for dense animation.** Issue ordered
   stamp commands into persistent render textures or tiles, with batched quads,
   source-frame atlases/multi-texture batches, brush masks, and per-instance
   position, pressure, alpha, and birth time. Update accumulated paint only for
   new deposits; keep raster output on the GPU. Do not retain every historic dab
   as a scene-graph object or allocate a full-size texture per stroke. Exact
   fading still draws the live window; batching removes much of its JS command
   overhead but does not remove fill-rate cost. GPU masks, edge sampling, and
   premultiplied alpha require reference-pixel checks and an explicit compatibility
   decision for any intentional visual changes. Test WebGL as well as WebGPU.
   [Pixi's batching guidance](https://pixijs.com/8.x/guides/concepts/performance-tips)
   and [texture caching guidance](https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture)
   support this approach; simply toggling `cacheAsTexture` on every dynamic stroke
   is not the proposed design.
4. **Budget memory in bytes and cache touched tiles.** Use, for example, 256- or
   512-pixel tiles and a spatial index for editable paths, with a measured surface
   budget rather than an active-path-count cap. Rebuild only tiles touched by an
   edit, and maintain bounded prefix/chunk checkpoints for order and undo. Tiling
   helps sparse bounds; many full-stage animated layers still require substantial
   storage or recomputation. Maintain separate budgets for decoded frames, stamp
   masks, accumulated paint, undo checkpoints, and export. Add reference-counted
   frame ownership, lazy/worker decoding, decode checkpoints for GIF disposal,
   preview-sized frame variants, and static or visible-only thumbnails.
5. **Offer preview resolution independently of document/export resolution.** At
   540 × 960, pixel area is one quarter of full resolution. Actual speedup depends
   on whether calls or pixels dominate. Keep 1080 × 1920 coordinates and original
   timed paths, select preview resolution at a stable boundary, and render exports
   at full quality. Keep spacing/timing semantics exact unless approximation is
   explicitly a preview-only mode. Feature-detect worker rendering through
   [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas).
   Workers improve main-thread responsiveness; they do not eliminate excessive
   stamps or memory use. Coalesced pointer events can improve input fidelity
   [where available](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents);
   they need a fallback and correct original timestamps.

If product semantics can change, two options are particularly valuable:

- **Apply autopaint changes to future gestures.** Record deterministic parameter
  segments/events instead of retroactively rebuilding the entire painting on
  every slider update. Keep an explicit rebuild-all action for users who want
  retroactive editing. Persist and version this timeline behavior.
- **Offer a cheaper trail aesthetic.** Fade a retained accumulation surface or
  quantized time cohorts instead of independently fading every overlapping stamp.
  This changes alpha/overlap behavior. A simple exponential canvas decay does not
  preserve the current exact linear per-stamp fade and must be an explicit new
  look, not a transparent optimization.

A native Metal/wgpu/Skia renderer remains an option for a desktop-focused product,
with direct GPU texture management and worker/job scheduling. It is a large
browser/native parity, input, GIF-decoding, and export maintenance commitment;
retain a shared deterministic command model if pursuing it. Rust/WASM for path
math alone does not address redundant rasterization, full-surface composition, or
texture transfer. I would choose a measured retained-GPU prototype inside the
existing app before a native rewrite.

### Acceptance criteria and remaining measurements

Before raising the 256-stroke limit, make append cost proportional to new dabs,
make draft work proportional to newly recorded input, and ensure no-change frames
perform zero paint raster work. Keep geometry/source order, stationary GIF timing,
undo boundaries, saved-project round trips, seek reconstruction, and exact linear
fade under pixel tests. Record cache bytes and new-stamp counts alongside timing.

Use real imported libraries, overlapping translucent brushes, mixed static and
active ordering, maximum-size brushes, and 32/128/256-stroke projects. Measure
p95/p99 input-to-visible latency, pen-up hitches, memory plateau, and frame cadence
separately. Add 30-minute autopaint runs with seeks and inspector edits. Measure
actual WKWebView on the target Mac, GPU work/transfer through a platform trace,
Master FX, and simultaneous live output/export. The GPU painter currently serves
live and export times/resolutions through one instance; browser exports or live
output can prevent preview suspension and cause cache invalidation or backward
reconstruction. Separate renderer sessions before measuring concurrent export.

Proposed budgets, to be validated rather than treated as achieved guarantees:
60 Hz as the baseline, 120 Hz as an optional high-refresh target, paint submission
p95 below about 4 ms in the normal drawing envelope, and no synchronous history
reconstruction on pointer-up. Use byte budgets with graceful quality/rebuild
policies rather than promising unlimited active paint on arbitrary hardware.

This audit adds only the development benchmark and this documentation. Existing
application changes, including autopaint, are not rewritten by the audit.

## October 26, 2026: recommendation 1 implementation

Manual drawing now keeps one persistent draft surface. An append-only
`PaintDabCursor` retains the processed sample count (the draft revision), distance
spacing carry, hold start/frame cursor, and next dab index. It processes only new
recorded segments and preserves original sample timestamps, GIF source offsets,
30 Hz stationary holds, and seeded scatter. Display time does not synthesize
input. Samples producing no new dabs skip raster work for accumulating brushes;
unchanged drafts skip stamp draws, mask builds, compositing, and revision changes.
The draft surface is released on cancellation, commit, replacement, resize,
source invalidation, clear, and destruction. It adds one output-sized RGBA surface
while drawing (7.91 MiB at full resolution), included in `cachedPixels`.

There are two deliberate compatibility exceptions to deposit-only updates.
Positive draft lifetime already fades earlier deposits relative to the recorded
gesture duration; it now samples incrementally but redraws only retained live
dabs when input changes. A carried-over `constantSpeed` brush option retimes prior
GIF captures using the entire path's distance and duration. That preview rebuilds
when samples change to preserve existing behavior. Both skip unchanged samples.
Changing those semantics belongs in a separate product decision.

Appending to an unchanged top static run reuses its cropped raster. Only new
strokes are sampled and stamped. Bounds grow by copying existing pixels at an
integer output-pixel offset; contained additions allocate no new run surface.
The optimization requires an unchanged document prefix and static-run prefix,
so edits, hides, reorders, undo, source replacement, and seeks continue to use
normal invalidation/reconstruction. Source paths remain authoritative and undoable;
no project fields, versions, renderer backends, dependencies, or native files
changed. Pointer-up still samples and draws the newly committed stroke once; it
no longer resamples/restamps the preceding static run. Bounds growth can still
require a synchronous surface copy.

### Verification

Operation-count unit tests cover append after 32/128/255 saved strokes, append
above active paint, contained versus expanded bounds, undo reconstruction,
incremental spacing/holds/source timing, constant-speed compatibility, fading,
replacement, resize, source invalidation, cancellation, and resource release. A
1,001-sample dense gesture draws exactly its total dab count over its entire
preview, then performs no raster work on 30 unchanged frames. The sampler test
also verifies that appending does not read earlier segments.

The development benchmark now has **Verify incremental drawing**. Its 195 pixel
comparisons cover all five patterns, fractional positions, rotation, zoom,
scatter, translucent overlapping saved paint, stationary holds, lifetime,
constant-speed timing, append, undo/redo, reorder, hide, and bounds growth.
Incremental drafts matched freshly reconstructed retained drafts exactly.
Appending after 32/128/255 strokes drew **61 new stamps in every case**, with zero
history rebuilds; comparison with fresh reconstruction differed by at most 1
premultiplied channel value. These fixtures ran at 270 × 480 to bound readback
cost; their full-stage run surface occupied 518,400 bytes. They are correctness
and operation-count checks, not new latency or full-resolution memory benchmarks.

**Preview compatibility decision:** compositing a retained transparent draft as
one layer can round translucent overlap pixels differently from stamping each dab
directly onto saved paint. Against the old direct-draft path, the fixture's maximum
premultiplied-channel difference was 3.969/255 (tolerance 4); this small preview-only
rounding change is accepted. Saved-path rendering and export timing retain their
existing semantics. The existing seek-pixel verifier also passed, with maximum
difference below 1 and no pixels over tolerance 2.

Production-app smoke tests passed on default WebGPU and `?renderer=2d`: generated
animated GIF import, manual drawing and static append, undo/redo, V12 save/open,
and 0.5-second GIF export decoded back into five frames. Gestures were recorded
independently in each backend, so encoded file sizes are not cross-backend pixel
comparisons. Native WKWebView integration was not tested; native code is unchanged.

`npm run typecheck`, `npm run lint`, `npm test` (454 tests in 47 files), and
`npm run build` passed. The build retains its non-blocking large-chunk and mixed
static/dynamic-import warnings. Recommendations 2–5 and the broader real-library,
input-latency, native, and concurrency measurements above remain future work.


## October 26, 2026: recommendation 2 implementation

Paint invalidation now follows the decoded `gifData` identities actually used by
an individual render group. Recreating the library array, adding an unused source,
or changing source metadata preserves its raster. Replacing, removing, or supplying
a previously missing decoded source rebuilds its dependent groups only. A changed
stroke inside a flattened static run still invalidates that run's pixels; splitting
static runs into editable tiles is recommendation 4. Stroke objects retain sampled
geometry and bounds across group changes. Opacity, ordering, visibility, and replay
edits reuse dabs when points, size, spacing, and constant-speed timing agree.
Geometry variants are limited to four per point-array identity; weak ownership
allows discarded paths and their samples to be collected. The render-group plan
changes only with the stroke array, and group matching uses a first-stroke lookup.

Autopaint now retains its seeded source palette and the last two sampled gestures,
including their dabs. Forward display updates inside a gesture do not sort the
palette or regenerate its path. Palette order and decoded identity remain genuine
dependencies; replacing the active folder reconstructs autopaint. Settings still
apply retroactively, with identical seeds, pressure, source timing, and linear fade.

`PaintPreviewRenderer` advances a cancellable generator from the existing display
loop. Raster work yields every 128 stamp operations; saved-path preparation yields
between batches of 64 input points. Each tick has a soft 3 ms submission budget and
a 512-batch ceiling for coarse timers. This is cooperative main-thread work, not a
worker or a hard latency guarantee: a Canvas allocation, copy, stamp, geometry
segment, or final composite cannot be preempted. Completed saved paint remains
visible while reconstruction runs; an independent incremental draft compositor
continues accepting input on top. Stroke/configuration/source changes, backward
time, and resizing cancel obsolete work. Only completion publishes the new base
image. Forward playback catches up from completed reconstruction timestamps.
Cancellation and destruction release partially built surfaces.

Checkpoints retain up to eight saved-group rasters within **8 million (binary)
pixels / 32 MiB**, plus up to four autopaint rasters within **4 million pixels /
16 MiB**, per paint session. Retired static groups support undo; accumulating
replay groups snapshot at most once per five seconds, and autopaint at most once
per ten seconds. Restores select an identical configuration/dependency snapshot
at or before the requested time and deposit the remaining interval. Static groups
are time independent. Both checkpoint pools evict their oldest surfaces and release
backing stores; oversize snapshots are not retained. `checkpointPixels` reports
this storage separately from `cachedPixels` and `stampCachePixels`. These budgets
cover RGBA surfaces, not decoded frames or JS event/geometry storage. Checkpoints
cannot reuse pixels after retroactive brush edits, and eviction can require a
long reconstruction again. They bound retained history, not reconstruction duration.

GPU and Canvas 2D previews use the same coordinator. Exact export rendering drains
the same deterministic command generator synchronously, with a separate paint
session so export timestamps/resolutions cannot cancel preview reconstruction.
Pixi switches the texture's owning canvas when switching sessions. The preview
adds one output-size display canvas; its draft renderer and draft surface exist
only while drawing. At full resolution these are an extra 7.91 MiB while idle and
15.82 MiB more while drawing, excluding GPU copies. Concurrent preview/export
sessions have independent raster, checkpoint, and stamp budgets. No document
schema, undo boundary, dependencies, or native files changed.

### Verification

Unit regressions cover local source invalidation (including missing sources),
geometry reuse across edits/group changes, cached group planning, bounded-prefix
sampling, current-gesture reuse, checkpoint restores/eviction, obsolete generation
cancellation, draft updates during a long seek, and destruction with work pending.

**Verify local rebuilds** in `/scripts/paint-benchmark.html` passed **30 pixel
comparisons** across **201 interruptible batches** at 270 × 480. It covers all five
patterns, mixed static/active ordering, opacity, scatter, rotation, linear fading,
source additions, edit/undo, cancellation, replay checkpoints, and autopaint seeks
up to 1,800 seconds. Completed previews matched the exact reference with **zero
premultiplied-channel difference**. The fixture retained 2,530,640 checkpoint bytes
at completion; this is a synthetic correctness check, not a 30-minute wall-clock
performance measurement. Existing incremental verification passed all **195
comparisons**, retaining its prior preview-rounding tolerance, and the seek verifier
passed with maximum premultiplied difference below 1.

Production-app smoke tests passed in WebGPU and Canvas 2D: three animated sources,
manual drawing and append, undo/redo, V12 save/open, 32 active paths reconstructed
at replay time 60, and a 0.5-second GIF export decoded into five frames. Both
backends produced 363,051-byte GIFs for the common 32-path fixture. Actual native
WKWebView, native dialogs, hardware latency, and process-memory profiling remain
unmeasured. The historical performance numbers above are not new measurements.

`npm run typecheck`, `npm run lint`, `npm test` (**460 tests in 47 files**),
`npm run build`, and `git diff --check` passed. The build retains its existing
non-blocking large-chunk and mixed static/dynamic-import warnings.
Recommendations 3–5 remain future work.

## October 26, 2026: recommendation 3 retained GPU prototype

The opt-in `?paint=gpu` path prototypes retained GPU **autopaint**, the audit's
most expensive dense-animation workload. Use `/?paint=gpu` for WebGPU preference
or `/?paint=gpu&renderer=webgl` for the desktop-style browser backend. The default
renderer and `?renderer=2d` remain the Canvas reference. This completes the focused
prototype, not a replacement of every saved-path renderer or a default rollout.
Saved static/active paint and manual drafts retain their existing compositors.
They appear below and above GPU autopaint respectively, preserving source order.
No project fields, undo behavior, dependencies, or native code change.

### Command and resource model

`GpuAutopaint` consumes the existing deterministic `AutopaintSequence` commands:
source frame/time, position, pressure, opacity and birth time. Linear lifetime
alpha is evaluated from birth time on the CPU and packed into each quad's color;
it is not an exponential surface decay or a new trail aesthetic. A pool of at
most **2,048 Pixi particles** submits ordered quad batches. It reuses the pool for
each chunk rather than keeping a scene object for every historical deposit.
Atlas page changes flush the current batch; stamps are never sorted by source.

Two output-sized render textures serve a session, independent of gesture count.
Warm accumulating updates draw only new deposits into the front texture. Cold
reconstruction uses the back texture and publishes it on completion. Exact linear
trails clear/redraw their live window into the back texture, then swap. Expired
commands are dropped; accumulating paint retains no historical stamp list.
Unchanged times and empty fading pauses submit no paint raster work. Preview work
yields after 2,048 commands with a soft 3 ms tick budget; allocations, uploads,
individual submissions and GPU execution are not preemptible. During same-size
edit/seek reconstruction the previous output remains visible. Warm accumulation
may expose a newly deposited chunk before its whole time interval completes.

Brush masks and GIF mapping are baked once per geometry/source-frame combination
using `stampImage.ts`, the **same rasterizer used by the Canvas reference**. This
prototype tests GPU deposition/batching without introducing analytic GPU brush
masks. Source-frame variants share shelf-packed texture atlases with transparent
one-pixel guards. Four million binary atlas pixels are retained at most; an
oversize entry may occupy one larger page at high export resolution. Eviction
flushes first and releases GPU textures and Canvas backing stores without
reconstructing accumulated paint. Weak per-gesture lookups avoid repeated style
key construction while allowing expired generated gestures to be collected.

At 1080 × 1920 the two RGBA render textures account for **15.82 MiB** per enabled
session. The dense fixture uses one 1024 × 1024 atlas: **4 MiB of Canvas backing
store plus its GPU copy**, excluding allocator overhead. General atlas capacity is
16 MiB on each side, with the oversize-page exception above. These figures exclude
decoded frames, saved-paint/draft canvases, output targets, CPU live commands,
backend buffers, filters and export readback. Preview and exact export have
independent sessions and budgets. Export drains every requested frame before
encoding; it cannot cancel preview work. Source identity/order, settings,
backward time and output size invalidate the appropriate GPU session. Disabling,
leaving Paint mode and destruction release its resources.

### Compatibility and verification

Open `/scripts/paint-gpu-prototype.html` under Vite and choose **Verify GPU pixels**.
The WebGL/WebGPU fixture passed **156 pixel comparisons**. It covers five brush
patterns, animated transparent sources, translucent overlap, rotation, zoom,
scatter, pressure, accumulation, exact linear trails, unchanged frames, forward
and backward seeks, saved/active paint plus a draft, source replacement, resize,
cancelled work and atlas eviction. Sequential GPU playback and fresh GPU seek
agree within one premultiplied channel level. The 120-frame, large-brush pressure
case evicted eight atlas pages per backend, stayed within four million atlas
pixels, and preserved its output without extra history textures.

**Prototype compatibility decision:** accept a maximum premultiplied-channel
error of **6/255** relative to Canvas in this fixture; the measured maximum was
**5/255** in both backends. GPU bilinear sampling, eight-bit particle alpha and
blend rounding can differ from Canvas. This tolerance is explicitly limited to
the opt-in prototype; it does not redefine the reference renderer's pixel tests
or establish acceptable error for arbitrary assets/resolutions. The fixture
compares displayed canvases through a 2D scratch canvas because Pixi's WebGL and
WebGPU extraction helpers expose different premultiplication conventions. This
also avoids mistaking extraction conversion for a paint blending error.

Production-app smoke tests passed with `?paint=gpu` on WebGPU and WebGL: three
animated sources, enabled autopaint, V12 save/open, and a 0.5-second GIF export
that decoded into five frames. Both GPU runs produced 10,750-byte GIFs for this
fixture. Canvas 2D also exported five frames (10,774 bytes); these are encoder
smoke checks, not a claim of identical pixels across the two paint backends.
Seven new unit regressions cover new-deposit counts, idle frames, empty fading
pauses, live-window bounds, decoded dependency invalidation, seeks, edits, resize,
cancellation, atlas pressure and destruction.

### Presentation measurements and limits

Choose **Measure dense presentation** or **Measure reference presentation** on a
fresh fixture page for each run. Local macOS in-app browser, 1080 × 1920, two
synthetic three-frame sources, size 24, spacing 0.1, duration 0.15 s, no pause,
reach 1,800, lifetime 10 s, Master FX disabled. Each run warms at time 20 and
submits 60 complete forward frames at 1/60 s increments on animation callbacks,
without pixel readback. The reference uses the current Canvas compositor plus
Pixi canvas-texture upload; the prototype presents its retained GPU texture.
These are complete-frame submission measurements (the preview's cooperative
budget is disabled), not input latency or isolated GPU timings.

| Backend | Reference median / p95 ms | Retained GPU median / p95 ms | Reference / GPU median callback interval |
| --- | ---: | ---: | ---: |
| WebGL | 68.4 / 74.3 | 6.8 / 7.3 | 66.7 / 8.3 ms |
| WebGPU | 68.4 / 75.1 | 8.1 / 8.9 | 66.7 / 8.3 ms |

Both implementations processed **2,335,878 stamps** in the 60 measured frames.
The GPU prototype submitted **1,173 particle batches** (about 19.6/frame), with
zero warm atlas builds, evictions or reconstruction. Its particle pool peaked
at 2,048; the final live window held 38,129 commands. This demonstrates a useful
reduction in JS submission overhead for this synthetic workload. It still exceeds
the proposed 4 ms p95 budget. Earlier runs before per-gesture texture lookup
caching measured roughly 11 ms; backend/resource state and other workloads also
affect results. Do not generalize these short measurements into hardware or FPS
guarantees.

Saved active-path GPU deposition, shader-evaluated birth/lifetime attributes,
analytic GPU masks, editable tiles, larger real GIF libraries, native WKWebView
profiling, input-to-visible latency, 30-minute wall-clock runs and concurrent
live-output/export traces remain follow-up work. Exact fading still processes
and fills every live stamp. Keep the 256-stroke bound and the reference default.
Recommendations 4 and 5 remain future work.

`npm run typecheck`, `npm run lint`, `npm test` (**467 tests in 48 files**),
`npm run build`, and `git diff --check` passed. The build retains its existing
non-blocking chunk-size and mixed static/dynamic import warnings.
