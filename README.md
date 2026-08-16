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
