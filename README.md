# slapchop

A generative art canvas for layering images and animated GIFs with symmetry, blend modes, and motion modulation — plus a polygon tiler that fills arbitrary shapes with repeating (animated) textures. Renders to a 1080×1920 canvas and exports still images, frame sequences, and video.

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
| `npm run build` | Production build to `dist/` |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint over `src/` |
| `npm test` | Run the Vitest unit tests |

## Modes

- **Symmetry canvas** — drop images/GIFs as layers; each layer has position/rotation/scale, mirror/quad/radial symmetry, blend mode, opacity, and sine/noise motion modulators.
- **Polygon tiler** — preset or hand-drawn polygons filled with a repeating image/GIF texture with animatable scale, rotation, and offset.
- **Master FX & Shader pipeline** — real-time post-processing shaders including chromatic aberration (RGB split), duotone/gradient mapping, CRT scanlines, film grain, bloom/glow, and color grading with motion modulation and one-click aesthetic presets.

## Rendering

Rendering runs on the GPU via PixiJS v8 (WebGPU, with automatic WebGL fallback). The
Canvas 2D renderer is kept as a fallback and as a reference implementation — append
`?renderer=2d` to the URL to force it. Exports always use the same renderer as the
live canvas.

## Exports

Animation exports are frame-exact and deterministic: every frame is rendered at its
exact timestamp and encoded with WebCodecs, so exports run faster than real time and
never drop frames.

- **MP4 (H.264)** — the default; plays in QuickTime and uploads anywhere
- **WebM (VP9)**
- **ProRes 4444** *(desktop app only)* — frame-exact PNGs piped through the bundled
  ffmpeg sidecar (`prores_ks`, alpha-capable) for VJ/editing pipelines
- **Animated GIF** — quantized and encoded off-thread via gifenc
- **Frame sequence ZIP** — PNG or JPEG frames, compressed off-thread

Browsers without WebCodecs fall back to real-time MediaRecorder WebM capture.

## TouchDesigner live output (WebRTC)

Slapchop can stream its live 1080×1920 canvas directly to TouchDesigner without
rendering a second export frame. The sender uses the browser's WebRTC stack and
TouchDesigner's built-in Signaling API; no cloud service or Slapchop backend is
required.

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
