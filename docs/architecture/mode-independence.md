# Independent creative modes

- **Status:** Accepted
- **Date:** 2026-08-23
- **Scope:** Product direction and target application architecture

## Context

Slapchop began by treating its creative modes as variations on a common scene
model. That encouraged useful reuse, but it also created pressure to make a
feature available in every mode and to align controls whose meanings were only
superficially similar.

The clearest example is Voronoi. Subdividing a polygon into animated shards is a
natural polygon operation. Presenting the same operation as layer symmetry in
the Symmetry canvas requires special rendering behavior and makes both the
feature name and the shared abstraction less coherent. Similar pressure appears
whenever inspector tabs, document fields, or rendering concepts are shared in
order to keep two modes parallel rather than because the creative workflow is
actually the same.

We also want to add modes that can depart substantially from the existing 2D
layer and polygon models. Cross-mode parity would make those modes harder to
design and would turn every new concept into an application-wide concern.

## Decision

Slapchop is a collection of **independent creative modes** inside one studio.
The modes share a platform and an output goal, not a required feature set or
document model.

Every mode may define its own:

- creative vocabulary and feature set;
- document data, defaults, selection state, and undo boundaries;
- stack, inspector, and canvas interactions;
- live and fallback renderers;
- compatibility rules and migrations.

A feature should be added only to the modes where it is conceptually useful.
There is no requirement to add an equivalent control elsewhere, keep inspector
layouts parallel, or generalize two similarly named features into one domain
type. Voronoi should therefore be treated as polygon-owned behavior unless a
future Symmetry-canvas design independently justifies a distinct version of it.

The shared platform remains responsible for capabilities that are genuinely
common:

- the 1080 x 1920 design surface and resolution-aware viewport;
- deterministic frame time and the live/offline rendering contract;
- image, video, GIF, frame-sequence, ProRes, and live-output delivery;
- asset loading and the browser/Tauri boundary;
- application chrome, mode selection, keyboard accessibility, and low-level UI
  primitives;
- generic utilities whose semantics are truly the same in every caller.

Sharing an implementation is an optimization, not a product requirement. We
should extract shared code after the semantics prove identical; we should not
change a mode's concepts to make extraction possible.

Mode independence does not require separate applications or separate project
files. A `.slapchop` file may remain a workspace containing data for multiple
modes, but each mode's payload should become an independently versioned unit.
Moving content between modes, if supported, should be an explicit import or
conversion with clear lossiness rather than an implicit consequence of shared
types.

## Consequences for current work

- Stop extending the shared 2D `SymmetryType`, `SymmetryParams`,
  `InspectorSubject`, and shared inspector tabs merely to maintain parity
  between layer and polygon modes.
- Existing saved projects must continue to open. Removing a cross-mode feature
  from a UI does not justify silently discarding its persisted data.
- The current aggregate store, renderer state, and project format can remain
  during an incremental migration. This decision does not require a flag-day
  rewrite.
- Common output services continue to accept a deterministic frame producer;
  they should not need to understand a mode's internal document shape.
- Master FX can remain a shared rendering capability, but each mode should opt
  into it and own any mode-specific defaults or limitations. A shared effect
  pipeline does not require every mode to expose identical controls.
- A new mode should be addable primarily by creating a mode-owned module and
  registering it with the shell, with minimal edits to existing modes.

## Target seams

The following boundaries describe a direction, not a mandate to introduce a
large plugin framework immediately.

| Area | Current coupling | Direction |
| --- | --- | --- |
| Domain types | `src/types.ts` contains all mode models, and Layer/Polygon share symmetry types | Keep platform types small; move creative models under mode-owned modules and share only proven primitives |
| State and history | `src/store.ts` stores every mode in one document and one undo timeline | Give each mode a state/history slice with an explicit snapshot boundary; keep shell state separate |
| UI composition | `StackPanel`, `InspectorPanel`, and `CanvasWorkspace` branch repeatedly on `appMode` | Let the shell select mode-owned Stack, Inspector, and Stage interaction components |
| 2D inspector | `InspectorSubject` and shared tabs align Layer and Polygon concepts | Prefer dedicated mode inspectors; reuse leaf controls such as sliders or blend selectors where semantics match |
| Rendering | `RenderState` contains every mode and renderers switch on `appMode` | Dispatch a mode-specific render snapshot through a small renderer contract |
| Export | Export snapshots the entire aggregate document | Snapshot only the active mode and pass its frame producer to the shared encoders |
| Persistence | Project V2 has top-level arrays/config for all modes | Evolve toward independently versioned mode payloads inside a backward-compatible workspace envelope |
| Cross-mode reuse | Shared fields make behavior appear automatically portable | Use explicit adapters for intentional copy/import flows; document unsupported or lossy mappings |

## Incremental migration path

1. **Stop deepening the bridge.** New features start in one mode and remain
   there unless another mode has its own product case. Hide inappropriate
   controls before deleting persisted fields.
2. **Split mode UI composition.** Extract mode-owned Stack, Inspector, and Stage
   interaction components while keeping the existing Zustand store. This
   reduces conditional branching without changing document compatibility.
3. **Introduce a render boundary.** Replace the aggregate `RenderState` passed
   through export with a discriminated active-mode snapshot and renderer. Keep
   the deterministic `(time, snapshot)` contract and renderer parity within
   each mode.
4. **Separate state and undo.** Move document mutations and history into
   per-mode slices. Undo in one mode must not mutate hidden content belonging to
   another mode.
5. **Version mode payloads.** Add a new project-file version only when the
   internal separation provides enough value to justify migration code. Read V1
   and V2 through compatibility adapters and preserve assets.
6. **Retire accidental abstractions.** Once compatibility paths exist, split
   the global symmetry model. Polygon Voronoi can become a polygon operation,
   while Symmetry keeps only transformations that fit its layer workflow.

## Near-term code candidates

The first implementation slice should be deliberately small:

1. Remove Voronoi from the Symmetry-canvas picker while preserving the ability
   to load and render old projects that used it.
2. Rename or wrap the polygon control as a polygon effect/partition rather than
   relying on the global symmetry vocabulary.
3. Extract `SymmetryModeInspector` and `PolygonModeInspector`; continue sharing
   low-level controls but remove the requirement that their tab positions and
   subjects match.
4. Add tests proving old files retain their data and active-mode exports remain
   frame deterministic.

This slice delivers the product intent users can see while establishing seams
for later state, renderer, and persistence work.

### Initial implementation

Completed on 2026-08-23: the Symmetry and Polygon inspectors now own separate
tab composition and choice lists. Voronoi is offered as a Polygon pattern and
is unavailable for new Symmetry layers. Existing Symmetry layers with persisted
Voronoi settings remain visible as legacy content and continue to load, render,
and save without a project-version change.

## Guardrails

- Do not duplicate deterministic timing, encoding, native I/O, or asset
  lifecycle code inside modes.
- Do not create a lowest-common-denominator mode interface that exposes every
  possible panel, gesture, or renderer feature. Keep the shell contract small
  and add optional capabilities only when a real mode needs them.
- Maintain PixiJS/Canvas 2D parity within each mode unless a documented
  compatibility decision says otherwise.
- Preserve browser/Tauri parity and release inactive mode resources when modes
  unmount or renderers switch.
- Treat conversion between mode documents as a product feature with tests and
  explicit compatibility behavior.

## Revisit when

Revisit this decision if users demonstrate that they need a single composition
containing several modes at once, rather than switching among independent tools.
That would call for an explicit composition mode or render graph; it should not
be implemented by merging the individual mode schemas again.
