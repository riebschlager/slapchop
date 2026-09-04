# Unified UI color system

- **Status:** Accepted; Phases 0-4 complete, Phase 5 pending
- **Date:** 2026-09-03
- **Scope:** Application chrome, shared controls, interaction states, panels,
  modals, and on-canvas editing affordances

## Summary

Slapchop will use a restrained **dark graphite studio** color system. Neutral
surfaces provide the structure, green communicates interaction and active
state, and magenta is a limited secondary accent for creative or
transformative features such as Master FX.

Color must have the same meaning throughout the application. Creative modes
remain independent product surfaces, but they should not each recolor the
shared studio chrome. Mode identity should come primarily from vocabulary,
icons, controls, and output rather than separate cyan, teal, lime, orange, or
indigo interface themes.

## Context

The existing UI has a useful dark-gray foundation, but color usage has grown
organically:

- shared controls use indigo for focus, selection, checked state, and range
  inputs;
- GIF Flythrough uses cyan interface treatments;
- GIF Tunnel uses teal;
- GIF Voronoi uses lime and emerald;
- GIF Landscape uses orange and amber while its shared sliders remain indigo;
- live output, warnings, errors, drawing tools, and canvas handles introduce
  additional green, amber, red, and indigo states.

This means a single screen can contain several unrelated accent systems. The
result weakens hierarchy and makes color feel decorative instead of
intentional. It also makes new components harder to style consistently because
[`src/index.css`](../../src/index.css) declares the fixed dark color scheme but
does not yet define a reusable application palette.

## Decision

Application UI colors will be expressed through semantic Tailwind theme
tokens. Components should select a color by its role rather than directly
choosing a Tailwind hue family.

The initial palette is:

| Token | Value | Intended use |
| --- | --- | --- |
| `ui-canvas` | `#090A0A` | Window and workspace background |
| `ui-panel` | `#101112` | Stack and inspector columns |
| `ui-surface` | `#17191A` | Inputs, cards, and resting controls |
| `ui-surface-raised` | `#1F2223` | Hovered and elevated surfaces |
| `ui-border` | `#2D3133` | Dividers and standard control borders |
| `ui-border-strong` | `#42484B` | Emphasized and hovered boundaries |
| `ui-text` | `#F1F3F2` | Primary text and important values |
| `ui-text-muted` | `#B0B6B3` | Labels and secondary text |
| `ui-text-subtle` | `#848B87` | Hints, metadata, and disabled-adjacent text |
| `ui-accent` | `#28C76F` | Primary actions, selection, and checked state |
| `ui-accent-hover` | `#3DDA82` | Hover and high-emphasis interactive state |
| `ui-accent-strong` | `#159A50` | Pressed state and dark green boundaries |
| `ui-accent-contrast` | `#06140C` | Text and icons on bright green fills |
| `ui-creative` | `#C23C92` | Secondary creative/effect emphasis |
| `ui-creative-hover` | `#D955AA` | Hovered creative emphasis |
| `ui-creative-text` | `#EE75C5` | Magenta text or icon on dark surfaces |

The precise values may be adjusted during contrast and visual QA, but their
roles should remain stable.

`ui-text-subtle` was raised from the originally specified `#747B77` during
Phase 1 contrast QA: that value measured 4.36:1 on `ui-panel` and 4.07:1 on
`ui-surface`, below the 4.5:1 this document requires for normal text. `#848B87`
clears 4.5:1 on all four neutral surfaces. Every other value is as specified.

### Color responsibilities

**Neutral graphite** is the dominant system. It defines depth, grouping, and
typographic hierarchy without adding mode-specific hue.

**Green** is the primary interaction language. Use it for:

- primary actions;
- selected rows and tabs;
- checked toggles and checkboxes;
- sliders and progress;
- keyboard focus rings;
- drag targets and active on-canvas selection handles;
- positive, connected, live, or successful states.

Bright green controls should use `ui-accent-contrast` rather than white text
when that produces stronger contrast.

**Magenta** is a secondary creative accent, not a second primary-action color.
Use it sparingly for:

- Master FX and shader emphasis;
- creative transformation or modulation affordances where a distinction from
  ordinary selection is useful;
- small decorative highlights that do not communicate status or focus.

**Amber** is reserved for warnings, temporary instruction, and the established
drawing/symmetry-origin affordances. **Red** is reserved for errors,
destructive actions, and stopped/failing states. Neither should be used simply
to give a mode visual identity.

## Scope boundaries

This is a UI-system change, not a recoloring of authored work. The first
implementation must not change:

- colors stored in `.slapchop` documents;
- user-selected canvas, polygon, mesh, wireframe, fog, or palette colors;
- creative palette presets in mode inspectors;
- Master FX output presets in
  [`src/lib/fxPresets.ts`](../../src/lib/fxPresets.ts);
- renderer materials or exported frame pixels;
- the conventional red/green/blue X/Y/Z axis encoding in
  [`CanvasWorkspace.tsx`](../../src/components/CanvasWorkspace.tsx).

The Z-axis blue is a spatial label rather than application-theme chrome. If the
product goal later becomes "no blue anywhere," changing that convention and
the default authored fills should be evaluated separately.

This work also does not require changes to document types, state, undo,
serialization, rendering, export semantics, or mode independence.

## Execution plan

### Phase 0: Record the current surface

1. Capture reference screenshots of all seven modes at a representative desktop
   viewport.
2. Include the mode picker, a populated row selection, Master FX, Export, Live
   Output, a warning, an error, and on-canvas editing handles.
3. Inventory raw UI hue classes and literal decorative colors. Mark authored
   palette data and renderer colors as excluded before changing anything.

This creates a comparison set and reduces the chance of replacing meaningful
status colors mechanically.

Done: recorded in [`ui-color-baseline.md`](./ui-color-baseline.md), which also
lists the states the browser capture could not reach and the findings that
change how Phases 1-3 should be sequenced.

### Phase 1: Add tokens and migrate shared controls

1. Define the semantic palette with Tailwind v4 `@theme` variables in
   [`src/index.css`](../../src/index.css).
2. Move the root application background and text in
   [`src/App.tsx`](../../src/App.tsx) to semantic tokens.
3. Migrate the shared controls:
   - [`ModePicker.tsx`](../../src/components/controls/ModePicker.tsx)
   - [`Segmented.tsx`](../../src/components/controls/Segmented.tsx)
   - [`Select.tsx`](../../src/components/controls/Select.tsx)
   - [`Slider.tsx`](../../src/components/controls/Slider.tsx)
   - [`Toggle.tsx`](../../src/components/controls/Toggle.tsx)
   - [`MotionControl.tsx`](../../src/components/controls/MotionControl.tsx)
   - [`ResizeHandle.tsx`](../../src/components/controls/ResizeHandle.tsx)
4. Make focus, selected, checked, editable-value, and range states use green.
5. Keep disabled and resting states neutral, with sufficient contrast between
   surfaces and their boundaries.

Completing the primitives first should update a large portion of every mode
without duplicating decisions in individual inspectors.

Done. `src/components/controls/` is now free of raw `indigo` and `gray`
classes, including `SymmetryEditor.tsx`, which the list above missed but shares
the directory. Four things came out of the implementation:

- **Focus needed more than a colour swap.** A green ring is invisible on the
  green selected fill, so `Segmented` now carries a per-variant
  `focusOffset` that puts a 1px gap of the surrounding surface between fill and
  ring. `ModePicker`'s arrow-key option list previously indicated focus with
  only a background tint and now takes a green ring; `ResizeHandle`'s collapse
  button had no focus indicator at all and now has one. `Select`,
  `MotionControl`, and the `Slider` readout moved from a 1px to a 2px ring.
- **Bright green fills take `ui-accent-contrast`, never white.** White on
  `ui-accent` measures 2.21:1; `ui-accent-contrast` measures 8.52:1. The same
  applies to `ui-accent-strong` (3.64:1 vs 5.18:1), which matters for the
  pressed states in later phases.
- **The border tokens do not meet 3:1 and are not meant to.** The
  accessibility section was eased to exempt neutral boundaries, on the condition
  that no control depends on its border to be identifiable. Inputs and selects
  recess to `ui-canvas` to satisfy that.
- **`ui-accent-strong` and the three magenta tokens are defined but unused.**
  Tailwind v4 only emits a theme variable that some utility references, so they
  will not appear in the built CSS until Phase 2 uses them. That is expected,
  not a missing token.

Verified with `npm run typecheck`, `npm run lint`, `npm test` (284 passing), and
`npm run build`, then by re-running the Phase 0 capture harness for a
side-by-side comparison and adding the control states it could never reach.

### Phase 2: Unify shell, rows, and shared panels

1. Migrate [`StackPanel.tsx`](../../src/components/panels/StackPanel.tsx) and
   [`InspectorPanel.tsx`](../../src/components/panels/InspectorPanel.tsx) to the
   graphite surface hierarchy.
2. Standardize selected, hovered, hidden, drag, and destructive states across:
   - [`LayerRow.tsx`](../../src/components/panels/LayerRow.tsx)
   - [`PolygonRow.tsx`](../../src/components/panels/PolygonRow.tsx)
   - [`Mesh3dRow.tsx`](../../src/components/panels/Mesh3dRow.tsx)
   - [`TunnelAssetRow.tsx`](../../src/components/panels/TunnelAssetRow.tsx)
   - [`GifVoronoiAssetRow.tsx`](../../src/components/panels/GifVoronoiAssetRow.tsx)
3. Give [`MasterFxPanel.tsx`](../../src/components/panels/MasterFxPanel.tsx) the
   limited magenta creative accent while leaving its interactive controls and
   keyboard focus behavior green.
4. Keep output actions and the active Scene control aligned with the primary
   green interaction system.

Done. `src/components/panels/` is now free of every hue class except the amber
and red status roles, which closes the seam Phases 3 and 4 both recorded. Six
things came out of the implementation:

- **Magenta cannot be a fill at these values, so it is a text, icon, and border
  role.** `ui-text` on `ui-creative` measures 4.33:1 and on `ui-creative-hover`
  3.23:1 — both under the 4.5:1 this document requires — and the green focus
  ring measures only 2.18:1 against a `ui-creative` fill, so a focusable magenta
  chip could not indicate focus. `ui-creative-text` instead measures 6.1-7.5:1
  across all four neutral surfaces. Master FX therefore takes magenta on the
  `Wand2` icon when enabled, on the "Aesthetic Presets" label, and on the preset
  chips' hover border and text; every control in the panel — the master toggle,
  the six module checkboxes, every focus ring — stays green. The consequence is
  that **`ui-creative-hover` now has no home and is still absent from the built
  CSS**: it is the hover state of a fill this palette cannot afford. Phase 5
  should either retire it or restate it as a lighter magenta text token.
- **The five source-picker cards collapse into one recipe**, the same decision
  Phase 3 made for the four inspector headers. The radial-gradient washes and
  the cyan/teal/lime/orange/amber borders are gone; identity is the icon, the
  card's own copy, and the section vocabulary. They are named class-string
  constants at the top of `StackPanel.tsx`, not a new component — Phase 5 asks
  that repeated class strings not become an abstraction on their own.
- **On a selected row the border carries the state, not the fill.** `accent/10`
  over `ui-panel` measures just 1.15:1 against the panel, while `ui-accent`
  against that fill measures 7.4:1. This is the same `bg-ui-accent/10
  border-ui-accent` pair the export modal's resolution cards already use, so
  selected rows and selected cards now read alike.
- **Delete and remove actions gained a keyboard route.** `LayerRow`,
  `PolygonRow`, and `Mesh3dRow` revealed their delete button on hover alone, so
  a keyboard user focused an invisible control; they now take
  `focus-visible:opacity-100`, which the two asset rows already had. This is the
  "hover must not be the only way to expose a required action" requirement, not
  a colour change.
- **Measured, 66 of the 69 focusable controls reachable from the Scene tab
  paint the `#28c76f` ring.** The three exceptions are `input[type="color"]`
  swatches keeping Chrome's native focus ring, which is what the "native form
  controls should remain coherent with the declared `color-scheme`" requirement
  asks for and matches what Phase 3 shipped in `SceneTab`.
- **The Output dock now matches the modals it opens.** Export Animation uses the
  export modal's own primary recipe, and Live Output's streaming state is green
  while connected-but-not-streaming stays the amber transitional state the modal
  already used for that condition. Both moved off `transition-all` for the
  reason Phase 4 recorded — it animates the focus ring in.

Amber and red survive only in their documented roles: the browser-session
warning, the active "Click Canvas to Draw Points" drawing state, the hidden-layer
`EyeOff`, and the destructive hovers on delete, remove, and Clear. The polygon
`#6366f1` fallback fill, the wireframe colour, and every `<input type="color">`
value are untouched authored content.

Verified with `npm run typecheck`, `npm run lint`, `npm test` (284 passing), and
`npm run build`, then by driving headless Chrome over CDP against the dev
server: all seven modes in their empty state, polygon and mesh rows selected and
hidden, an uploaded symmetry layer row, tunnel and Voronoi asset rows from real
GIF uploads, and Master FX enabled with a module open. The only console errors
were WebGL-context failures from the headless GPU being disabled, which are
environmental. Live Output's connected and streaming chrome is still only
reachable with a real receiver and still needs the manual desktop pass Phase 4
listed.

### Phase 3: Remove mode-specific chrome palettes

Normalize the decorative headers, upload cards, helper panels, icon colors,
range overrides, and empty-state treatments in:

- [`FlythroughInspector.tsx`](../../src/components/panels/inspector/FlythroughInspector.tsx);
- [`TunnelInspector.tsx`](../../src/components/panels/inspector/TunnelInspector.tsx);
- [`GifVoronoiInspector.tsx`](../../src/components/panels/inspector/GifVoronoiInspector.tsx);
- [`LandscapeInspector.tsx`](../../src/components/panels/inspector/LandscapeInspector.tsx).

These surfaces should use neutral structure with a small, consistent green
interactive accent. Mode names, icons, control organization, and creative
output remain responsible for mode identity. Literal color arrays that define
user-selectable creative palettes are excluded.

Review the remaining symmetry, polygon, and 3D inspector tabs at the same time
so indigo emphasis does not survive in texture, style, transform, deformation,
or subject-header controls.

Done, and taken slightly wider than the file list: `src/components/panels/inspector/`
is now free of every hue class except the amber and red status roles, so the
whole subtree reads from the palette rather than half of it. Six things came out
of the implementation:

- **What carries mode identity, decided.** The four inspector headers now share
  one recipe — a `ui-surface` band on `ui-border`, mode icon and name in
  `ui-text`, source count in `ui-text-subtle`. The radial-gradient washes and
  per-hue borders are gone. Identity is the icon glyph, the mode's own name
  (Flight Director, Tunnel Director, Voronoi Field, Noise Horizon), and its
  section vocabulary, which is what the ADR asked for and what the Phase 0
  baseline flagged as the open question.
- **Section-title icons no longer carry a hue at all.** They were the mode
  accent (`cyan-400`, `teal-400`, `lime-400`, `orange-400`); tinting them green
  instead would have sprayed the interaction colour across every section label.
  They now inherit their label's `ui-text-muted`, and green is left to mean
  interaction.
- **GIF Voronoi's twelve `accent-lime-400` track overrides are removed**, so its
  ranges finally pick up `Slider`'s own green. This was Phase 0's finding 2; the
  props are deleted rather than retargeted, because `Slider` owns the accent.
- **The preset chips repeat Phase 1's focus lesson.** The selected chip in
  `TextureTab`, `Texture3dTab`, and `LayerStyleTab` is a bright `ui-accent` fill
  with `ui-accent-contrast` text, so its focus ring needs a 1px `ui-panel`
  offset to be visible — the same problem `Segmented`'s `focusOffset` solves.
  These chips also put `ui-accent-strong` into the built CSS for the first time.
  The three magenta tokens are still unused; they land with Master FX in Phase 2.
- **Several controls gained a focus indicator they never had.** The four Reseed
  buttons, the palette preset and add-colour buttons, the preset chips, and the
  `SubjectHeader` name field (which indicated focus with a 1px border alone) now
  use the established green ring; the 3D texture upload label takes
  `focus-within` since its file input is visually hidden.
- **The modes read half-migrated until Phase 2 lands.** `StackPanel`'s four
  per-mode upload headers, `TunnelAssetRow`, and `GifVoronoiAssetRow` are still
  cyan/teal/lime/orange, and they sit directly beside a now-neutral inspector.
  Phase 0 filed them under mode-specific chrome while this document's Phase 2
  owns those files; they stay in Phase 2, but the seam is visible in the
  meantime.

Amber and red survive only in their documented roles: the `Geometry3dTab` and
`Symmetry3dTab` caution notes, the `LayerSymmetryTab` and `PolygonPatternTab`
origin hints, the `SubjectHeader` hidden-layer `EyeOff`, and the destructive
hovers on delete and remove-swatch. Palette presets, `<input type="color">`
values, and the `#6366f1` fallback fill are untouched authored content.

Verified with `npm run typecheck`, `npm run lint`, `npm test` (284 passing), and
`npm run build`, then by screenshotting all four GIF-mode inspectors and the 3D
mesh Texture and Geometry tabs in headless Chromium against the dev server.

### Phase 4: Migrate overlays and modals

1. In [`CanvasWorkspace.tsx`](../../src/components/CanvasWorkspace.tsx), replace
   indigo drag rings, active handles, selection boundaries, and mode-colored
   empty-state chrome with the semantic system.
2. Preserve amber drawing/origin handles and the RGB axis gizmo because those
   colors encode editing concepts.
3. In [`ExportModal.tsx`](../../src/components/modals/ExportModal.tsx), make
   format selection, checkboxes, progress, focus, and the primary export action
   green.
4. In [`LiveOutputModal.tsx`](../../src/components/modals/LiveOutputModal.tsx),
   make connection actions and positive/live state green while preserving red
   stop/error and amber degraded/warning states.
5. Ensure overlays and modals use the same neutral elevation and border ladder
   as the docked panels.

Done. `CanvasWorkspace.tsx` and both modals are free of every hue class except
the amber and red status roles and the RGB gizmo. Six things came out of the
implementation:

- **On-canvas handles need a different green from UI chrome.** Handles sit on
  *authored artwork*, not on a known surface, so the worst case is a white
  frame. `ui-accent` measures 2.2:1 on white; `ui-accent-strong` measures 3.6:1
  on white and 5.8:1 on black, clearing 3:1 at both extremes — which the indigo
  it replaces did not (3.3:1 on black). Every grab handle therefore uses
  `ui-accent-strong` with `hover:bg-ui-accent`, while the instance outlines,
  which are guides rather than targets, keep the brighter `ui-accent`. This is
  the first real use of `ui-accent-strong` as the "dark green boundary" its
  palette-table role describes.
- **The 3D gizmo center handle is deliberately graphite, not green.** Inside the
  gizmo, hue is the axis label, and `ui-accent` reads close enough to the Y
  arm's `#4ade80` to be mistaken for it. It is the one place where the
  interaction language and the coordinate language actually collide, and the
  plan protects the coordinate language. A dark fill with the same white ring
  and dot keeps it obviously grabbable; the capture confirms it is unambiguous
  sitting directly beside the green Y handle.
- **Translucent overlays have to be measured against authored color, not
  chrome.** The four mode empty-state cards float over the canvas, so
  `bg-ui-canvas/80` put the hint line at 3.2:1 over a white frame. `/95` keeps
  the frosted look and clears AA over both black and white. The radial-gradient
  washes and per-hue glows are gone; each card keeps its own copy, placement,
  and silhouette (Voronoi's clip-path, Tunnel's pill), because shape and
  vocabulary are what the ADR assigns mode identity to.
- **The modals repeat Phase 1's focus lesson twice over.** The format chips are
  a bright `ui-accent` fill and need a 1px `ui-canvas` offset; the encoder-speed
  and resolution cards carry a `ui-accent` border and need a 1px `ui-panel` one;
  the primary actions need 2px. Separately, `transition-all` on the format chips
  and the primary action was animating the new ring *in* over the transition
  duration — a fade-in focus indicator — so both moved to `transition-colors`.
  Measured after the change, all eleven Export controls and both Live Output
  controls paint a full-width `#28c76f` ring within 60ms.
- **Several modal controls gained indicators they never had.** Every Export
  button and input, and both Live Output buttons, were relying on the native
  outline or nothing at all; the Export close button also had no accessible
  name and now carries one. Neither modal traps focus — pre-existing, and left
  alone as out of scope for a color phase.

- **The Phase 2 seam is now visible at the trigger, not just the panel.** The
  Output dock's indigo Export Animation and Live Output buttons in
  `InspectorPanel.tsx` launch modals that are entirely green, and the indigo
  `LayerRow` selection sits beside a green on-canvas outline for the same
  layer. Phase 2 owns both files; the mismatch is expected until it lands.

Amber and red survive only in their documented roles: the drawing instruction
bar and its actions, the symmetry and polygon origin handles and their pinned
variants, the in-progress drawing strokes, the export notice and error blocks,
the live-output error pill and Stop button, the degraded encode plan, the
downscale and quality-limit metrics, and the `ws://`-blocked notice. The
connected-but-not-streaming dot stays amber as a transitional state. The RGB
gizmo and the authored `#6366f1` polygon fill are untouched.

SVG overlay strokes cannot take Tailwind classes, so they are named constants
at the top of `CanvasWorkspace.tsx` that mirror the palette by hand; the
polygon off-canvas outline moved from `#818cf8` to the accent green, and the
first-vertex marker from `#10b981` to the same value, so the drawing overlay
has one green rather than two.

Verified with `npm run typecheck`, `npm run lint`, `npm test` (284 passing), and
`npm run build`, then in headless Chromium against the dev server: both modals
including the ZIP radios and a running export, the four mode empty states, and
the symmetry, polygon, and 3D handle overlays captured over both black and
white artwork. Console clean throughout. The states the Phase 0 record listed
as unreachable in a browser — the connected/streaming green, the ProRes and
Frames (Folder) chrome, the resume checkbox, the encoder-speed cards, and the
`ws://`-on-HTTPS notice — are still unreachable and still need a manual pass on
desktop.

### Phase 5: Cleanup and documentation

1. Search the component tree for remaining `indigo`, `cyan`, `teal`, `lime`,
   `orange`, and literal blue UI treatments.
2. Classify every remaining match as one of:
   - authored or preset content color;
   - status color;
   - coordinate/geometry encoding;
   - defect still requiring migration.
3. Avoid introducing a new component abstraction solely to remove repeated
   class strings. Add or extend a shared primitive only where behavior and
   semantics are already genuinely shared.
4. Add a concise theme description to [`README.md`](../../README.md) when the
   implementation lands.
5. Update this document's status and record any palette adjustments made during
   visual QA.

## Accessibility requirements

- Normal text should meet WCAG AA contrast of at least 4.5:1.
- Large text and focus indicators must meet at least 3:1 against adjacent
  colors. This is firm: focus has no fallback signal, and `ui-accent` measures
  7-9:1 on every neutral surface.
- **Neutral surface boundaries are exempt from 3:1.** The graphite border ladder
  is deliberately quiet — measured, `ui-border` is 1.44:1 and `ui-border-strong`
  2.03:1 against `ui-panel`, and reaching 3:1 would need roughly `#5F6669`,
  which would abandon the restrained look this palette exists for. The trade is
  accepted on the condition below, which is what keeps it a considered choice
  rather than a contrast failure.
- Every control must stay identifiable without its border. In practice this
  means a fill that differs from its container (inputs and selects recess to
  `ui-canvas`), plus a persistent label, icon, or shape — never a bare outline
  on a flat surface. A control that would be invisible with its border removed
  needs a distinct fill, not a lighter border.
- Keyboard focus must remain clearly visible on every interactive control.
- Selected, connected, warning, error, and disabled states must not rely on hue
  alone; retain labels, icons, shape, borders, or motion where applicable.
- Hover must not be the only way to expose a required action.
- Native form controls and scrollbars should remain coherent with the declared
  dark `color-scheme`.

## Acceptance criteria

- The application reads as one neutral dark studio across all modes.
- Indigo is removed from general UI selection, focus, progress, and primary
  actions.
- Cyan, teal, lime, and orange no longer theme entire modes or inspector
  sections.
- Green has one consistent meaning: interaction, active state, progress, or
  positive status.
- Magenta is visibly present but subordinate, primarily around creative/effect
  features.
- Amber and red appear only in their documented semantic roles.
- Shared controls look and behave consistently in every inspector.
- Authored content, saved projects, render output, and export pixels are
  unchanged.
- No dependency, document-schema, or renderer change is required.

## Validation

Run the normal frontend checks:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Then manually verify:

1. all seven modes in their empty state;
2. representative populated stacks and selected rows;
3. every shared control in resting, hover, focus, active, and disabled states;
4. Master FX disabled and enabled;
5. Export and Live Output, including progress, warning, error, connected, and
   disconnected states;
6. canvas drag-over, selection handles, symmetry/polygon origins, and the 3D
   axis gizmo;
7. the browser build and, when practical, `npm run tauri dev`.

Because this work changes application chrome rather than rendered scene
semantics, PixiJS/Canvas 2D output comparison is not required unless an edit
crosses into renderer-owned drawing.

## Future guardrail

New UI should begin with semantic neutral, green, or magenta tokens. A raw hue
class is appropriate only when the color represents authored content, a
documented status, or an established editing convention. New creative modes
may have independent concepts and layouts, but should inherit this shared
studio color language.
