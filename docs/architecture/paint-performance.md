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
