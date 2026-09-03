# slapchop

A local-first generative motion studio made of independent creative modes. Each
mode can use the tools and concepts that fit its workflow while sharing a
1080×1920 output surface and still-image, frame-sequence, video, and live-output
pipelines.

## Editions

The same codebase ships two ways. They are not feature-equivalent: the browser
edition is a short-form studio, and the desktop app adds native file access and
long, incremental exports.

- **Browser edition** — <https://riebschlager.github.io/slapchop/>. Nothing to
  install; open it and start working.
- **Desktop app** — build it yourself; see [Desktop app (Tauri)](#desktop-app-tauri).

### Your work stays on your machine

Slapchop has no backend, accounts, sign-in, cloud storage, or telemetry. Images,
GIFs, folder libraries, `.slapchop` projects, and every export are read,
rendered, and encoded inside your own browser tab. The application uploads
nothing; the only network requests it makes are for its own code.

### Browser edition vs. desktop app

| Capability | Browser edition | Desktop app |
| --- | --- | --- |
| All seven creative modes | Yes | Yes |
| Rendering | WebGPU, falling back to WebGL and Canvas 2D | WebGL (what WKWebView supports reliably) |
| Image and GIF import | File picker and drag-and-drop | Native file dialogs |
| Folder libraries | Directory picker; current desktop browsers only | Native folder dialogs |
| `.slapchop` projects | Download and re-upload the file | Native dialogs, file association, double-click to open |
| PNG still export | Yes | Yes |
| Animated GIF | Yes, up to 10 seconds | Yes, up to 10 seconds |
| Frame sequences | ZIP assembled in memory | Written straight to a folder, with frame range and resume |
| MP4 / WebM | WebCodecs where the codec is supported, otherwise real-time WebM | ffmpeg sidecar, incremental, three encoder speeds |
| ProRes 4444 | No | Yes |
| Longest animation export | 10 seconds | 6 hours |
| Session persistence | None; the document is lost on refresh | Window state is restored |
| TouchDesigner Live Output | Not supported from the hosted page | Yes |

### Browser edition limits

- **Unsaved work does not survive a refresh.** There is no autosave or crash
  recovery. Closing or reloading the tab discards the current document — save a
  `.slapchop` project first.
- **Exports are assembled in memory.** Animated GIFs, frame-sequence ZIPs,
  WebCodecs video, and the self-contained `.slapchop` file are all built in the
  tab rather than streamed to disk, so a long or full-resolution job can exhaust
  it. Animation exports are capped at 10 seconds for this reason.
- **Video export depends on the browser's encoder.** Slapchop tests the exact
  codec, resolution, and frame rate before exporting. If the requested MP4
  configuration is unavailable, it says so before the export starts and delivers
  a real-time WebM recording named `.webm` — it never labels WebM as MP4.
- **Browser support.** Current Chrome and Edge are the primary targets; current
  Safari and Firefox are best-effort, using the WebGL, Canvas 2D, and
  MediaRecorder fallbacks.

**Desktop-only:** ProRes 4444, frame sequences written directly to a folder
with resume, exports longer than 10 seconds, native open/save dialogs,
`.slapchop` file association, window-state restore, and TouchDesigner Live
Output.

## Run locally

```sh
npm install
npm run dev
```

Then open http://localhost:3000. No API keys or environment variables required.

## Desktop app (Tauri)

The same codebase ships as a native Mac app with real file dialogs, a native menu
bar, `.slapchop` file association (double-click opens the app), window-state
restore, and a bundled static ffmpeg sidecar for ProRes export.

```sh
npm run tauri dev     # dev app against the Vite server
npm run tauri build   # Slapchop.app + .dmg in src-tauri/target/release/bundle/
```

Requires Rust (`rustup`) and Xcode command line tools. The ffmpeg sidecar binary
lives at `src-tauri/binaries/ffmpeg-aarch64-apple-darwin` (a static arm64 build).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server on port 3000 |
| `npm run build` | Production build to `dist/` (also what Tauri packages) |
| `npm run build:pages` | Production build for the hosted edition, based at `/slapchop/` |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint over `src/` |
| `npm test` | Run the Vitest unit tests |

## Modes

Modes are peer tools, not variations of one common scene model. They do not need
feature parity, matching inspectors, or equivalent document fields. Shared code
is reserved for platform capabilities and concepts whose behavior is genuinely
the same. See [Independent creative modes](docs/architecture/mode-independence.md)
for the product decision and incremental architecture direction.

- **Symmetry canvas** — drop images/GIFs as layers; each layer has position/rotation/scale, mirror/quad/radial symmetry, blend mode, opacity, and sine/noise motion modulators.
- **Polygon tiler** — preset or hand-drawn polygons filled with a repeating image/GIF texture, mode-owned repeat patterns and Voronoi partitioning, and animatable scale, rotation, and offset.
- **3D space** — textured meshes, camera depth, 3D deformation, spatial symmetry, and animated transforms.
- **GIF flythrough** — point the app at a folder of GIFs to build a seeded,
  deterministic Three.js particle field that rushes past the camera. GIFs
  retain their source aspect ratios, with camera-facing, XY, XZ, and YZ plane
  orientations plus speed, drift, spin, and scale modulation.
- **GIF Tunnel** — wallpaper a procedurally bent, endlessly advancing low-poly
  tunnel with an ordered or seeded library of GIFs and static images. Configure
  ring detail, pane occupancy, palette/transparent gaps, UV crop, camera,
  synchronized or phase-shifted playback, fog, twist, and path modulation.
- **GIF Voronoi** — divide the flat output stage into a seeded organic cell
  field and populate it from a sortable folder library of GIFs. Configure cell
  density, irregularity, animated point drift, occupancy,
  scan/radial/scattered assignment, cover crop, playback phase, gutters,
  backgrounds, and palette or transparent blanks.
- **GIF Landscape** — fly continuously over a seeded noise-displaced terrain
  grid tiled from a folder of animated GIFs. Shape mountains, ridges, plateaus,
  canyons, camera, fog, and mesh density; then build a concentric sky around a
  movable sun from GIF folders that assign one repeatable GIF to each ring.
  Sine and noise modulators animate terrain relief, flight velocity, camera,
  sun placement, ring width, and each sky folder's texture mapping.

## Inspector controls

Slider readouts can be clicked to enter an exact numeric value. Rate controls
such as motion, GIF playback, deformation, and animated effects use a
slow-focused logarithmic track with a distinct zero stop and values down to
`0.001`, while retaining their full upper range.

Modes may opt into shared output effects. The current **Master FX & Shader
pipeline** includes chromatic aberration (RGB split), duotone/gradient mapping,
CRT scanlines, film grain, bloom/glow, and color grading with motion modulation
and one-click aesthetic presets.

## Rendering

Rendering runs on the GPU via PixiJS v8. The browser prefers WebGPU; the desktop app
runs on WebGL, which is the backend WKWebView supports reliably. The Canvas 2D
renderer is kept as a fallback and as a reference implementation. Two URL flags force
a backend for comparison: `?renderer=2d` for Canvas 2D, and `?renderer=webgl` to
reproduce the desktop app's GPU path in a browser. Exports always use the same
renderer as the live canvas.

## Exports

Animation exports are frame-exact and deterministic: every frame is rendered at its
exact timestamp and encoded with WebCodecs in the browser or streamed through ffmpeg
in the desktop app, so offline exports never drop frames.

- **MP4 (H.264)** — the default; plays in QuickTime and uploads anywhere
- **WebM (VP9)**
- **ProRes 4444** *(desktop app only)* — frame-exact raw RGBA streamed through
  the bundled ffmpeg sidecar (`prores_ks`, alpha-capable) for VJ/editing pipelines
- **Animated GIF** — quantized and encoded off-thread via gifenc
- **Frame sequences** — PNG or JPEG files written incrementally to a selected
  folder in the desktop app, with frame-range and resume support; browsers use ZIP

Desktop MP4, WebM, and ProRes exports stream rendered frames directly through the
bundled ffmpeg sidecar as raw RGBA and write video incrementally, so their memory
use does not grow with duration. They also offer three encoder speeds — Fast,
Balanced, and Quality — which change encoder settings only; resolution, frame
rate, effects, and frame-exact timing are identical at every speed. Quality is
the default. Fast uses VideoToolbox hardware encoding where available, falling
back to software and saying so. Desktop exports accept a start time and durations up to six
hours per job. The desktop app pauses its live preview by default while rendering
animation frames, then resumes from the same playback time; an active TouchDesigner
Live Output stream keeps the preview running. Animated GIF and browser exports
retain the short-form limit.

Browser exports are assembled in memory and capped at 10 seconds. When WebCodecs
is missing, or cannot encode the requested codec at the chosen resolution and
frame rate, Slapchop says so in the export dialog before you start and falls
back to a real-time MediaRecorder WebM capture, named and typed as WebM.

## TouchDesigner live output (WebRTC)

Slapchop can stream its live 1080×1920 canvas directly to TouchDesigner without
rendering a second export frame. The sender uses the browser's WebRTC stack and
TouchDesigner's built-in Signaling API; no cloud service or Slapchop backend is
required.

This needs the desktop app or a local `http://` build. TouchDesigner's signaling
server speaks plaintext `ws://`, and browsers refuse an insecure WebSocket from
an HTTPS page, so the hosted edition disables Live Output and explains why.

### TouchDesigner setup

TouchDesigner 2022.21000 or newer is required for the palette WebRTC components.

1. From **Palette → WebRTC**, add `signalingServer`, `signalingClient`, and
   `webRTC` COMPs.
2. On `signalingServer`, leave Port at `9980` and turn **Active** on.
3. On `signalingClient`, set Host to `ws://127.0.0.1`, Port to `9980`, turn
   **Forward to Subscribers** on, and then turn **Active** on.
4. Set the `webRTC` COMP's **Signaling Client** parameter to the nearby
   `signalingClient` COMP. This subscribes it to incoming Offer, Answer, and ICE
   messages.
5. In Slapchop, open **Live Output**, keep the default
   `ws://127.0.0.1:9980`, click **Find Receivers**, choose the TouchDesigner
   client, and click **Start Stream**.
6. Add a **Video Stream In TOP**, set Mode to **WebRTC**, reference the WebRTC
   DAT used inside the `webRTC` COMP, and choose the newly-created connection
   and video track. Put a **Null TOP** after it as the stable texture output for
   the rest of the network.

Start at 30 fps. TouchDesigner's WebRTC path uses software video encoding and
decoding, so 60 fps can be expensive. WebRTC video does not carry Slapchop's
alpha channel. Stopping or disconnecting Live Output closes the peer connection,
media tracks, and signaling socket; closing the modal alone leaves the stream
running.

Slapchop asks the WebRTC encoder to preserve the native 1080×1920 resolution,
using a 12 Mbps ceiling at 30 fps and 24 Mbps at 60 fps. The Live Output panel
shows the actual encoded resolution, frame rate, send rate, and any bandwidth or
CPU quality limit reported by the browser. These settings favor resolution over
frame rate, but WebRTC may still drop frames or reduce quality if the software
encoder cannot keep up. In the Video Stream In TOP, use **Output Resolution: Use
Input** and disable **Use Global Res Multiplier** to avoid additional receiver-side
scaling.
