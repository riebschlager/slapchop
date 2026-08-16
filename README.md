# slapchop

A generative art canvas for layering images and animated GIFs with symmetry, blend modes, and motion modulation — plus a polygon tiler that fills arbitrary shapes with repeating (animated) textures. Renders to a 1080×1920 canvas and exports still images, frame sequences, and video.

## Run locally

```sh
npm install
npm run dev
```

Then open http://localhost:3000. No API keys or environment variables required.

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
- **Animated GIF** — quantized and encoded off-thread via gifenc
- **Frame sequence ZIP** — PNG or JPEG frames, compressed off-thread

Browsers without WebCodecs fall back to real-time MediaRecorder WebM capture.
