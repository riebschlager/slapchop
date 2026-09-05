# GIPHY integration development plan

- Status: Proposed; implementation has not started.
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

## Delivery sequence

1. **Feasibility and request spike:** resolve the provider questions above;
   verify key setup, search, preview, and selected-rendition fetching on all three
   origins with a user-configured key. Record approved attribution/export behavior,
   any analytics obligation, and platform/section key mapping. Omit optional
   analytics for the personal MVP unless the agreement requires them.
2. **Asset foundation:** add bounded preparation, repository adapters, metadata,
   resource ownership, and save/open round-trip tests using local fixtures. Add
   credential storage; justify and lock any required native dependency.
3. **Single-texture vertical slice:** build settings and picker, integrate Polygon
   texture import, and verify persistence, undo, offline reload, and export. Then
   wire both 3D texture surfaces and Symmetry's multi-layer action.
4. **Library composition:** add selection tray and mode-owned append mutations;
   wire Flythrough, Tunnel, GIF Voronoi, terrain, and sky create/append/replace.
   Test query A plus query B in one tray and repeated imports after commit.
5. **Retention and release verification:** complete Recent Imports, storage
   management, restart recovery of assets, accessibility, resource cleanup,
   error cases, native packaging checks, and README updates.

Likely new modules: `src/lib/giphy.ts`, `giphySettings.ts`, `assetImport.ts`,
`assetRepository.ts`, platform storage adapters, and picker/settings/recent-import
components under `src/components/modals/`. Add focused colocated tests. Modify
`src/types.ts`, `src/store.ts`, `src/lib/gifUtils.ts`, `src/lib/project.ts`, the
existing import components listed above, and `AppShell.tsx` for shared modal
composition. Native credential/storage work may touch `src-tauri/src/`,
`Cargo.toml`, its lockfile, and capabilities. Keep filesystem/credential commands
narrow; do not expand the existing broad filesystem scope or add shell download
commands. Avoid unrelated renderer or mode-architecture refactors.

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
