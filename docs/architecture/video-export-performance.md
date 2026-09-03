# Video export performance

- **Status:** Phase 0 complete; Phase 2 next (see the sequencing decision below)
- **Date:** 2026-09-02
- **Scope:** Shared browser and Tauri animation-export pipeline

## Summary

Slapchop's desktop video export performs more work per frame than the final
video codec requires. The current path renders a frame on the GPU, reads the
pixels back to the CPU, copies them into a Canvas 2D canvas, PNG-compresses the
canvas, sends the PNG through Tauri IPC, and asks ffmpeg to decode the PNG
before encoding the video.

The most important optimization is therefore to remove the PNG intermediate
for desktop video. Codec changes can also produce large immediate gains,
especially for VP9 and ProRes:

- faster VP9 settings measured between 4.3x and 15x the throughput of the
  current settings in an encoder-only benchmark;
- VideoToolbox ProRes measured 3.7x the throughput of `prores_ks`;
- `libx264`'s `veryfast` preset measured 1.9x the throughput of the current
  `medium` preset;
- VideoToolbox H.264 measured 1.6x the current H.264 throughput and may also
  reduce CPU and power use, although it was slower than `libx264 veryfast` on
  the test machine.

These results do not yet predict complete export time because they exclude
scene rendering, GPU readback, JavaScript image encoding, IPC, and disk I/O.
The implementation should begin by measuring those stages independently, then
apply low-risk codec changes before replacing PNG transport with raw pixels.

## Goals

- Reduce wall-clock time for deterministic MP4, WebM, and ProRes exports.
- Preserve the exact `(time, document state)` rendering contract.
- Preserve frame count, frame order, timestamps, cancellation, and partial-file
  cleanup.
- Keep browser and Tauri behavior available, while allowing their encoding
  implementations to differ where the platform capabilities differ.
- Preserve ProRes 4444 alpha, orientation, and color behavior.
- Keep memory bounded for long desktop exports.

## Non-goals

- Replacing frame-exact offline export with real-time recording.
- Dropping frames to keep up with a requested frame rate.
- Changing a mode's rendering semantics or silently disabling effects during
  export.
- Moving the entire renderer from PixiJS/Three.js to a native graphics stack.
- Optimizing GIF or frame-sequence export in the first implementation.

## Current architecture

### Shared frame production

`renderExportFrame` renders each requested timestamp through the active live
renderer so exports match the preview. On the GPU path,
`PixiSceneRenderer.extract`:

1. synchronizes the scene for the requested time and resolution;
2. renders into a reusable PixiJS `RenderTexture`;
3. calls `renderer.extract.pixels`, which reads the GPU result into CPU RGBA
   memory;
4. constructs `ImageData` and copies it into a caller-owned Canvas 2D canvas
   with `putImageData`.

Relevant code:

- [`src/renderer/loop.ts`](../../src/renderer/loop.ts)
- [`src/renderer/pixiRenderer.ts`](../../src/renderer/pixiRenderer.ts)

In the desktop app, PixiJS uses WebGL. Its extraction path ultimately calls
`gl.readPixels`, which synchronizes GPU work before the CPU can consume the
frame. In the browser's WebGPU path, PixiJS copies through canvases and calls
`getImageData`, so JavaScript still receives a CPU pixel buffer.

### Desktop video

The Tauri path in [`src/lib/ffmpegExport.ts`](../../src/lib/ffmpegExport.ts)
then performs the following work serially for every frame:

```text
render GPU frame
  -> synchronous GPU-to-CPU pixel extraction
  -> copy RGBA pixels into a 2D canvas
  -> encode the canvas as PNG
  -> convert Blob to Uint8Array
  -> invoke one Tauri command and await its write
  -> ffmpeg decodes PNG from image2pipe
  -> ffmpeg converts pixels and encodes the destination codec
```

The Rust side in [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) owns the
ffmpeg process and stdin handle. That is a useful lifecycle boundary: closing
stdin finalizes the container, cancellation kills the process, output is first
written to a partial path, and the complete result is installed atomically.
The performance work should retain those properties.

Current ffmpeg choices are:

| Export | Encoder | Important options |
| --- | --- | --- |
| MP4 | `libx264` | `-preset medium -crf 18 -pix_fmt yuv420p` |
| WebM | `libvpx-vp9` | `-crf 30 -b:v 0 -row-mt 1 -pix_fmt yuv420p` |
| ProRes | `prores_ks` | `-profile:v 4444 -pix_fmt yuva444p10le` |

### Browser video

The browser path in [`src/lib/videoExport.ts`](../../src/lib/videoExport.ts)
creates a `VideoFrame` from the extracted Canvas 2D frame, encodes through
WebCodecs, and muxes into an in-memory MP4 or WebM buffer. It does not add the
PNG encode/decode stages, but it still pays for GPU readback and the Canvas 2D
copy.

The current backpressure loop also schedules at least one zero-delay timeout
for every frame, even when `encodeQueueSize` is already below its threshold.
This keeps the UI responsive but adds avoidable scheduling overhead. Browsers
without WebCodecs use a real-time `MediaRecorder` fallback.

## Findings

### 1. PNG is a costly transport format for video frames

PNG is useful for lossless, self-describing frame sequences. It is not an
efficient internal representation when the next process immediately decodes
the result.

A Chromium `canvas.toBlob` microbenchmark at 1080 x 1920 produced these
results over 12 iterations:

| Synthetic frame | Intermediate | Mean encode time | Mean size |
| --- | --- | ---: | ---: |
| Solid color | PNG | 5.0 ms | 48 KB |
| Random/high-entropy RGBA | PNG | 38.9-40.8 ms | 8.33 MB |
| Random/high-entropy RGBA | JPEG, quality 0.92 | 20.2 ms | 1.69 MB |
| Random/high-entropy RGBA | JPEG, quality 0.80 | 18.7 ms | 1.19 MB |

This benchmark used headless Chromium rather than WKWebView and should not be
treated as an application benchmark. It does show that PNG cost and size vary
dramatically with image entropy. Film grain, noise, textured GIFs, and rapidly
changing generative imagery all work against PNG compression.

JPEG would reduce the intermediate cost and IPC volume for opaque MP4/WebM,
but it would add a lossy generation before the video codec and cannot preserve
ProRes alpha. It is therefore a possible fallback experiment, not the preferred
architecture.

### 2. VP9 settings are the clearest codec bottleneck

The bundled ffmpeg's current VP9 configuration encoded the synthetic benchmark
at approximately 9.5 fps. VP9's speed controls changed throughput much more
than any other codec tested:

| VP9 configuration | Approximate throughput | Relative throughput |
| --- | ---: | ---: |
| Current: CRF 30, default deadline/CPU use, row multithreading | 9.5 fps | 1x |
| Balanced candidate: CRF 32, `good`, CPU-used 4, tiled/frame-parallel | 41 fps | 4.3x |
| Fast candidate: CRF 34, `realtime`, CPU-used 6 | 144 fps | 15x |

The candidates deliberately trade compression efficiency and, in the fast
case, visual quality for speed. CRF differs between rows, so these are speed
profiles rather than controlled equal-quality comparisons. The balanced
candidate needs visual and objective-quality evaluation on representative
Slapchop output before it can become the default.

When WebM is not required, MP4 should remain the recommended fast delivery
format on macOS.

### 3. The bundled ffmpeg already includes useful hardware encoders

The checked-out arm64 ffmpeg 9.0 sidecar exposes:

- `h264_videotoolbox`;
- `hevc_videotoolbox`;
- `prores_videotoolbox` with ProRes 4444 support.

No dependency change is required to experiment with those encoders. Apple
VideoToolbox exposes hardware-accelerated compression sessions, but hardware
availability can vary by device, configuration, and current system load. Any
hardware path therefore needs capability detection or a narrow software
fallback.

Encoder-only results at 1080 x 1920 and 30 fps were:

| Format and encoder | Frames | Approximate throughput | Relative to current |
| --- | ---: | ---: | ---: |
| H.264 `libx264 medium`, CRF 18 (current) | 150 | 97 fps | 1x |
| H.264 `libx264 veryfast`, CRF 18 | 150 | 182 fps | 1.9x |
| H.264 VideoToolbox, 9 Mbps, high profile | 150 | 154 fps | 1.6x |
| ProRes `prores_ks` 4444 (current) | 90 | 55 fps | 1x |
| ProRes VideoToolbox 4444 | 90 | 204 fps | 3.7x |

The test used an RGBA `testsrc2` source and a null output, so it includes pixel
format conversion and encoding but excludes PNG decoding, IPC, muxing to disk,
and application rendering. Equal CRF values across x264 presets do not
guarantee equal visual quality or output size. VideoToolbox H.264 may be useful
for CPU and energy efficiency even where `libx264 veryfast` has greater raw
throughput.

ProRes VideoToolbox must be verified with transparent content. In particular,
the implementation must validate alpha preservation, straight versus
premultiplied alpha, channel order, color metadata, and compatibility with the
VJ/editing applications Slapchop targets.

### 4. Raw pixels remove computation but increase transport bandwidth

One RGBA frame requires `width * height * 4` bytes. A raw desktop transport
would move approximately:

| Resolution | Bytes per frame | 30 fps | 60 fps |
| --- | ---: | ---: | ---: |
| 1080 x 1920 | 8.29 MB | 249 MB/s | 498 MB/s |
| 720 x 1280 | 3.69 MB | 111 MB/s | 221 MB/s |
| 540 x 960 | 2.07 MB | 62 MB/s | 124 MB/s |

This is large, but avoids PNG encoding, PNG decoding, and the extra canvas copy
on the GPU path. Tauri supports `ArrayBuffer`/`Uint8Array` as a raw invocation
body, which avoids JSON serialization for the frame itself. End-to-end
measurement is required because IPC copies or WKWebView limits may replace PNG
as the bottleneck at full resolution and 60 fps.

### 5. GPU readback remains after PNG is removed

`renderer.extract.pixels` makes the CPU wait for the completed GPU frame.
Removing PNG does not remove that synchronization. Possible later improvements
include bounded pipelining, WebGL2 pixel-pack buffers and fences, or a dedicated
encoder-consumable render target. These are more invasive and should only be
attempted after stage timing shows that readback dominates the optimized
pipeline.

A truly zero-copy native path would require the renderer to produce a native
`CVPixelBuffer`/IOSurface consumable by VideoToolbox. The current renderer lives
inside WKWebView, so that direction implies a substantial renderer/native-shell
integration or migration. It is not recommended as near-term work.

### 6. Existing user controls already provide strong speed tradeoffs

Reducing 1080 x 1920 to 720 x 1280 removes about 56% of the pixels. Reducing
60 fps to 30 fps halves the number of frames. These options already exist and
will compound every pipeline improvement.

A future speed preset should make codec tradeoffs explicit. It must not
silently reduce resolution, frame rate, effects, or deterministic fidelity.

## Recommended implementation plan

### Phase 0: Establish an end-to-end baseline

Add lightweight development timing around the existing export stages:

- scene synchronization and draw;
- GPU extraction and Canvas 2D copy;
- PNG `toBlob` and Blob-to-byte conversion;
- Tauri invoke/pipe backpressure;
- ffmpeg drain and container finalization;
- total elapsed time and effective frames per second.

Use a bounded summary rather than logging every frame. Report count, total,
mean, median or approximate percentile, and maximum where useful. Keep
production UI changes out of this phase unless a diagnostic disclosure is
intentional.

Create a repeatable manual benchmark set with at least:

1. a flat/simple 2D scene;
2. a grain/noise-heavy Master FX scene;
3. a GIF-heavy mode;
4. a 3D or landscape scene;
5. a transparent ProRes scene.

Run short exports at all three resolutions, at 30 and 60 fps, with preview
paused. Record wall-clock time, effective fps, CPU use, output size, and peak
memory.

**Exit criteria:** the team can identify the dominant stage for each scene and
can reproduce the baseline before evaluating later phases.

Implemented. The instrumentation lives in
[`src/lib/exportProfiler.ts`](../../src/lib/exportProfiler.ts) and is off unless
explicitly enabled; the scene set, run matrix, and stage reference are in
[`video-export-benchmark.md`](./video-export-benchmark.md).

### Phase 1: Add codec speed profiles

Introduce a shared export-speed type with explicit `fast`, `balanced`, and
`quality` meanings, but keep format-specific mappings. Do not force unlike
codecs into identical flags.

Initial candidates:

| Format | Fast | Balanced | Quality |
| --- | --- | --- | --- |
| MP4 | Benchmark `libx264 veryfast` against VideoToolbox; choose by measured wall time and CPU goals | `libx264 fast` or `veryfast`, quality-tuned | Current `libx264 medium`, CRF 18 |
| WebM | VP9 `realtime`, CPU-used 6 | VP9 `good`, CPU-used 4, row/tile/frame parallelism | Current settings |
| ProRes | VideoToolbox 4444 | VideoToolbox 4444 | `prores_ks` 4444 fallback/reference |

Implementation work:

- pass the selected profile through `useExport`, `exportNativeVideo`, and
  `start_native_video_export`;
- make `native_video_args` select validated format/profile arguments;
- retain the current software encoder when a hardware session cannot start;
- surface which encoder was used if automatic fallback occurs;
- add Rust argument-construction tests for every format/profile combination;
- extend the ffmpeg integration test to cover available hardware encoders
  without making CI depend on hardware availability.

Do not assume that the same CRF gives the same quality across presets. Tune
profiles using representative outputs, file size, and objective comparisons
such as VMAF/SSIM, followed by visual review of gradients, fine geometry, rapid
motion, film grain, and GIF edges.

**Exit criteria:** every profile produces a playable file with the exact
expected frame count and timestamps; balanced settings have an accepted quality
and size tradeoff; hardware failure falls back cleanly.

### Phase 2: Replace PNG with raw RGBA for desktop video

Change the native video frame boundary so the renderer can provide pixels
without first placing them in another canvas:

- on the PixiJS path, return or write the `renderer.extract.pixels` buffer
  directly;
- on the Canvas 2D path, obtain the frame through `getImageData` only when raw
  bytes are requested;
- keep canvas-producing behavior for browser WebCodecs, images, GIFs, ZIPs, and
  frame sequences;
- avoid exposing a raw-pixel concept to individual creative modes.

Update the native job start command to receive and validate width, height, and
pixel format. Configure ffmpeg input approximately as:

```text
-f rawvideo
-pixel_format rgba
-video_size <width>x<height>
-framerate <fps>
-i pipe:0
```

Send each frame as a raw Tauri IPC request body instead of a nested serialized
field. Carry the job identifier in a narrowly validated header or an equivalent
command-specific mechanism. On the Rust side:

- accept only raw request bodies;
- require an existing job identifier;
- require exactly `width * height * 4` bytes per frame;
- reject unsupported dimensions and excess frames;
- preserve write ordering and OS-pipe backpressure;
- preserve cancellation, EOF finalization, and partial-file cleanup;
- avoid retaining more than a small bounded number of frames.

Verify orientation and channel order. Confirm that H.264/VP9 still receive
correct `yuv420p`, and test ProRes alpha separately.

If raw IPC cannot sustain an acceptable rate, evaluate a bounded shared-memory,
memory-mapped-file, or local pipe transport before adopting JPEG intermediates.
JPEG should remain opt-in and limited to opaque delivery formats if it is ever
used.

**Exit criteria:** raw transport is faster end-to-end on detailed reference
scenes, memory remains bounded during a long export, and pixel-level reference
tests show no new orientation, color, or alpha errors before lossy encoding.

### Phase 3: Improve backpressure and overlap

After Phase 2 measurements, overlap only stages that demonstrably block one
another:

- replace the browser WebCodecs loop's unconditional per-frame timeout with
  queue-aware waiting and periodic UI yields;
- consider a bounded two- or three-frame producer/consumer queue for native
  export;
- preserve frame order even when rendering and writes overlap;
- cap memory explicitly and ensure cancellation releases queued frames;
- move muxing or other CPU-only browser work to a worker if it materially
  affects the main thread;
- investigate asynchronous WebGL2 readback only if GPU extraction is dominant.

WebCodecs accepts a `hardwareAcceleration: 'prefer-hardware'` hint. It may be
tested in supported browsers, but must retain capability fallback. Do not use
`latencyMode: 'realtime'` for deterministic offline export because a user agent
may drop frames to meet real-time constraints.

**Exit criteria:** the optimized pipeline remains responsive, deterministic,
bounded, and faster than Phase 2 on at least one representative bottleneck
case without regressing others materially.

### Phase 4: Reassess the rendering boundary

Only after the preceding work, decide whether eliminating JavaScript-visible
GPU readback justifies a dedicated export renderer or native VideoToolbox
integration. Treat this as a separate architecture decision because it could
affect renderer parity, asset ownership, GPU resource cleanup, and the
browser/Tauri boundary.

## Validation matrix

Every implementation phase that changes output should cover:

| Dimension | Cases |
| --- | --- |
| Format | MP4, WebM, ProRes 4444 |
| Resolution | 1080 x 1920, 720 x 1280, 540 x 960 |
| Frame rate | 15, 30, 60 fps |
| Renderer | desktop WebGL, browser default GPU, forced Canvas 2D |
| Content | static, rapid motion, GIF, 3D, grain/bloom, transparency |
| Lifecycle | completion, cancellation, encoder failure, app shutdown |

Automated checks should verify:

- argument validation and encoder selection;
- exact decoded frame count and duration;
- monotonically increasing, frame-exact timestamps;
- readable container trailers after normal completion;
- partial-file removal after cancellation or failure;
- no retained worker, encoder, process, GPU, canvas, or object-URL resources;
- software fallback when VideoToolbox is unavailable.

Manual checks should compare live playback with exported frames at selected
timestamps, compare PixiJS/WebGL with `?renderer=2d`, inspect lossy quality at
motion and gradient stress points, and round-trip ProRes transparency through a
target editor or VJ application.

For packaging or sidecar changes, run the repository's full frontend and Rust
checks and perform a native build when the toolchain is available.

## Recommended sequence

1. Instrument and establish representative baselines.
2. Ship validated codec profiles, prioritizing VP9 and ProRes.
3. Replace desktop PNG transport with validated raw RGBA transport.
4. Remove unconditional browser scheduling overhead and add bounded overlap
   where measurements support it.
5. Revisit zero-copy/native rendering only if GPU readback remains dominant.

This order delivers substantial codec gains early while keeping the highest-
risk transport and renderer work evidence-driven.

### Decided after the Phase 0 baseline: transport before codecs

**Steps 2 and 3 are swapped. Phase 2 is the next phase of work; Phase 1
follows it.** Phase numbers below are kept as stable identities — other code
and documents already reference them — so only the execution order changes.

The baseline recorded in
[`video-export-benchmark.md`](./video-export-benchmark.md) is unambiguous about
where the time goes at 1080x1920: `ipc.writeFrame` is 78.1% of the export and
`png.encode` a further 15.3%, together 93.4%. Encoding is not the constraint.
ffmpeg had roughly 10x headroom over the achieved 2.84fps feed rate, so it was
never applying pipe backpressure, and quartering the pixel count cut
`ipc.writeFrame` by 8.6x — steeper than the pixel count itself, and impossible
for a fixed per-frame encoder cost.

Consequences:

- **Phase 2 runs next.** It is the only phase that addresses the dominant
  stage, and it removes the JavaScript PNG encode and ffmpeg's PNG decode in
  the same change.
- **Phase 1 is deferred, not cancelled.** VP9 and ProRes still carry the
  largest measured codec headroom (4.3-15x and 3.7x), and VideoToolbox still
  offers CPU and power benefits. Those gains are simply invisible until
  transport stops hiding them, and tuning quality against a pipeline that is
  transport-bound would measure the wrong thing.
- **Phase 4 drops in priority.** GPU readback is 2.3% and the whole of frame
  production is 5.8% of a full-resolution export. A dedicated export renderer
  cannot pay for itself against that.
- **Phase 0 instrumentation stays.** It is how Phase 2 will be shown to have
  worked, and `recordBytes` now reports the per-frame payload and a MiB/s rate
  so the transport cost can be read per byte rather than inferred.

The remaining benchmark scenes were deliberately not built out. The two
recorded rows already identify the dominant stage, and a grain-heavy scene
inflates PNG size, so it is more useful afterwards as a Phase 2 validation case
that should show a larger-than-average win.

## Open decisions

- Should `balanced` replace the current defaults, or should speed profiles be
  opt-in initially?
- For MP4, is minimum wall time or lower CPU/power use the primary meaning of
  `fast`?
- What visual-quality and file-size thresholds are acceptable for balanced and
  fast VP9?
- Does VideoToolbox ProRes preserve the required alpha and color behavior on
  every supported Mac?
- Can Tauri raw IPC sustain full-resolution 60 fps without excessive copying?
  This is now the blocking question for the next phase rather than one of
  several. The baseline shows the current *nested-argument* path costs
  approximately 275ms per 1080x1920 PNG frame; Phase 2 must establish what a
  raw request body costs for the 8.29MB uncompressed frame that replaces it.
- Does the supported WKWebView version offer a reliable WebCodecs encoder that
  could eventually replace some native ffmpeg work while still streaming output
  to disk?

## References

- [Tauri: calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)
  documents raw `ArrayBuffer` and `Uint8Array` request bodies.
- [MDN: `VideoEncoder.configure`](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/configure)
  documents hardware-acceleration and latency hints.
- [Apple: VideoToolbox](https://developer.apple.com/documentation/videotoolbox)
  describes hardware-accelerated video compression and decompression.
- [Apple: encoding video for offline transcoding](https://developer.apple.com/documentation/videotoolbox/encoding-video-for-offline-transcoding)
  provides the intended offline compression-session workflow.
- [FFmpeg VideoToolbox encoder source reference](https://www.ffmpeg.org/doxygen/trunk/videotoolboxenc_8c.html)
  lists the H.264, HEVC, and ProRes VideoToolbox encoders and ProRes profiles.

