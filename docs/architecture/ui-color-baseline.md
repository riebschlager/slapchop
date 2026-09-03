# UI color baseline (Phase 0 record)

- **Status:** Complete
- **Date:** 2026-09-03
- **Plan:** [`ui-color-system.md`](./ui-color-system.md), Phase 0
- **Commit captured:** `d7c8723`

This is the "before" record for the unified UI color system. It exists so the
later phases can be checked against the surface they replaced, and so a status
color is not swapped out mechanically along with a decorative one.

## 1. Reference screenshots

**Environment.** Vite dev server (`npm run dev`), headless Chrome 152.0.7977.75 driven
over the DevTools Protocol, viewport 1680 x 1050 at `deviceScaleFactor: 2`
(3360 x 2100 PNGs). Renderer path: WebGL/PixiJS via ANGLE SwiftShader — the
`webgl` badge is visible in the stage header of every populated shot. Stacks
were populated from four generated 96 x 96 animated GIF fixtures rather than
user assets, so the set is reproducible.

**Location.** `tmp/ui-color-baseline/` (git-ignored, local to the working
copy): `fixtures/` the generated GIFs, `shots/` the 35 PNGs plus a
`manifest.json` recording the shot notes, the captured message strings, and the
console errors seen during the run. The capture is a throwaway harness, not a
committed tool; re-running it means re-deriving the driver, so treat the PNGs as
the artifact and this section as the recipe.

| # | Shot | Surface recorded |
| --- | --- | --- |
| 01 | `symmetry-empty` | Symmetry, empty document; stack header, amber browser-session warning, SceneTab, Output dock |
| 02 | `mode-picker-open` | `ModePicker` listbox open, all seven modes, indigo selected-option treatment |
| 03 | `scene-tab-master-fx-off` | SceneTab with Master FX disabled |
| 04 | `scene-tab-master-fx-on` | Master FX enabled: preset chips, indigo checkboxes, shader sliders |
| 05 | `symmetry-populated-selected` | Three layers, one selected; `LayerRow` selected vs resting, layer inspector, indigo canvas center handle |
| 06 | `symmetry-row-hover` | Unselected `LayerRow` hovered; hover fill and hover-revealed delete |
| 07 | `symmetry-row-hidden` | Hidden layer: amber `EyeOff` plus grayscale/opacity |
| 08 | `symmetry-inspector-motion` | Layer > Motion: `Segmented`, `Slider`, `MotionControl` |
| 09 | `symmetry-inspector-symmetry` | Layer > Symmetry with symmetry off |
| 10 | `symmetry-radial-handles` | Radial symmetry on: instance rings, amber origin handle, origin hint copy |
| 11 | `export-modal-mp4` | Export modal, MP4; format grid and browser encode plan line |
| 12 | `export-modal-webm` | Export modal, WebM |
| 13 | `export-modal-zip` | Export modal, ZIP frames; PNG/JPEG radios (`accent-indigo-500`) |
| 14 | `export-modal-gif` | Export modal, GIF; quality and dithering controls |
| 15 | `export-running` | Export in progress: indigo progress bar, disabled primary action |
| 16 | `export-finished` | Export modal after the job completed |
| 17 | `live-output-idle` | Live Output disconnected: neutral status pill, indigo `Radio` icon and primary action |
| 18 | `live-output-error` | Live Output after a refused connect to `ws://127.0.0.1:9980`: red status treatment |
| 19 | `canvas-drag-over` | Stage drag-over: `ring-indigo-500/50` |
| 20 | `polygon-empty` | Tiled GIF, empty; shape presets and empty state |
| 21 | `polygon-drawing-instruction` | Amber drawing instruction bar over the stage |
| 22 | `polygon-populated-selected` | Polygons with a texture, row selected; vertex handles |
| 23 | `polygon-inspector-pattern` | Polygon > Pattern |
| 24 | `3d-empty` | 3D Space, empty; Add Mesh grid |
| 25 | `3d-populated-selected` | Mesh selected: `Mesh3dRow`, mesh tabs, translate gizmo |
| 26 | `3d-texture-tab` | 3D texture controls |
| 27 | `3d-gizmo-orbited` | Orbited view so all three R/G/B gizmo arms are visible |
| 28-29 | `flythrough-empty`, `flythrough-populated` | Cyan stack header and stage card; cyan inspector with indigo sliders |
| 30-31 | `tunnel-empty`, `tunnel-populated` | Teal stack header and stage label; `TunnelAssetRow`; teal inspector |
| 32-33 | `voronoi-empty`, `voronoi-populated` | Lime/emerald stack header and stage card; lime-accented sliders |
| 34-35 | `landscape-empty`, `landscape-populated` | Orange/amber stack headers and stage card; orange inspector with indigo sliders |

### States not reachable in this environment

These are real states with documented colors that the browser capture could not
produce. They need a manual pass, and Phase 4 should not be called done on the
screenshot set alone.

- **Export amber notice and red `browserVideoError`.** Headless Chrome
  advertised working WebCodecs for both H.264 and VP9, so the plan line stayed
  neutral: `"Frame-exact WebCodecs encoding — this export will produce MP4
  (H.264)."` The degraded and unsupported branches did not render.
- **Live Output amber blocked reason.** `liveOutputBlockedReason` fires only for
  a `ws://` endpoint on an HTTPS page; the dev server is `http://localhost`.
  Reachable on the deployed GitHub Pages build.
- **Live Output connected/streaming green.** Needs a real TouchDesigner
  signaling server, so the emerald pill, `Live` button state, downscale amber,
  and red stop button are unrecorded.
- **Desktop-only export chrome.** ProRes format, Frames (Folder), the resume
  checkbox, and the encoder-speed cards render only under `isNative()`.

## 2. Raw UI hue inventory

327 hue-class occurrences across `src/`, excluding the `gray` ladder:

| Family | Occurrences | Files | Role today |
| --- | --- | --- | --- |
| `indigo` | 93 | 20 | Focus, selection, checked, range, progress, primary action, drag ring, canvas handles |
| `amber` | 61 | 12 | Warning, drawing/origin affordances, hidden state — plus Landscape sky chrome |
| `emerald` | 34 | 6 | Live/positive status — plus GIF Voronoi chrome |
| `lime` | 32 | 4 | GIF Voronoi chrome and slider accents |
| `teal` | 31 | 4 | GIF Tunnel chrome |
| `orange` | 28 | 3 | GIF Landscape chrome |
| `cyan` | 24 | 3 | GIF Flythrough chrome |
| `red` | 24 | 11 | Errors, destructive actions, stop |

No raw `blue`, `green`, `violet`, `purple`, `sky`, or `rose` classes exist. The
neutral ladder is `gray` only, concentrated in `gray-800` (184), `gray-400`
(105), `gray-700` (67), `gray-500` (55), `gray-950` (41), with `gray-900` (26)
and `gray-950` carrying panel and canvas surfaces respectively.

### Migrate: shared controls and shell (Phases 1-2)

| File | Hue classes | Note |
| --- | --- | --- |
| `controls/ModePicker.tsx` | indigo x9 | Trigger badge, focus ring, selected option, check icon |
| `controls/Slider.tsx` | indigo x5 | `accent-indigo-500` default track, focus ring, editable-value border/ring/text |
| `controls/Segmented.tsx` | indigo x3 | `bg-indigo-600` on-state for both variants, focus ring |
| `controls/Toggle.tsx` | indigo x2 | Checked track, focus ring |
| `controls/Select.tsx`, `controls/MotionControl.tsx` | indigo x1 each | `focus:ring-indigo-500` |
| `controls/ResizeHandle.tsx` | indigo x1 | `group-hover/handle:bg-indigo-500/60` |
| `panels/InspectorPanel.tsx` | indigo x3, emerald x4, amber x4 | Primary export action; Live Output button connected/streaming states |
| `panels/LayerRow.tsx`, `PolygonRow.tsx`, `Mesh3dRow.tsx` | indigo x2, amber x1, red x1 each | Identical selected-row and hidden/delete treatment in three files |
| `panels/MasterFxPanel.tsx` | indigo x8 | Six raw `<input type="checkbox">` with `text-indigo-600`, plus the wand icon and preset hover |
| `panels/inspector/SubjectHeader.tsx` | indigo x1, amber x1, red x1 | Name field focus border, hidden, delete |
| `panels/inspector/TextureTab.tsx` | indigo x7 | Texture emphasis and active-state chips |
| `panels/inspector/Texture3dTab.tsx` | indigo x4 | Same shape as `TextureTab` |
| `panels/inspector/symmetry/LayerStyleTab.tsx` | indigo x3 | Style emphasis |

### Migrate: mode-specific chrome (Phase 3)

| File | Hue classes | Note |
| --- | --- | --- |
| `panels/StackPanel.tsx` | cyan x14, teal x13, orange x13, amber x16, emerald x7, indigo x7, lime x6, red x6 | Four per-mode upload headers, each with its own border, gradient, rail, icon tint, and hover ladder |
| `inspector/GifVoronoiInspector.tsx` | lime x23, emerald x8, red x1 | Includes 12 `trackClassName="h-1 accent-lime-400"` overrides that defeat `Slider`'s own accent |
| `inspector/TunnelInspector.tsx` | teal x13, red x1 | Header, section labels, swatch hover |
| `inspector/LandscapeInspector.tsx` | orange x13 | Header, section labels, panels |
| `inspector/FlythroughInspector.tsx` | cyan x8 | Header, Reseed button, section labels |
| `panels/GifVoronoiAssetRow.tsx` | lime x2, emerald x4, red x1 | Row hover/ring in mode hue |
| `panels/TunnelAssetRow.tsx` | teal x3, red x1 | Row hover in mode hue |

Decorative literals in the same class: `bg-[radial-gradient(...rgba(...))]`
header washes in `StackPanel.tsx:597,664,715,766`, plus
`FlythroughInspector.tsx:26`, `TunnelInspector.tsx:46`,
`GifVoronoiInspector.tsx:63`, `LandscapeInspector.tsx:30`, and the
`shadow-[0_0_Npx_rgba(...)]` glows on the mode empty-state cards in
`CanvasWorkspace.tsx:967,984,993`.

### Migrate: overlays and modals (Phase 4)

| File | Hue classes | Note |
| --- | --- | --- |
| `CanvasWorkspace.tsx` | indigo x10, amber x17, cyan/teal/lime/emerald/orange x9 | Indigo: drag ring, center handles, instance boundaries, SVG stroke `#818cf8`. Mode-hue: four empty-state cards. Amber and the gizmo are preserved (below) |
| `modals/ExportModal.tsx` | indigo x13, amber x4, red x4 | Format selection, resolution cards, `accent-indigo-500` x4, progress bar, primary action |
| `modals/LiveOutputModal.tsx` | indigo x9, amber x9, emerald x8, red x6 | Focus rings and primary action are indigo; status pill/dot, metrics, and stop button carry the real status colors |

### Keep: status colors

`red` for errors, destructive actions, and stop; `amber` for warnings and
temporary instruction. Specifically preserved as-is:

- browser-session warning, `StackPanel.tsx` (amber);
- drawing instruction bar and its actions, `CanvasWorkspace.tsx:903-924` (amber);
- symmetry and polygon origin handles and their pinned variants,
  `CanvasWorkspace.tsx:1136,1198` and SVG strokes `#f59e0b` / `#fbbf24`
  (amber), and the first-vertex marker `#10b981`;
- hidden-layer `EyeOff` in the three row components and `SubjectHeader` (amber);
- `Geometry3dTab`, `Symmetry3dTab`, `LayerSymmetryTab` origin/caution hints (amber);
- export error and notice blocks, live-output error pill and stop button (red).

Amber used as Landscape *identity* (`StackPanel` sky-folder card,
`LandscapeInspector`) is not a status color and belongs in the Phase 3 pass.

### Keep: coordinate encoding

`CanvasWorkspace.tsx:43-45` — `GIZMO_AXES` `#f87171` / `#4ade80` / `#60a5fa`
for X/Y/Z. This is the only blue in the application chrome and is a spatial
label, per the plan's scope boundary.

### Excluded: authored content and presets

Not touched by this work. Listed so a later sweep can classify them quickly
instead of re-deciding.

- **Creative palette presets:** `TunnelInspector.tsx:15-21` and
  `GifVoronoiInspector.tsx:31-37` (5 presets x 4 hex each), and the
  `'#ffffff'` appended by "Add color" in both.
- **Document defaults:** `types.ts` (duotone, tunnel palette/void/fog, voronoi
  gutter/background/blank/palette, landscape wireframe/fog/sky),
  `store.ts:230,249,351,369,379`, `lib/polygonUtils.ts:67,69`,
  `lib/mesh3dUtils.ts:43,46`, `lib/tunnel.ts:220`.
- **Master FX output presets:** `lib/fxPresets.ts` duotone shadow/highlight pairs.
- **Renderer materials and clears:** `renderer/render2d.ts`,
  `pixiRenderer.ts`, `threeRenderer.ts`, `tunnelRenderer.ts`,
  `landscapeRenderer.ts`, `landscape2d.ts`, `filters/duotoneFilter.ts`.
- **`<input type="color">` and swatch fallbacks:** `PolygonStyleTab.tsx:28,45`,
  `Texture3dTab.tsx:45`, `PolygonRow.tsx:47`.

The default authored fill `#6366f1` (indigo-500) recurs in `store.ts`,
`polygonUtils.ts`, `mesh3dUtils.ts`, `PolygonStyleTab`, `Texture3dTab`, and
`PolygonRow`. It is document content, so it stays; but it is the reason new
polygons and meshes will still look indigo after the chrome migration. Changing
it is the separate decision the plan already flagged.

## 3. Findings that should shape the later phases

1. **Three row components carry byte-identical state classes.** `LayerRow`,
   `PolygonRow`, and `Mesh3dRow` each spell out the same selected, hidden, and
   delete treatment. Phase 2 should keep them independent but token-identical;
   the plan's caution against a new abstraction still applies.
2. **`Slider`'s accent is overridable and is being overridden.** GIF Voronoi
   passes `accent-lime-400` through `trackClassName` twelve times. Making
   `Slider` green in Phase 1 will not reach those controls; they have to be
   removed in Phase 3 or the mode keeps a lime range accent.
3. **`MasterFxPanel` uses six raw checkboxes, not `Toggle`.** They are styled
   with `text-indigo-600` and `focus:ring-0`, so they will not pick up the
   token change and currently have no visible focus ring — an accessibility
   item for Phase 2, not only a color one.
4. **Mode identity is carried by four parallel header treatments.** Each of the
   four GIF modes repeats the same recipe — colored border, radial-gradient
   wash, 2px accent rail, tinted icon chip, per-hue hover ladder — in both
   `StackPanel` and its inspector. Normalizing them is mechanical, but it is
   also where the modes lose their only visual differentiation, so Phase 3
   should decide deliberately what carries identity instead (icon, name,
   section vocabulary).
5. **Emerald means two things.** Live/positive status (`InspectorPanel`,
   `LiveOutputModal`, the stage live badge, the first-vertex marker) and GIF
   Voronoi identity (`StackPanel`, `GifVoronoiInspector`,
   `GifVoronoiAssetRow`). Only the first should survive as green.
6. **The stage status pill is already green.** Its pulsing dot
   (`CanvasWorkspace.tsx:875`, `bg-emerald-500`) and the dev-only fps readout
   (`:896`, `text-emerald-400`, gated on `import.meta.env.DEV`) are the one
   place where the target semantics already hold. The fps text is absent from a
   production build, so the `N fps · webgl` string visible in these shots is a
   dev-server artifact, not chrome to migrate.
