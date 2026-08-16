# Slapchop Agent Guide

## Project overview

Slapchop is a local-first generative motion studio. It is a React 19 + TypeScript application built with Vite, with a Tauri 2/Rust desktop shell. PixiJS is the primary renderer; Canvas 2D is the fallback and reference implementation. There are no API keys or backend services.

Read `README.md` and `package.json` before changing behavior. Prefer small changes that fit the existing architecture. Do not add or upgrade dependencies unless the task requires it; when one is needed, explain why and update the appropriate lockfile.

## Repository map

- `src/components/`: React UI and user interaction. `CanvasWorkspace.tsx` owns canvas interaction and export orchestration; `Sidebar.tsx` owns controls.
- `src/store.ts`: Zustand document and UI state, plus zundo history.
- `src/types.ts`: shared domain types for layers, polygons, motion, and GIF data.
- `src/renderer/`: the imperative render loop, PixiJS renderer, and Canvas 2D fallback.
- `src/lib/`: pure helpers, project serialization, export pipelines, and the browser/Tauri boundary.
- `src/workers/`: CPU-heavy GIF and ZIP encoding work.
- `src-tauri/`: native Rust shell, permissions, bundling, file association, and ffmpeg sidecar configuration.
- `scripts/fetch-ffmpeg.sh`: downloads the ignored macOS arm64 ffmpeg sidecar used for ProRes packaging.

Do not edit generated or vendored output in `dist/`, `node_modules/`, `src-tauri/target/`, or `src-tauri/gen/`. The binary in `src-tauri/binaries/` is ignored and should not be committed.

## Architectural invariants

- Keep the 1080 x 1920 design coordinate system and center-origin layer/polygon coordinates. Scale only at the render or interaction boundary.
- Live playback and offline export must use the same rendering semantics. Rendering should remain a deterministic function of `(time, document state)`; never base exported frames on wall-clock timing or React render cadence.
- Keep PixiJS and Canvas 2D behavior aligned when changing geometry, motion, opacity, visibility, ordering, textures, or blend modes. Test the fallback with `?renderer=2d`.
- Keep the animation loop outside React. Read rapidly changing state imperatively and avoid triggering component renders on every frame.
- Preserve undo semantics: history contains `layers`, `polygonLayers`, and `canvasBg`; selection, mode, and transient drawing/export state stay outside history. Pause or coalesce history for continuous gestures.
- Treat `.slapchop` as a versioned, self-contained file format. New persisted fields must round-trip through save/open; incompatible schema changes require a new version and a migration or an explicit compatibility decision.
- Keep browser support intact. Tauri APIs must remain behind `isNative()` checks or lazy imports, and browser behavior needs an equivalent fallback where applicable.
- Release GPU, worker, encoder, object-URL, listener, and animation-frame resources on cancellation, deletion, or unmount. Rendering and export paths are performance-sensitive.

## Implementation conventions

- Follow the existing TypeScript style: ES modules, single quotes, semicolons, two-space indentation, functional React components, and explicit shared types.
- Put shared domain models in `src/types.ts`, document mutations in `src/store.ts`, and reusable or testable logic in `src/lib/`.
- Keep pure calculations separate from DOM, PixiJS, Tauri, and encoding side effects. Add or update a colocated `*.test.ts` when changing pure behavior or fixing a regression.
- Use existing Tailwind utilities and `cn()` for UI styling, and Lucide for interface icons. Preserve the compact dark desktop-tool aesthetic and keyboard accessibility.
- Do not paper over failures with broad catches, unchecked casts, or silent fallbacks. Include useful context in user-visible errors and keep intentional fallback behavior narrow.
- Comments should explain timing, coordinate, compatibility, or lifecycle constraints—not restate the code.

When adding or changing a document feature, trace the whole path as applicable:

1. shared type and defaults;
2. store mutation and undo behavior;
3. UI control and interaction;
4. PixiJS and Canvas 2D rendering;
5. project save/open round-trip;
6. live and offline export;
7. browser and Tauri behavior.

## Commands and validation

Use the committed npm lockfile. For a fresh checkout, run `npm ci`; use `npm install` only when intentionally changing dependencies.

```sh
npm run dev             # Vite at http://localhost:3000
npm run tauri dev       # native app; requires Rust and Xcode command-line tools
npm run typecheck       # TypeScript, no emit
npm run lint            # ESLint over src/
npm test                # Vitest once
npm run build           # production frontend build
```

During iteration, run the narrowest relevant test first, for example `npm test -- src/lib/motion.test.ts`. Before handing off a frontend change, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Do not claim a check passed unless you ran it; report any skipped or failing check and why.

For Rust or Tauri changes, also run:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

The formatting check requires the `rustfmt` component (`rustup component add rustfmt` if it is missing).

Run `npm run tauri build` when changing packaging, capabilities, file associations, or the ffmpeg sidecar and the required native toolchain is available.

Automated tests do not cover visual fidelity or native integration. For rendering, interaction, or export changes, smoke-test the affected flow with representative static and animated assets. Compare the default GPU path with `http://localhost:3000/?renderer=2d`, and verify the relevant export at a short duration before handoff. For native-only behavior, test through `npm run tauri dev` when practical.

## Change discipline

- Preserve unrelated user changes and avoid destructive Git operations.
- Keep diffs focused; do not reformat or reorganize unrelated code.
- Never commit generated builds, local settings, downloaded binaries, or secrets.
- Update `README.md` when setup, commands, supported formats, platform requirements, or user-visible behavior changes.
- In the handoff, summarize behavior changed, files touched, validation performed, and any remaining risk or manual follow-up.

## Code review rules

- Flag regressions in deterministic frame timing, renderer parity, project-file compatibility, undo boundaries, resource cleanup, and browser/Tauri parity.
- Treat changes to Tauri capabilities, shell execution, filesystem access, file loading, and project deserialization as security-sensitive. Prefer least privilege and validate untrusted files and paths at the boundary.
- Focus review comments on behavior, correctness, performance, and missing tests; leave formatting that CI already enforces to the tooling.
