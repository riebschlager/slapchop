# Unified UI color system

- **Status:** Accepted; implementation pending
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
| `ui-text-subtle` | `#747B77` | Hints, metadata, and disabled-adjacent text |
| `ui-accent` | `#28C76F` | Primary actions, selection, and checked state |
| `ui-accent-hover` | `#3DDA82` | Hover and high-emphasis interactive state |
| `ui-accent-strong` | `#159A50` | Pressed state and dark green boundaries |
| `ui-accent-contrast` | `#06140C` | Text and icons on bright green fills |
| `ui-creative` | `#C23C92` | Secondary creative/effect emphasis |
| `ui-creative-hover` | `#D955AA` | Hovered creative emphasis |
| `ui-creative-text` | `#EE75C5` | Magenta text or icon on dark surfaces |

The precise values may be adjusted during contrast and visual QA, but their
roles should remain stable.

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
- Large text, focus indicators, and meaningful component boundaries should meet
  at least 3:1 against adjacent colors.
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
