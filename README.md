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
| All ten creative modes | Yes | Yes |
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

- **GIF Paint** — load a GIF folder, choose a round, flat, bristle, stipple, or
  striped brush, and drag with a mouse or trackpad. Enable **Autopaint** in the
  Inspector to generate human-like meandering arcs, light tapered flicks, loose
  lines, angular turns, or a mix. Adjust gesture duration, pauses, reach,
  variation, brush appearance, and paint lifetime (0 accumulates). Each gesture
  uses the next GIF in a seeded shuffled folder cycle, avoiding consecutive
  repeats when multiple sources are available. Autopaint appears over saved
  strokes without adding generated paths to the Stack or undo history. Brush
  controls edit autopaint while it is enabled and no saved stroke is selected;
  manual drawing still uses the manual brush. Settings rebuild the repeatable
  sequence; **New gestures** changes its seed and restarts replay. Disabling
  autopaint hides its output; **Restart replay** clears and restarts all replay.
  Autopaint settings and embedded sources save with the project; exports reproduce
  the sequence from time zero in browser and desktop. Each stamp freezes the GIF
  frame captured at that point in the gesture, including stationary holds.
  Stamp spacing sets the travel distance between stamp centers in brush widths,
  independent of drawing speed; stationary holds capture frames at 30 fps.
  Select a saved stroke in the Stack to edit its source, pattern, size, spacing,
  opacity, rotation, scatter, and image mapping; choose **New stroke** to paint
  again. New gestures always save as static paths, including while other brushes
  are active. Strokes can be hidden, deleted, reordered, and undone. **Clear all**
  removes all saved strokes while keeping the current GIF sources; undo restores
  the cleared strokes in one step. Select a saved
  path and enable **Continuously repaint this path** to activate a brush with fresh
  GIF frames: preserve drawing speed or use
  constant travel, forward/reverse/ping-pong direction, independent GIF speed,
  phase, and a delay between passes. Deactivating a brush restores its original hand-painted stamps. The first
  activation starts the shared replay timeline at zero; additional brushes join
  that timeline, reconstructing their paint up to the current time.
  Paint lifetime 0 accumulates indefinitely;
  a positive lifetime fades stamps over that many seconds. **Restart all paint
  replay** resets the preview; animation exports reconstruct from replay time 0
  with original strokes already present. Replacing a folder keeps sources used
  by saved strokes. Esc cancels an unfinished gesture. A gesture supports up to
  two minutes, 10,000 recorded points, or 50,000 design pixels of travel; start a
  new stroke to continue. Each painting supports 256 strokes and 256 sources.
  Consecutive static paths flatten into cached backgrounds in stack order. Active
  brushes retain cropped accumulation surfaces and deposit only new stamps;
  short-lived trails redraw only their live window. Matching pre-masked GIF stamp
  images share a separate 4-million-pixel cache. Its eviction
  regenerates small stamp images without rebuilding accumulated paint. Paths
  remain editable and undoable. Manual accumulating drafts retain their pixels
  and sample only new input; unchanged drafts skip raster work. Appending a static
  stroke to an unchanged top run draws only that stroke, copying the run only if
  its bounds grow. Drafts with a paint lifetime preserve exact linear fading;
  constant-speed timing still requires reconstruction when input changes.
  Retained draft compositing can slightly change translucent overlap rounding
  during drawing; saved paths and project timing are unchanged.
  Source changes invalidate only groups using that decoded source; adding an
  unused GIF keeps existing paint cached. Sampled paths and autopaint gestures
  are reused across updates. Preview reconstruction yields between batches,
  keeping the last completed painting visible with the current draft until the
  updated painting is ready. Bounded checkpoints accelerate undo and repeat
  seeks for unchanged settings. Exports use a separate paint session and finish
  every requested frame before encoding.
  Unchanged paintings skip raster work and GPU texture uploads. GPU and Canvas 2D use the same compositor, with shared Master
  FX and export support. Active brushes have no additional count limit; many
  full-stage paths can still use substantial memory. See the
  [GIF Paint benchmark](docs/architecture/paint-performance.md).
- **Symmetry canvas** — drop images/GIFs as layers; each layer has position/rotation/scale, mirror/quad/radial symmetry, blend mode, opacity, and sine/noise motion modulators.
- **Polygon tiler** — preset or hand-drawn polygons filled with a repeating image/GIF texture, mode-owned repeat patterns and Voronoi partitioning, and animatable scale, rotation, and offset. A Brush tool paints tapered, pressure-sensitive stroke shapes (pen pressure, or speed-simulated for a mouse) with editable size, taper, roughness, flat-nib angle, size breathing, and draw-on animation. An optional underpainting image (toggle and opacity in the Stack) helps trace polygons; it is saved with the project but never appears in exports or live output. Choosing a texture folder (GIF, PNG, JPEG, or WebP) gives every new shape — preset, pen, or brush — a random texture from it; the Inspector's Texture tab can shuffle or pick another from the folder, and the folder is saved with the project.
- **3D space** — textured meshes, camera depth, 3D deformation, spatial symmetry, and animated transforms.
- **GIF flythrough** — point the app at a folder of GIFs to build a seeded,
  deterministic Three.js particle field that rushes past the camera. GIFs
  retain their source aspect ratios, with camera-facing, XY, XZ, and YZ plane
  orientations plus speed, drift, spin, and scale modulation.
- **GIF Rings** — fly through an endless corridor of separate GIF rings. Each
  ring repeats one source with its original aspect ratio. Choose GIFs per ring,
  speed (including reverse), radius, spacing, size, twist, rotation, radial
  orientation, a GIF rotation offset, camera offsets/roll/FOV, playback speed/phase, shuffle, and depth
  fog. Animate GIF size with a Size Sweep between a from/to range at a set
  speed (Ring Spread makes the wave travel down the corridor) and/or per-GIF
  Size Noise with amplitude and period controls. Position Noise jitters each
  GIF's X/Y spot on its ring with amplitude, period (noise wavelength in world
  units), and speed controls. Folder libraries can also
  include static images. Project V7 embeds the library; V1–V6 projects remain
  readable.
- **GIF Tunnel** — wallpaper a procedurally bent, endlessly advancing low-poly
  tunnel with an ordered or seeded library of GIFs and static images. Configure
  ring detail, pane occupancy, palette/transparent gaps, UV crop, camera,
  synchronized or phase-shifted playback, fog, twist, and path modulation.
  Animate GIF pane scale with a Scale Sweep that oscillates between a
  from/to range at a set speed (Ring Spread makes the wave travel down the
  tunnel) and/or per-pane Scale Noise with amplitude and period controls.
- **GIF Grid** — stretch a folder of animated GIFs across an elastic grid. Set
  rows, columns, gutters, and margins; animate row heights and column widths
  independently with wave strength, speed, frequency, phase, direction, and a
  secondary harmonic, or choose Organic Drift for smooth seeded breathing with
  strength, speed, and spatial scale controls. Directional Wave bends shared cell
  corners with angle and direction rotation controls; Ripple spreads waves from
  a movable center, outward or inward. These patterns pin the perimeter, bound
  deformation to keep cells convex, and need at least two rows and columns.
  Deformation strength ranges from 0 to 5; high strengths are limited only as
  needed to prevent cells folding.
  Set travel and direction rotation speeds to zero to freeze deformation.
  Adjust individual row/column base sizes, GIF playback,
  per-cell playback phase, library order, and seeded shuffle. Images stretch
  to fill cells without cropping. Folder selection replaces the library;
  Add GIF files appends to it. Animated GIFs are required. All assets are
  embedded in projects, with identical layout semantics in GPU and Canvas 2D.
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

## Interface theme

The interface is one dark graphite studio across every mode, driven by semantic
color tokens defined in `src/index.css` rather than by Tailwind hue families.
Neutral graphite carries structure and typographic hierarchy, green means
interaction — selection, checked state, sliders, progress, focus, and live or
successful status — and magenta is a small secondary accent reserved for Master
FX. Amber marks warnings and the drawing/origin handles; red marks errors and
destructive actions. Modes are distinguished by their names, icons, controls,
and output, not by their own interface colors.

The theme covers application chrome only. Colors saved in `.slapchop` projects,
creative palette presets, renderer materials, and exported pixels are outside
it, as is the red/green/blue X/Y/Z axis convention in the 3D gizmo. See
`docs/architecture/ui-color-system.md` for the palette and its rules.

## Inspector controls

Control groups have clickable, keyboard-accessible headers to fold or unfold
settings. **Expand all** and **Collapse all** stay at the top of each toolbar;
the Inspector actions include nested motion controls, Master FX modules, and
Output. Groups can stay open independently, and each mode remembers its layout
while you switch selections or tabs during the session. Folding controls does
not disable effects, change the document, or add an undo step.

Slider readouts can be clicked to enter an exact numeric value. Rate controls
such as motion, GIF playback, deformation, and animated effects use a
slow-focused logarithmic track with a distinct zero stop and values down to
`0.001`, while retaining their full upper range.

Texture mapping editors include rotation and Repeat, Mirror, Mirror X, and
Mirror Y tiling. These controls are available for polygon fills, 3D mesh UVs,
tunnel panes, GIF Voronoi cells, landscape terrain, and each landscape sky
folder. Meshes, tunnel panes, and terrain also offer Clamp to Edge. Tunnel UV
Scale and Voronoi Cover Zoom can go below 1 to reveal multiple tiles.
Texture settings are saved in `.slapchop` projects; older projects keep their
existing mapping defaults.

Projects now save as format version 12, which embeds GIF Paint sources, frozen
painting paths, and replay controls. Versions 1–11 still open with their existing
motion. Projects configured with autopaint use GIF Paint payload version 2 inside
V12; current builds read payload versions 1 and 2. Earlier builds reject the
unsupported paint payload rather than silently dropping autopaint. Projects
without autopaint settings continue to save paint payload version 1.
Existing V12 replay flags, source timing, accumulation, and linear fading
remain unchanged; no format migration is required. Moving paths now honor saved
spacing, so existing V12 strokes may render with fewer overlapping stamps. Pre-masked stamp caching refines
brush-edge antialiasing, so edge pixels may differ slightly from the initial V12
renderer. Older builds refuse version 12 files rather than discard paint content.

Format version 13 adds GIF Tunnel scale animation (Scale Sweep and Scale Noise)
and GIF Rings size animation (Size Sweep and Size Noise) plus a GIF rotation
offset. It is otherwise identical to V12; older builds refuse V13 files rather
than silently render without them.

Format version 14 adds GIF Rings Position Noise. It is otherwise identical to
V13; older builds refuse V14 files rather than silently render without it.
V12–V14 files restore the polygon underpainting and texture folder.

Modes may opt into shared output effects. The current **Master FX & Shader
pipeline** includes chromatic aberration (RGB split), duotone/gradient mapping,
CRT scanlines, film grain, bloom/glow, color grading, and a smudge displacement
that drags the frame through a coarse, low-bit-depth, time-stuttered vector map,
with motion modulation and one-click aesthetic presets.

## Rendering

Rendering runs on the GPU via PixiJS v8. The browser prefers WebGPU; the desktop app
runs on WebGL, which is the backend WKWebView supports reliably. The Canvas 2D
renderer is kept as a fallback and as a reference implementation. Two URL flags force
a backend for comparison: `?renderer=2d` for Canvas 2D, and `?renderer=webgl` to
reproduce the desktop app's GPU path in a browser. Exports always use the same
renderer as the live canvas.

GIF Paint also has an opt-in retained GPU **autopaint prototype**: open
`/?paint=gpu` (WebGPU preference) or `/?paint=gpu&renderer=webgl`. It batches
stamps into persistent GPU textures while saved paint and drafts keep their
reference compositors. Exact linear trails retain their timing; small alpha and
sampling differences from Canvas are expected. Preview and export use separate
sessions of the selected backend. The default remains the reference compositor;
`?renderer=2d` always uses Canvas. See the
[prototype measurements and compatibility limits](docs/architecture/paint-performance.md#october-26-2026-recommendation-3-retained-gpu-prototype).


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

## Standalone TouchDesigner animations

[GIF Rings v2](tools/touchdesigner/gif_rings_v2.py) and
[GIF Tunnel v2](tools/touchdesigner/gif_tunnel_v2.py) build standalone TouchDesigner
components from a Text DAT. Each supports a GIF/image folder, an ordered list of
live TOPs, or a BASE/COMP publishing `tex_*` TOPs. Live textures remain on the GPU;
the upstream networks control their playback. The original `gif_rings.py` and
`gif_tunnel.py` scripts remain available unchanged, and v2 builds separate COMPs.
See the [TouchDesigner setup and validation guide](tools/touchdesigner/README.md).
