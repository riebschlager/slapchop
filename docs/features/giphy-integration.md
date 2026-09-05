# GIPHY integration development plan

- Status: Phase 0 in progress; no product code written.
- Working record: [Phase 0 spike note](./giphy-spike-note.md).
- Date: 2026-09-05.
- Target: Personal-use, bring-your-own-key integration in browser and desktop.
- Provider: GIPHY (the service referred to as “gify” in the feature request).

## Intended outcome

Every existing GIF import surface gains a **Search GIPHY** option. A user can
search, preview, and select GIFs without manually downloading and uploading
files. Single-texture destinations accept one result; folder/library destinations
accept multiple results. Selections survive successive queries within the picker,
and subsequent imports can append to the same composition.

Selected GIF bytes become local project assets. Playback, rendering, and export
use those bytes through the existing GIF pipeline. Saved `.slapchop` projects
remain self-contained and can open without a key or network connection.

The user confirmed that imported assets should persist locally before a project
is saved, while compositions are saved manually. Provide a small Recent Imports
view for recovering those assets after restart. Scene settings, placement, and
unsaved composition state still require an explicit project save; full-document
autosave is outside this feature.

## Provider feasibility dependency

The desired offline workflow needs provider clarification before implementation
is considered ready to ship. GIPHY's current integration guidance prohibits
storing media copies without explicit approval and requires revalidation for
approved caching. An approval for delivery caching would not necessarily cover
permanent project embedding or offline use. Client requests must be direct;
result ordering and returned media URLs must be preserved.
[GIPHY integration guidance](https://developers.giphy.com/docs/api/)

The API terms also restrict building or supplementing GIF databases/directories
and require available creator/source attribution. Confirm how these apply to
project libraries, Recent Imports, transformed compositions, and exported media;
personal use and a user-supplied key should not be assumed to waive them.
[GIPHY API terms](https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service)

Milestone 0 must establish whether the requested local copies, retained imports,
portable project files, and offline exports are permitted together. Record the
answer and any conditions here. If required revalidation makes offline use
impossible, explicitly revisit the product requirement. A remote-URL-only picker
would be a scope change and would not fulfill this plan. Ordinary local-file
imports remain available. Planning and tests using owned fixtures can proceed
without a live key; this plan does not authorize contacting GIPHY on the user's
behalf.

GIPHY documents beta keys at 100 calls per hour and separate keys by platform and
integration section. Confirm whether this single shared picker counts as one
section across creative modes, and how the desktop client is classified. Show
approved Powered By GIPHY branding in the picker. Do not assume production use
has the same limits or pricing as personal beta use.
[GIPHY quickstart](https://developers.giphy.com/docs/api/quick-start-guide/)

All asset-retention and offline acceptance criteria below are conditional on that
feasibility decision; they describe the requested product, not a claim that the
standard API agreement already permits it.

### Milestone 0 decision record

**Decision: Pending.** No provider answer has been recorded, and the three-origin
request spike has not been run. Phase 6 is blocked; Phases 1-5 are blocked only
until the spike passes.

| Question | Decision | Conditions | Source and date |
| --- | --- | --- | --- |
| Retention of local copies | Open | | |
| Permanent project embedding | Open | | |
| Offline export | Open | | |
| Recent Imports vs. database/directory restriction | Open | | |
| Required attribution (in-app and in exported media) | Open | | |
| Platform/section key mapping for one shared picker | Open | | |
| Rate limit and production classification | Open | | |

Working answers, sources, and per-origin request results are collected in the
[Phase 0 spike note](./giphy-spike-note.md). Transcribe the outcome into the
table above when the decision is made, and update the Status line at the top of
this document. Until then, treat every retention and offline statement below as
a requested product behavior, not an approved one.

## Existing architecture

The implementation should follow [mode independence](../architecture/mode-independence.md):
share acquisition and asset lifecycle services, while each mode owns how imports
change its document.

| Area | Current implementation and implication |
| --- | --- |
| Main import UI | `src/components/panels/StackPanel.tsx` contains layer, polygon texture, and folder/library inputs. |
| 3D texture UI | `Mesh3dRow.tsx` and `inspector/Texture3dTab.tsx`, composed through `StackPanel.tsx` and `InspectorPanel.tsx`. Both need an entry point. |
| Drag and drop | `src/components/CanvasWorkspace.tsx` handles browser/native imports. Preserve local drops; offer search beside visible import/empty-state affordances, not inside OS dialogs. |
| Store | `src/store.ts` decodes files and creates object URLs. Tunnel and GIF Voronoi already append; Flythrough and Landscape terrain only replace. Sky sources can be created or replaced. |
| GIF decoding | `src/lib/gifUtils.ts` uses omggif, then gifuct-js, and materializes frame bitmaps. A null result can mean a static GIF or a decode failure; remote import needs explicit validation and useful errors. |
| Project persistence | `src/lib/project.ts` currently writes V6 JSON with embedded data URLs, deduplicated by runtime source URL, and reads V1–V6. It reconstructs object URLs and decoded frames when opening. |
| Native boundary | `src/lib/native.ts` wraps native file access. Existing filesystem dependencies should suffice for app-owned media storage; credentials may need a narrowly scoped native addition. |
| History | Current `partialize` includes all mode documents/configuration, canvas background, and Master FX. UI state stays outside history; a 350 ms coalescer requires care for discrete import transactions. |

No renderer-specific GIPHY model is needed. Do not modify mode geometry, frame
timing, output dimensions, or renderer choice to implement an import source.

## User experience

### Key setup

Add **Settings → Integrations → GIPHY**, also reachable from the unconfigured
picker. Provide a masked key field, show/hide, save/use, replace, forget, and a
link to the developer dashboard. Do not ask for a key in a chat message or commit
one to source, `.env` examples, builds, logs, or project files.

Use session-only credentials by default. Offer **Remember on this device**:
desktop should use macOS Keychain through a small credential boundary; browser
may use explicitly opted-in local storage, with copy explaining that scripts on
the same origin can read it. Do not describe browser storage as a secret vault.
Forgetting a key removes remembered and in-memory credentials without removing
imported media. Keep non-secret preferences separate from credentials and undo.
If platform/section keys are required, resolve them through a context-key map
rather than scattering key fields across mode components.

Validate through the first explicit search; a separate Test action, if included,
must say it consumes an API request. No polling or background validation.

### Shared picker

- A modal displays its destination, search field, rating control, result grid,
  selection count, import action, and attribution. Follow existing modal styling,
  semantic theme tokens, Lucide icons, and shared controls.
- Submit with Enter or Search; use explicit Load More rather than automatic
  pagination. Start empty to conserve the personal key's quota. Trending,
  autocomplete, stickers-specific browsing, favorites, and other providers are
  outside the first release unless the provider requires a change.
- Proposed defaults: 25 results/page, English, PG-13 maximum rating. Let the user
  change rating through the API parameter. Preserve the exact query text; reject
  an invalid length visibly instead of silently rewriting it.
- Show lightweight animated previews with title and available creator/source
  attribution. Pause offscreen previews, respect reduced-motion preferences, and
  provide an accessible selection label. Do not decode every preview into the
  application's full animation-frame representation.
- Preserve provider result order. Show unsupported/broken items with an
  explanation in place. Keep local imports outside the provider search grid.
- Multi-select uses an ordered selection tray keyed by GIPHY ID. Changing query
  or loading another page retains selected items; selecting the same ID twice
  does not duplicate it. Tray ordering is user intent, distinct from search rank.
- Import commits the selected batch in selection order. Keep the picker open
  after a successful multi-import, clear committed selections, and support
  another search/import into the same destination. Single import closes on success.
- Closing discards the uncommitted tray and aborts requests. Keyboard focus is
  trapped in the modal and restored to the invoking control on close.

### Destination behavior

| Existing destination | Selection | Commit behavior |
| --- | --- | --- |
| Symmetry Add Images/GIFs | Multiple, matching the existing multi-file input | Add one layer per selected GIF at the normal center-origin defaults. |
| Polygon texture upload | Single | Replace the captured polygon texture; with no selected polygon, create the current default polygon. |
| 3D mesh row texture button | Single | Replace that row's mesh texture. |
| 3D inspector texture upload | Single | Replace the inspected mesh texture. |
| GIF Flythrough folder/files | Multiple | Add to the existing source library by default. Add a mode-owned append mutation. |
| GIF Tunnel folder/files | Multiple | Append to its mixed-image library; preserve existing local images. |
| GIF Voronoi folder/files | Multiple | Append valid animated GIFs to the current library. |
| Landscape terrain folder | Multiple | Append valid animated GIFs; add a terrain append mutation. |
| Landscape new sky folder | Multiple | Create one named sky source from the whole tray, including selections across queries. |
| Landscape existing sky folder | Multiple | Offer Add GIFs to this source and explicit Replace source contents; retain source ID and mapping settings. |

Use clearly labeled Add and Replace actions. A second search must never silently
replace a library. Repeated IDs already in a destination are marked Already added
and skipped by default; replacing the same texture is a no-op. Intentional
duplication can continue through existing document controls. Preserve stable
asset order; never reorder by download completion, filename, or query.

Capture destination kind, target ID, operation, and document generation when
opening the picker. Selection changes must not retarget an asynchronous import.
Opening another project or deleting the target invalidates the pending commit
with a visible explanation. Serialize imports per destination and disable
duplicate submission while a batch is running.

## Technical design

### GIPHY client

Implement a small typed `src/lib/giphy.ts` adapter using fetch and AbortController,
without an SDK dependency. Search uses
`https://api.giphy.com/v1/gifs/search` with `api_key`, `q`, `limit`, `offset`,
`rating`, and `lang`. Validate responses and expose a minimal result DTO rather
than spreading unchecked provider JSON through React. The current endpoint
documents a 50-character query limit, beta page limits, and offset pagination.
[Search API reference](https://developers.giphy.com/docs/api/endpoint/)

Use request generations to discard stale responses, including after key changes.
Handle authentication errors, 429, server errors, offline/network errors, and
malformed responses distinctly. Respect Retry-After when supplied; otherwise
offer manual retry without inventing a reset time. Never log a request URL that
contains a key. Avoid persistent response/media-URL caching.

Use the returned GIF rendition URL for import, preferably `images.original.url`;
preview renditions can be smaller. Validate that an actual GIF is available.
Never import an MP4/preview still while labeling it as the chosen animated GIF,
or silently substitute a lower-quality rendition. If a size limit is exceeded,
offer a clearly identified smaller GIF rendition or let the user deselect it.

API and media requests originate in the client. Test CORS from localhost, the
hosted browser origin, and packaged WKWebView early. Do not add a backend proxy
as a workaround. A native HTTP fallback, if necessary, requires a separate
feasibility/security decision and a bounded client-side implementation.

### Acquisition and validation

Introduce `src/lib/assetImport.ts` to orchestrate acquisition independently of
mode mutations:

1. Freeze the ordered selection and destination token.
2. Fetch selected GIF bytes with cancellation, timeout, streamed byte limits,
   and bounded concurrency; start at two downloads and one decode at a time.
3. Validate HTTPS provider media hosts, redirects, GIF signature, byte length,
   dimensions, and frame count. Preserve permitted URLs exactly. Treat provider
   titles as text, never HTML or filesystem paths.
4. Preflight decoded memory before allocating all frame bitmaps. Proposed initial
   limits: 20 MiB/file, 2048 pixels/side, 500 frames/file, 256 MiB estimated RGBA
   frames/file, and 512 MiB total staged decoded frames. Measure representative
   assets and tune these named limits before release; compressed size alone is
   insufficient. Include existing active assets in the memory budget.
5. Decode once using the existing semantics and produce a prepared asset. Preserve
   static GIF support where the destination supports it; report non-animated or
   failed decodes for GIF Voronoi and Landscape instead of silently dropping them.
6. Persist validated source bytes, then commit a synchronous mode-owned batch
   mutation. Return structured per-item errors if preparation fails.

Default to an all-or-nothing document commit. On partial failure keep the tray,
show failed items, and offer Retry failed or Remove failed and import remaining.
No incomplete document entries. Cancellation releases staged frames and URLs
and rolls back uncommitted storage records. Crash leftovers are cleaned on the
next repository open. Existing committed composition content stays intact.

Separate preparation from mutations in `src/store.ts` so this flow does not
decode twice or repeatedly call async actions that read mutable selection.
One completed batch is one undoable action. Explicitly test against the current
350 ms coalescer so quick consecutive imports and neighboring slider gestures
remain separate actions. Do not pause global history during network activity.

### Durable asset storage

Under the provider-approved retention scope, use a small asset repository with
put/get/list/remove operations and platform adapters:

| Platform | Proposed persistence |
| --- | --- |
| Desktop | GIF bytes under app-owned application data, using hash-based filenames and a versioned manifest. Write through temporary files and atomic rename; recover interrupted writes. No remote names become paths. |
| Browser | IndexedDB records containing source Blobs and metadata, committed transactionally. Request persistent storage when the user enables retention, and report quota/write failures before completing import. |

IndexedDB supports structured records and file/blob storage.
[IndexedDB reference](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
Browser retention remains origin-specific and subject to storage availability,
eviction, private-session behavior, and user clearing. A persistence request can
be denied; saved project files remain the portable durable copy.
[Browser storage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

Content hashes deduplicate raw bytes; mode entries retain their own IDs and
ordering. Metadata includes filename, MIME type, byte count, dimensions, import
time, and optional GIPHY provenance (GIF ID, page URL, title, creator/source,
rendition name). Do not persist API keys, search history, expiring media URLs,
or decoded frames as asset metadata.

Recent Imports displays only user-imported assets, offers re-add to the active
destination, and exposes used storage and removal. It is not a downloaded search
catalog. Retained assets stay until explicitly removed; no silent eviction by
the app. Prevent deletion while current document, undo/redo history, an export,
or an in-flight operation depends on the bytes. Do not automatically delete an
import when its scene entry is removed. Saved projects remain independent of
this repository.

Object URLs and decoded frames are runtime resources. Reference tracking must
include duplicates, hidden modes, history snapshots, and export snapshots.
Revoke URLs and close bitmaps only after their last reference is released;
release staged resources immediately on cancellation/failure. Avoid retaining
decoded frames merely because raw bytes remain in Recent Imports.

### Project format

Keep the existing embedded-source format for this feature. Add optional
provenance and content-hash metadata to `ProjectAsset` in V6, with validation and
defaults for absence; no incompatible schema change is planned. Maintain a
runtime source-metadata registry so save/open does not depend on the local
repository being present. Associate materialized URLs with that metadata on load.

V1–V6 files remain readable. Test that older V6 readers still render files with
optional metadata (they may discard that metadata on re-save). If implementation
requires a new mandatory field, introduce V7 explicitly and update every V6-only
branch, particularly Landscape loading, rather than silently changing V6.

Save embeds the actual imported bytes regardless of repository location. Opening
a project reconstructs assets from its embedded payload with no API calls,
credentials, machine paths, or network fallback. Validate provenance URLs as
untrusted input; metadata must never trigger automatic network requests.

## Phased workplan

Each phase below is a self-contained handoff: one agent, one branch, one review.
Phases run in order unless marked parallel-safe. A phase is finished only when
its **Done when** list is satisfied and `npm run typecheck`, `npm run lint`,
`npm test`, and `npm run build` pass; Rust-touching phases add `cargo fmt
--manifest-path src-tauri/Cargo.toml --check` and `cargo check --manifest-path
src-tauri/Cargo.toml`.

The ordering deliberately defers durable storage (Phase 6) until after the
picker and all destinations work. Storage is the part most exposed to the
Milestone 0 retention answer; if retention is refused or narrowed, only Phase 6
is invalidated, and Phases 1-5 still ship a working session-scoped importer whose
output is preserved by ordinary project save. Do not reorder storage earlier for
convenience.

### Grounding notes from the current code

Verified against the tree on 2026-09-05. Agents should re-confirm before editing;
these facts shape several tasks below.

- **Every mode import action already takes browser `File` input** — one `File`
  for single-texture destinations (`addLayerFromFile(file, x, y)`,
  `uploadPolygonTexture(file)`, `uploadMesh3dTexture(file)`) and `File[]` for
  libraries (`replaceFlythroughAssets`, `addTunnelAssets`,
  `addGifVoronoiAssets`, `replaceLandscapeTerrainAssets`,
  `addLandscapeSkySource`, `replaceLandscapeSkySource(id, files)`). The
  acquisition layer should therefore terminate in validated `File` objects, so
  remote and local imports converge on the same mutations rather than growing a
  parallel remote-only path.
- **Three append mutations are genuinely missing:** Flythrough has only
  `replaceFlythroughAssets`, Landscape terrain has only
  `replaceLandscapeTerrainAssets`, and existing sky sources have only
  `replaceLandscapeSkySource`. Tunnel and GIF Voronoi already have `add*`.
- **Symmetry is per-file.** `addLayerFromFile` calls `set` once per file and also
  moves `selectedLayerId`. N GIFs from one tray would produce N store writes
  against the 350 ms coalescer — an unpredictable number of undo steps. A batch
  action is required, not optional.
- **A selection-retargeting race already exists.** `uploadPolygonTexture` and
  `uploadMesh3dTexture` both `await parseGifFile(file)` and only then read
  `get().selectedPolygonId` / the selected mesh. Network latency widens that
  window from milliseconds to seconds. The captured-destination-token design is
  fixing a live bug, not just a hypothetical one.
- **`parseGifFile` returns `null` for static GIFs, non-GIFs, and decode
  failures alike** (`src/lib/gifUtils.ts:5`); `parseWithOmggif` returns null when
  `numFrames <= 1` before the gifuct fallback runs. Remote import must
  distinguish these three cases.
- **There is no Settings surface anywhere in the app.** Modals are mounted
  ad hoc: `WelcomeModal` in `AppShell.tsx`, `ExportModal` and `LiveOutputModal`
  in `InspectorPanel.tsx`. Settings is new UI, and its shell should be built once
  in Phase 4 rather than assumed to exist.
- **Non-secret preference precedent is `src/lib/welcomePref.ts`** — a tiny
  localStorage module with a colocated test. Mirror that shape for GIPHY
  preferences; keep credentials out of it.
- **`src-tauri/tauri.conf.json` sets `security.csp` to `null`,** so no policy
  blocks `api.giphy.com` today. The packaged origin is still a custom scheme, so
  CORS must be verified from the real WKWebView, not inferred from dev. If a CSP
  is ever introduced, GIPHY hosts must be added deliberately.
- **No HTTP or credential plugin is in `package.json`.** Desktop currently ships
  `@tauri-apps/plugin-{dialog,fs,shell,window-state}` only, and
  `src-tauri/capabilities/default.json` already grants `fs:scope` `**`. Any
  Keychain access is a new dependency plus a new capability; a native HTTP
  fallback is a separate decision (see Technical design).
- **Project format:** `src/lib/project.ts` writes V6 with
  `ProjectAsset { name, type, dataUrl }`, deduplicating by runtime `src` string
  inside `assetIdFor`. Reads accept V1-V6. History is `partialize` + a 350 ms
  `handleSet` coalescer + `limit: 100`.

### Phase 0 - Feasibility and request spike (blocking, human-led)

**Goal:** convert the open provider questions into a recorded decision, and prove
the three-origin request path before any product code is written.

Not an agent task. An agent may prepare the spike harness and the write-up
skeleton, but must not contact GIPHY, register a key, or accept terms on the
user's behalf.

- Resolve the Provider feasibility questions above: retention of local copies,
  permanence of project embedding, offline export, Recent Imports versus the
  database/directory restriction, required attribution in-app and in exported
  media, and platform/section key mapping for a shared cross-mode picker.
- With a user-configured key, verify search, preview rendition load, and
  `images.original.url` fetch from: `localhost:3000`, the hosted browser origin,
  and a packaged `npm run tauri build` app. Record CORS response headers per
  origin, observed rate-limit headers, and whether `Retry-After` is sent.
- Record the answer, conditions, and date in the Provider feasibility section of
  this document. If retention is refused, stop and revisit the requirement with
  the user before starting Phase 6 — Phases 1-5 remain valid.

The harness and the write-up skeleton are already in the tree:

- `docs/features/giphy-spike/` - a standalone page plus `spike.js`, which runs
  search, preview rendition load, and `images.original.url` fetch, and emits a
  markdown block for the note. The key is held only for the run, is never
  stored, and is redacted from every surface. One run spends one API call.
- `scripts/giphy-spike.sh stage|unstage|status` - copies the harness into
  `public/__giphy-spike/` so the same file is reachable from the dev server and
  from inside a packaged build, then removes it. The staged path is gitignored,
  so it cannot be committed or deployed; still run `unstage` before any real
  build. Run the script with no argument for the per-origin procedure.
- `docs/features/giphy-spike-note.md` - the questions, the pass criteria, the
  per-origin result slots, and the decision block.

The hosted origin needs no deploy: open the deployed app and paste `spike.js`
into its devtools console. The origin is what is under test, not the page. A
packaged release build has no devtools, which is why the harness page has to be
staged into that build to cover the third origin honestly.

**Done when:** the feasibility section states an explicit decision with
conditions, and a spike note records per-origin request results. No product code.

### Phase 1 - Store seams and batch mutations (parallel-safe with Phase 3)

**Goal:** make every destination commit as one synchronous, undoable batch from
already-decoded input. No network, no UI, no new dependencies.

Files: `src/store.ts`, `src/types.ts`, new `src/store.test.ts` (or extend an
existing store test if one is added first).

1. Split decode from mutation. Extract the existing `*AssetsFromFiles` helpers so
   each mode has a pure `prepare` step returning fully-formed asset records, and
   a synchronous `commit` mutation that only calls `set`. Existing async actions
   stay as thin wrappers over the pair so local-file behavior is unchanged.
2. Add the missing append mutations:
   - `addFlythroughAssets(files: File[]): Promise<void>` - append, preserving order.
   - `addLandscapeTerrainAssets(files: File[]): Promise<void>` - append valid
     animated GIFs.
   - `addLandscapeSkySourceAssets(id: string, files: File[]): Promise<void>` -
     append into an existing source, retaining source ID, name, and all mapping
     settings (`textureScale`, `textureOffset*`, `textureRotation`, `gifSpeed`).
3. Add `addLayersFromFiles(files: File[], x?, y?): Promise<void>` for Symmetry:
   one `set`, one history entry, layers appended in the given order, selection
   moved to the last added layer.
4. Fix the retargeting race: `uploadPolygonTexture` and `uploadMesh3dTexture`
   must capture the target ID before awaiting the decode, and no-op with a
   surfaced reason if that target is gone on commit. Add an explicit
   `applyPolygonTexture(targetId, prepared)` / `applyMesh3dTexture(targetId,
   prepared)` seam the import layer can call directly.
5. Verify undo granularity against the real coalescer: two batch commits fired
   under 350 ms apart must still produce two undo steps, and a batch commit must
   not merge with a neighboring slider gesture. If `handleSet` collapses them,
   fix it here (an explicit "discrete transaction" bypass is acceptable; global
   `pauseHistory` during async work is not).

**Done when:** store tests cover, for each destination, add-versus-replace,
stable ordering, target captured before await, deleted-target no-op, and exactly
one undo/redo step per batch. Local-file import behavior is byte-identical to
today in all seven modes.

### Phase 2 - Acquisition, validation, and asset metadata (no network)

**Goal:** the bounded prepare-then-commit pipeline, exercised entirely with
owned local GIF fixtures. A `fetchBytes` function is injected, so this phase
needs no key and no provider.

Files: new `src/lib/assetImport.ts` + test, `src/lib/gifUtils.ts`,
`src/lib/project.ts` + test, `src/types.ts`.

1. Define the destination token and result types in `src/types.ts`:
   `ImportDestination { kind, targetId, operation: 'add' | 'replace', docGeneration }`,
   `ImportCandidate`, `PreparedAsset`, and a discriminated `ImportItemError`.
2. Implement `importAssets(candidates, destination, deps)` following the six
   steps in Acquisition and validation: freeze selection, bounded fetch (2
   concurrent downloads, 1 decode), validate, preflight memory, decode once,
   commit. All-or-nothing document commit by default.
3. Named, exported limit constants so they are tunable and testable in one place:
   `MAX_BYTES_PER_FILE` (20 MiB), `MAX_PIXELS_PER_SIDE` (2048),
   `MAX_FRAMES_PER_FILE` (500), `MAX_DECODED_BYTES_PER_FILE` (256 MiB),
   `MAX_STAGED_DECODED_BYTES` (512 MiB). Include already-active assets in the
   staged budget.
4. Disambiguate decode outcomes. Give `gifUtils` a result that separates
   "static GIF", "not a GIF", and "decode failed" without changing
   `parseGifFile`'s current signature or behavior for existing callers. Static
   GIFs stay supported where the destination supports them; GIF Voronoi and
   Landscape report them as skipped rather than dropping them silently.
5. Cancellation and rollback: an aborted or failed batch releases staged object
   URLs and decoded frames immediately and leaves the document untouched.
6. Runtime source-metadata registry + project format. Add optional
   `provenance` and `contentHash` to `ProjectAsset` in V6 with validation and
   absence defaults. Keep the registry keyed independently of the local
   repository so save/open never depends on it. Treat any persisted provenance
   URL as untrusted on load; it must never trigger a request.

**Done when:** tests cover each limit boundary, ordered multi-item preparation,
partial failure leaving no document mutation, cancellation releasing resources,
V1-V6 read compatibility, provenance round-trip, and a V6 file with provenance
still opening in a reader that ignores the field. Still no network code.

### Phase 3 - GIPHY client and credential boundary (parallel-safe with Phase 1)

**Goal:** a typed, cancellable, key-safe provider adapter and the credential
storage it needs. Tested against recorded/synthetic responses, not the live API.

Files: new `src/lib/giphy.ts` + test, new `src/lib/giphySettings.ts` + test,
possibly `src-tauri/src/`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`.

1. `searchGifs({ query, limit, offset, rating, lang }, { signal, apiKey })`
   against `https://api.giphy.com/v1/gifs/search`, using `fetch` +
   `AbortController` and no SDK. Validate the response shape and return a
   minimal DTO; never spread raw provider JSON into React.
2. Distinct, typed error variants for auth failure, 429, 5xx, offline/network,
   malformed response, and abort. Honor `Retry-After` when present; otherwise
   offer manual retry without inventing a reset time. Never include the key in a
   thrown message, a log line, or a breadcrumb — add a test that asserts the key
   never appears in any error surface.
3. Request generations so a stale response, including one issued under a
   replaced key, is discarded rather than rendered.
4. Rendition selection: prefer `images.original.url`, validate it is an actual
   GIF, and never substitute an MP4, a preview still, or a lower-quality
   rendition without saying so. Over-limit items offer an explicitly identified
   smaller GIF rendition or deselection.
5. Credentials. Session-only by default. `giphySettings.ts` owns the boundary:
   in-memory by default, opt-in remembering behind a platform adapter — browser
   localStorage with honest copy about same-origin script access, desktop macOS
   Keychain. Keep non-secret preferences (rating, page size, language) in a
   separate module modeled on `src/lib/welcomePref.ts`, outside undo. Forgetting
   a key clears memory and remembered storage and touches no imported media.
6. If Keychain requires a new crate or plugin, justify it in the PR, add the
   narrowest possible command surface, and do not widen the existing capability
   set beyond one credential permission. Do not add a shell download command. Do
   not add a backend proxy.

**Done when:** unit tests cover query encoding and the 50-character limit,
malformed responses, each error variant, stale-generation discard, abort, and
rendition validation; the key-leak test passes; credential storage round-trips
and clears on both platforms.

### Phase 4 - Settings surface, picker, and single-texture slice

**Goal:** first user-visible feature. Search, select one GIF, import it into a
polygon texture, and have it survive save/open and export.

Files: new `src/components/modals/GiphyPickerModal.tsx`,
`SettingsModal.tsx`, new `src/hooks/useGiphyPicker.ts`,
`src/components/AppShell.tsx`, `src/components/panels/StackPanel.tsx`,
`src/components/panels/Mesh3dRow.tsx`,
`src/components/panels/inspector/Texture3dTab.tsx`.

1. Build the Settings modal shell (Integrations → GIPHY: masked field, show/hide,
   save/use, replace, forget, dashboard link) and mount it plus the picker in
   `AppShell.tsx` beside `WelcomeModal`, since both are app-global rather than
   inspector-scoped. Reach Settings from the unconfigured picker too.
2. Build the picker per the Shared picker section: destination label, search
   field, rating control, result grid in provider order, selection tray, count,
   import action, Powered By GIPHY attribution, per-result title and available
   creator/source. Explicit Load More, empty initial state, focus trap, focus
   restored to the invoking control, Escape closes and aborts in flight requests.
3. Previews are lightweight animated renditions — `<img>` or video renditions —
   paused offscreen and respecting `prefers-reduced-motion`. Never route a
   preview through `parseGifFile`.
4. Use the existing control primitives from `src/components/controls/` and
   `cn()`; match `ExportModal`'s shell classes and semantic `ui-*` tokens.
   Keyboard operation must be complete without a pointer.
5. Wire the single-texture destinations: polygon texture, `Mesh3dRow` texture
   button, and the 3D inspector texture tab. Each opens the picker with a
   captured `ImportDestination`; commit goes through the Phase 1 apply seams.
   Single import closes the picker on success.
6. Add Symmetry's multi-layer action on top of `addLayersFromFiles`.
7. Local drop and file inputs are untouched. The search action sits beside the
   visible import affordance and the empty state, never inside an OS dialog.

**Done when:** with a user-supplied key, a GIF searched in the browser and in
`tauri dev` imports to a polygon, renders identically on the Pixi path and
`?renderer=2d`, produces one undo step, saves and reopens offline with no key,
and exports at short duration. Missing key, revoked key, and network loss each
produce a clear in-picker message.

### Phase 5 - Library destinations and multi-query composition

**Goal:** the ordered tray across queries, and every remaining destination.

Files: picker components, `src/components/panels/StackPanel.tsx`,
`GifVoronoiAssetRow.tsx`, `TunnelAssetRow.tsx`, landscape panel sections.

1. Ordered selection tray keyed by GIPHY ID: survives query change and Load More,
   never duplicates an ID, ordered by selection intent rather than search rank,
   removable individually and clearable.
2. Multi-import keeps the picker open, clears committed selections, and allows
   another search into the same destination.
3. Wire Flythrough, Tunnel, GIF Voronoi, and Landscape terrain to the append
   mutations, and sky sources to create-from-tray, add-to-source, and an explicit
   Replace source contents. Labels must read Add and Replace unambiguously; a
   second search must never silently replace a library.
4. Already-present IDs are marked Already added and skipped by default;
   re-importing the same texture is a no-op. Duplication stays available through
   existing document controls.
5. Serialize per destination, disable duplicate submission while a batch runs,
   and invalidate a pending commit with a visible explanation when the project is
   replaced or the target is deleted mid-flight.
6. Partial failure keeps the tray, lists failed items, and offers Retry failed or
   Remove failed and import remaining.

**Done when:** query A plus query B commit as one ordered batch into one library;
a second import appends without disturbing existing entries or local images;
project open during an in-flight import cancels it visibly; each destination has
a store test for add, replace, ordering, and single-undo-step behavior.

### Phase 6 - Durable storage and Recent Imports

**Gated on the Phase 0 retention decision.** Do not start until the feasibility
section records an approval and its conditions.

Files: new `src/lib/assetRepository.ts` + platform adapters + tests, new
`src/components/modals/RecentImportsModal.tsx` (or a Settings section),
possibly `src-tauri/src/` and capabilities.

1. Repository interface: `put`, `get`, `list`, `remove`, plus used-bytes
   reporting. Content-hash keys deduplicate raw bytes; mode entries keep their
   own IDs and ordering.
2. Desktop adapter: app-owned application-data directory, hash-based filenames, a
   versioned manifest, temp-file-plus-atomic-rename writes, recovery of
   interrupted writes, and cleanup of crash leftovers on next open. No remote
   name ever becomes a path component.
3. Browser adapter: IndexedDB Blobs plus metadata committed transactionally,
   `navigator.storage.persist()` requested when the user enables retention, and
   quota or write failure surfaced before the import is reported complete.
4. Metadata: filename, MIME type, byte count, dimensions, import time, optional
   GIPHY provenance. Never persist keys, search history, expiring media URLs, or
   decoded frames.
5. Recent Imports shows only user-imported assets, offers re-add to the active
   destination, and exposes storage use and removal. Deletion is blocked while
   the document, undo history, an export, or an in-flight operation references
   the bytes. Removing a scene entry never deletes the import. No silent eviction.
6. Reference tracking for object URLs and decoded frames must count duplicates,
   inactive modes, history snapshots, and export snapshots; revoke and close only
   after the last reference drops. Raw bytes surviving in the repository must not
   pin decoded frames in memory.

**Done when:** restart recovery works on both platforms; quota denial and disk
full are reported, not swallowed; an interrupted write recovers; delete/undo,
duplicate, clear-history, and export sequences all still resolve to valid assets;
saved projects remain fully independent of the repository.

### Phase 7 - Release verification and documentation

**Goal:** run the whole matrix in Verification and acceptance and close the docs.

1. Full smoke matrix: desktop and browser search/import; multi-query composition;
   replacing one texture while other properties survive; keyboard-only picker;
   missing, invalid, and revoked keys; network loss mid-batch; transparent,
   variable-delay, and large GIFs.
2. Renderer parity for every affected mode: usual GPU path versus `?renderer=2d`,
   fixed-time frame comparison, and a short export compared against the same
   source imported as a local file.
3. Offline portability: save, quit, restart with no key, no network, and no
   repository, then open and export the project.
4. README updates: privacy and network language (it currently claims only
   application-code requests occur), optional API-key setup, the new import
   behavior, and the browser/desktop persistence table. State plainly that
   queries and preview/download requests reach GIPHY while compositions are never
   uploaded, and keep retained assets distinct from unsaved composition recovery.
5. Update this document's Status line, and record any limit constants retuned
   from measurement in Phase 2's list.
6. `npm run tauri build` if capabilities, packaging, or the credential command
   surface changed and the toolchain is available.

**Done when:** the matrix passes, README is accurate, and the handoff reports
actual results including anything skipped and why.

### Likely new and modified modules

New: `src/lib/giphy.ts`, `src/lib/giphySettings.ts`, `src/lib/assetImport.ts`,
`src/lib/assetRepository.ts` plus platform adapters, `src/hooks/useGiphyPicker.ts`,
and `GiphyPickerModal.tsx`, `SettingsModal.tsx`, `RecentImportsModal.tsx` under
`src/components/modals/`, each with colocated tests.

Modified: `src/types.ts`, `src/store.ts`, `src/lib/gifUtils.ts`,
`src/lib/project.ts`, `src/components/AppShell.tsx`,
`src/components/panels/StackPanel.tsx`, `Mesh3dRow.tsx`,
`inspector/Texture3dTab.tsx`, and the asset row components. Native credential or
storage work may touch `src-tauri/src/`, `Cargo.toml`, its lockfile, and
`src-tauri/capabilities/default.json`.

Keep filesystem and credential commands narrow, do not widen the existing
`fs:scope` grant, add no shell download command, and avoid unrelated renderer or
mode-architecture refactors.

## Verification and acceptance

- Unit tests: query encoding, malformed responses, stale searches, cancellation,
  rate limits, ordered cross-query selection, duplicate handling, byte/frame
  limits, failed persistence, metadata validation, and repository deduplication.
- Store tests: each destination's add/replace behavior, stable ordering, captured
  targets, deletion/project-open races, partial failure without mutation, and
  exactly one undo/redo step per committed batch. UI/settings stay outside history.
- Persistence tests: restart and re-add retained imports; quota denial/disk full;
  interrupted writes; V1–V6 compatibility; all seven modes plus sky sources round
  trip bytes and provenance; no key or external media dependency in project files.
- Lifecycle tests: canceled imports and unused resources are released; deletion
  followed by undo, duplication, clear-history, and export still have valid assets.
- Smoke tests: search and import in desktop and browser; multiple queries into
  one composition; replace one texture while preserving other properties;
  keyboard-only picker use; missing/revoked key; network loss; short-duration
  export with transparent, variable-delay, and large representative GIFs.
- Compare each affected mode's usual GPU path (PixiJS or Three.js) with
  `?renderer=2d`; compare fixed-time frames and a short export against the same
  source imported as a local file. After saving, restart offline with no key and
  no retained repository, then open and export the project successfully.
- Before frontend handoff run `npm run typecheck`, `npm run lint`, `npm test`,
  and `npm run build`. Native changes also require `cargo fmt --manifest-path
  src-tauri/Cargo.toml --check` and `cargo check --manifest-path
  src-tauri/Cargo.toml`; capability/packaging changes require `npm run tauri build`
  when the toolchain is available. Report actual results and skipped checks.

At implementation time update README privacy/network language (currently it says
only application-code requests occur), optional API-key setup, import behavior,
and the browser/desktop persistence table. State that user queries and preview/
download requests reach GIPHY, while local compositions are not uploaded. Keep
the distinction between retained assets and unsaved composition recovery clear.
No README behavior claim changes are needed for this planning-only document.

The feature is complete only when all existing GIF import destinations have the
appropriate search action, multi-query composition is additive, local copies and
portable files work under the resolved provider conditions, and the validation
matrix passes. Full-document autosave, cloud sync, a general asset manager, other
providers, API uploads, and renderer changes remain outside this feature.
