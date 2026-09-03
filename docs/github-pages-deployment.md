# GitHub Pages deployment plan

- **Status:** Proposed
- **Date:** 2026-09-02
- **Scope:** Publish and support Slapchop as a static, local-first browser app
- **Initial target:** `https://riebschlager.github.io/slapchop/`

## Summary

Slapchop can be published on GitHub Pages without introducing a backend. The
existing React application already treats Tauri as an optional host: browser
sessions use file inputs and downloads, browser renderers, WebCodecs or
MediaRecorder for video, and workers for GIF and ZIP encoding.

The first release should be positioned as a **short-form browser edition**. It
should retain all creative modes, project save/open, still-image export,
animated GIF export, MP4/WebM where supported, and ZIP frame sequences. Native
filesystem integration, ProRes, long incremental exports, and native
TouchDesigner signaling remain desktop capabilities unless they receive a
separate browser-safe design.

The deployment must use a Pages-specific Vite base path. The default build is
also consumed by Tauri through `src-tauri/tauri.conf.json`, so the Pages base
must not be applied to every production build.

## Goals

- Publish the current browser product from the repository's `main` branch.
- Keep image/GIF inputs, document state, project files, and exports local to the
  user's browser.
- Preserve all seven creative modes and their deterministic rendering
  semantics.
- Keep WebGPU, WebGL, and Canvas 2D behavior available.
- Preserve the existing Tauri build and native-only capabilities.
- Make browser capability differences explicit rather than silently changing
  an export's format or quality.
- Establish a repeatable deployment, smoke-test, and rollback process.

## Non-goals

- Adding accounts, cloud storage, telemetry, collaboration, or a backend.
- Uploading user projects or source media to GitHub or another service.
- Replacing the desktop application.
- Bringing ProRes or six-hour incremental video export to the browser.
- Adding PWA installation or offline caching in the first release.
- Building a secure local signaling bridge for TouchDesigner in the first
  release.
- Redesigning the application for phones or other narrow viewports.

## Current browser capability baseline

| Capability | Browser behavior today | Initial hosted-release decision |
| --- | --- | --- |
| Creative modes | All modes execute in the browser | Supported |
| Rendering | PixiJS prefers WebGPU; WebGL and Canvas 2D are fallbacks | Supported; validate all three paths |
| Individual image/GIF input | Browser file inputs and drag/drop | Supported |
| Folder libraries | `webkitdirectory` file inputs | Supported on current desktop browsers; document browser requirement |
| `.slapchop` save/open | Download and upload of a self-contained project file | Supported |
| PNG frame | Browser download | Supported |
| Animated GIF | Worker-backed, in-memory encoding | Supported within current duration limits |
| Frame sequence | ZIP assembled in memory | Supported; direct folder output and resume remain native-only |
| MP4/WebM | WebCodecs with in-memory muxing | Supported when the requested encoder configuration is available |
| Video fallback | Real-time `MediaRecorder` WebM | Supported, with accurate format messaging |
| ProRes 4444 | Bundled ffmpeg sidecar | Desktop only |
| Long video jobs | Incremental native ffmpeg output | Desktop only; browser remains capped at 10 seconds initially |
| Project recovery after refresh | Document is not automatically persisted | Require an explicit save-before-close message |
| TouchDesigner Live Output | Defaults to `ws://127.0.0.1:9980` | Do not promise for hosted HTTPS until separately validated |

## Product decisions to make before implementation

The implementation owner should confirm these choices before opening the
deployment pull request. The recommendations define the rest of this plan.

### 1. Public URL

**Recommended:** use the repository project URL,
`https://riebschlager.github.io/slapchop/`, for the first release.

A custom domain can be added later. It would use a root `/` base instead of
`/slapchop/`, so the Pages build should keep the base path easy to change in one
place.

### 2. Browser support statement

**Recommended:** support current desktop Chrome and Edge as the primary export
targets; support current Safari and Firefox on a best-effort basis with WebGL,
Canvas 2D, and MediaRecorder fallbacks.

Do not infer usable video export merely from the presence of `VideoEncoder`.
The requested codec, profile, resolution, and frame rate must pass
`VideoEncoder.isConfigSupported()`.

### 3. TouchDesigner Live Output

**Recommended for the initial release:** label Live Output as desktop/local-only
in the hosted build, or disable its trigger with an explanation.

GitHub Pages serves HTTPS, while the current TouchDesigner signaling endpoint
is an insecure local WebSocket. Browser mixed-content and local-network rules
make `ws://127.0.0.1:9980` unreliable from a public HTTPS origin. Enabling this
later should be its own scoped project, likely requiring a trusted local WSS
endpoint and a browser matrix.

### 4. Browser session recovery

**Recommended for the initial release:** do not add automatic persistence, but
make the limitation clear near project save/open and in the hosted-user
documentation. Automatic recovery would require a deliberate IndexedDB asset
lifecycle and quota design and should not be smuggled into deployment work.

## Implementation phases

### Phase 0: Establish a pre-deployment baseline

Capture the current behavior before changing build or export logic.

- [x] Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- [x] Record any pre-existing failures separately from deployment work.
- [x] Run the application locally and open each creative mode.
- [x] Load representative static images and animated GIFs.
- [x] Save and reopen one project containing assets from multiple modes.
- [x] Export a PNG, two-second GIF, two-second ZIP sequence, MP4, and WebM.
- [x] Repeat representative rendering checks with `?renderer=webgl` and
      `?renderer=2d`.
- [x] Record the tested browser and OS versions in the pull request.

**Exit criterion:** the team has a known-good browser baseline and can
distinguish deployment regressions from existing compatibility gaps.

#### Baseline record (2026-09-03)

Automated checks were run on commit `9345357` ("feat: add per-format encoder
speeds for desktop video export") with a clean `node_modules` from the
committed lockfile.

| Environment | Value |
| --- | --- |
| OS | macOS 26.6.2 (arm64) |
| Node | v24.20.0 |
| npm | 11.19.0 |
| Vite | 6.4.3 |
| Vitest | 3.2.7 |

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, no diagnostics |
| `npm run lint` | Pass, no findings |
| `npm test` | Pass, 29 files / 259 tests |
| `npm run build` | Pass in ~4s, 2545 modules |

**Pre-existing build warnings.** Both are unrelated to Pages deployment and
should not be treated as deployment regressions if they reappear:

1. `src/lib/project.ts` is dynamically imported by `src/lib/native.ts` but also
   statically imported by `src/App.tsx` and
   `src/components/panels/StackPanel.tsx`, so it stays in the main chunk.
2. The main entry chunk is 1,025 kB (292 kB gzip), above Vite's 500 kB warning
   threshold. `three.module` is a further 508 kB (127 kB gzip).

The second warning is the practical bandwidth baseline for the hosted edition:
roughly 420 kB gzip of JavaScript plus 11 kB gzip of CSS on a cold load.

**Baseline asset paths.** The current `npm run build` emits root-absolute URLs
in `dist/index.html` — `/favicon.png`, `/assets/index-*.js`, and
`/assets/index-*.css`. This is correct for Tauri and is exactly what the Pages
build must rewrite beneath `/slapchop/`, so it is the before-state for the
Phase 1 asset inspection.

**Manual browser baseline.** All seven modes — `symmetry`, `polygon`, `3d`,
`flythrough`, `tunnel`, `gif-voronoi`, and `landscape` — were exercised in
current Chrome and Firefox on macOS 26.6.2 (Apple silicon). Individual image
and GIF selection worked in both browsers. Record the exact browser build
numbers in the deployment pull request.

**Folder selection was broken in the browser, and this was a real bug rather
than a browser limitation.** All five folder inputs
(`flythrough`, `tunnel`, `gif-voronoi`, and the two `landscape` libraries) live
inside mode-gated JSX blocks, and `StackPanel` returns early while the panel is
collapsed, so the inputs mount and unmount with the active mode. The
`webkitdirectory` and `directory` attributes were applied from a mount-only
`useEffect`, which ran while `appMode` was still the default `'symmetry'` and
every folder ref was therefore `null`. The attributes were never applied, so
each "Choose folder" button opened an ordinary multi-file picker. Native builds
were unaffected because they route through `pickGifFolder`/`pickImageFolder`
instead of the DOM input.

Fixed in `src/components/panels/StackPanel.tsx` by applying both attributes at
click time through a shared `openFolderPicker` helper, which is immune to when
the input mounted. No store change was needed: every ingestion path
(`replaceFlythroughAssets`, `tunnelAssetsFromFiles`, `gifVoronoiAssetsFromFiles`,
`landscapeAssetsFromFiles`) already filters by MIME type and extension, so the
`.DS_Store` and nested entries a directory picker returns are discarded.

This closes the Phase 0 gap rather than deferring it, because the capability
table above lists folder libraries as a supported hosted feature. Folder
selection was re-verified in every mode after the fix.

**Everything else passed.** The following all behaved correctly in Chrome and
Firefox on macOS, and are the reference behavior that Phase 4 compares the
hosted deployment against:

| Manual check | Result |
| --- | --- |
| All seven creative modes | Pass |
| Individual image and GIF selection | Pass |
| Folder libraries | Failed; fixed above, then verified in all modes |
| Project save/reopen, per mode | Pass |
| PNG export | Pass |
| Animated GIF export | Pass |
| Frame-sequence ZIP export | Pass |
| MP4 export | Pass |
| WebM export | Pass |
| `?renderer=webgl` | Pass |
| `?renderer=2d` | Pass |

`typeof VideoEncoder` is `'function'` in both browsers on this machine, so both
took the WebCodecs path and the MP4 results are genuine MP4 files. The
real-time MediaRecorder fallback is therefore confirmed **unexercised** rather
than merely unobserved, and Phase 2 must force it deliberately.

### Phase 1: Add a Pages-specific build and deployment

Create a GitHub Actions workflow under `.github/workflows/` using the official
Pages actions.

The workflow should:

1. trigger on pushes to `main` and manual dispatch;
2. check out the repository;
3. install the selected Node LTS version with npm caching;
4. run `npm ci`;
5. run the required quality checks;
6. build with the Pages base `/slapchop/`;
7. upload only `dist/` as the Pages artifact;
8. deploy to the `github-pages` environment;
9. grant only `contents: read`, `pages: write`, and `id-token: write`;
10. serialize deployments with a concurrency group.

Keep the normal build unchanged for Tauri. Prefer one of these approaches, in
order:

1. pass `--base=/slapchop/` only in the Pages workflow;
2. add a clearly named Pages build script that passes the same flag;
3. use an explicit deployment environment variable in `vite.config.ts`.

Do not hard-code `/slapchop/` as the unconditional Vite base. Tauri's
`beforeBuildCommand` runs `npm run build` and loads `../dist`; its packaged asset
paths must remain valid.

After the Pages build, inspect `dist/index.html` and confirm that:

- [ ] JavaScript and stylesheet URLs begin with `/slapchop/`.
- [ ] The favicon resolves beneath `/slapchop/`.
- [ ] Worker and dynamic-import chunks resolve beneath `/slapchop/assets/`.
- [ ] No required runtime asset points to the domain root by mistake.
- [ ] The generated site contains no downloaded ffmpeg binary or Tauri bundle.

In repository settings, select **GitHub Actions** as the Pages source and
enforce HTTPS.

**Exit criterion:** a push to `main` produces a successful Pages deployment and
the application loads at the target URL without asset 404s.

### Phase 2: Harden browser capability handling

Deployment can technically ship without this phase, but these items should be
completed before advertising broad browser compatibility.

#### Video export

- [ ] Treat an unsupported WebCodecs encoder configuration the same way as a
      missing `VideoEncoder`: offer or automatically use the MediaRecorder
      WebM path.
- [ ] Preserve the specific WebCodecs error when MediaRecorder is also
      unavailable.
- [ ] If a requested MP4 becomes WebM, update the UI before export and use the
      correct extension and MIME type. Never present a WebM result as MP4.
- [ ] Show the active path: frame-exact WebCodecs or real-time MediaRecorder.
- [ ] Keep the 10-second browser limit unless profiling supports a different
      safe limit.
- [ ] Test H.264 and VP9 configuration support at all three resolutions and at
      15, 30, and 60 fps on primary browsers.
- [ ] Add or update tests around capability selection and fallback behavior.

Both browser video paths can be forced from the console without browser flags,
because `supportsWebCodecs()` is evaluated at export time rather than at module
load:

| Path to exercise | How to force it |
| --- | --- |
| Real-time MediaRecorder WebM | `delete window.VideoEncoder`, then export |
| Unsupported encoder configuration | `VideoEncoder.isConfigSupported = async () => ({ supported: false })` |

Reload to restore either. The second case is the actual Phase 2 gap: the
fallback is gated only on `typeof VideoEncoder !== 'undefined'` in
`src/hooks/useExport.ts`, so a null result from `pickEncoderConfig` throws from
`src/lib/videoExport.ts` instead of degrading to MediaRecorder. Note also that
`recordVideoFallback` names its output `.webm` whatever format was requested,
which is why the truthful-messaging items above matter.

#### Memory and failure behavior

- [ ] Confirm cancellation releases video frames, encoders, workers, object
      URLs, and temporary canvases.
- [ ] Verify out-of-memory or encoder failures surface a useful, format-specific
      message.
- [ ] Document that GIF, ZIP, WebCodecs video, and self-contained project files
      are assembled in browser memory.
- [ ] Test at least one realistically large GIF library and establish a
      practical support recommendation without promising a universal file-count
      limit.

**Exit criterion:** users receive either the format they selected or a clear,
explicit fallback/error; no tested failure silently changes formats.

### Phase 3: Make the hosted product boundary explicit

Add hosted-user documentation and small contextual messages where a native-only
feature would otherwise be confusing.

- [ ] Add the hosted URL to `README.md`.
- [ ] Add a compact browser-versus-desktop capability table.
- [ ] State that source assets and projects are processed locally and are not
      uploaded by the application.
- [ ] Warn that refreshing or closing an unsaved browser session loses the
      current document.
- [ ] Explain the 10-second browser animation limit and in-memory exports.
- [ ] Identify ProRes, direct/resumable frame folders, long jobs, native file
      dialogs, file association, and window restore as desktop-only.
- [ ] Mark TouchDesigner Live Output as unsupported from the hosted edition
      until Phase 5 is completed.
- [ ] Include a link to desktop setup rather than presenting the editions as
      feature-equivalent.

**Exit criterion:** a first-time visitor can tell what stays local, what works
in their browser, and when to use the desktop app.

### Phase 4: Hosted smoke test and release

Test the deployed URL, not only `vite preview`. GitHub Pages' subpath and HTTPS
environment are part of the product.

#### Loading and navigation

- [ ] Open the exact Pages URL in a clean browser profile.
- [ ] Confirm a hard refresh at `/slapchop/` succeeds.
- [ ] Confirm `?renderer=webgl` and `?renderer=2d` retain the subpath and work.
- [ ] Confirm there are no failed asset, worker, or dynamic-import requests.
- [ ] Confirm no Tauri initialization error appears in a browser session.

#### Editing and project I/O

- [ ] Exercise every creative mode.
- [ ] Upload individual images and GIFs.
- [ ] Choose folder libraries for Flythrough, Tunnel, GIF Voronoi, and
      Landscape.
- [ ] Drag individual files onto the stage.
- [ ] Save a `.slapchop` project and reopen it from disk.
- [ ] Compare a representative project before and after round-trip.

#### Rendering and exports

- [ ] Compare default GPU output with forced WebGL and Canvas 2D for
      representative static and animated scenes.
- [ ] Export a full-resolution PNG.
- [ ] Export a short animated GIF.
- [ ] Export PNG and JPEG frame ZIPs.
- [ ] Export MP4 and WebM through WebCodecs where supported.
- [ ] Exercise the MediaRecorder fallback and verify that it downloads WebM.
- [ ] Cancel one export of each browser animation class and watch for continued
      CPU/GPU work or leaked downloads.

#### Browser matrix

| Browser | Rendering | Folder input | Project round-trip | PNG/GIF/ZIP | MP4/WebM | Expected disposition |
| --- | --- | --- | --- | --- | --- | --- |
| Current Chrome | Required | Required | Required | Required | Required where codec supported | Primary |
| Current Edge | Required | Required | Required | Required | Required where codec supported | Primary |
| Current Safari | Required | Verify | Required | Required | Verify/fallback | Best effort |
| Current Firefox | Required | Verify | Required | Required | Verify/fallback | Best effort |

#### Desktop regression

- [ ] Re-run `npm run typecheck`, `npm run lint`, `npm test`, and
      `npm run build`.
- [ ] Run `npm run tauri dev` when the native toolchain is available.
- [ ] Verify native project dialogs and a short native video export.
- [ ] Run `npm run tauri build` if packaging or Tauri configuration changed.

**Exit criterion:** the deployed build passes all required checks in Chrome and
Edge, documented best-effort behavior is accurate elsewhere, and the desktop
build remains intact.

### Phase 5: Evaluate hosted TouchDesigner Live Output separately

This phase is intentionally not a launch blocker.

- [ ] Test whether each supported browser permits the Pages origin to connect
      to the existing loopback WebSocket endpoint.
- [ ] Record mixed-content, local-network permission, origin, and certificate
      failures separately.
- [ ] Determine whether TouchDesigner's signaling server can expose WSS with a
      locally trusted certificate.
- [ ] Threat-model a public page connecting to a service on the user's local
      machine; validate the WebSocket `Origin` header and reject unexpected
      origins.
- [ ] If a bridge is required, specify its installation, lifecycle, port,
      certificate, and upgrade behavior before implementation.
- [ ] Test discovery, negotiation, disconnect, cleanup, resolution, and bitrate
      reporting across the browser matrix.
- [ ] Only enable and document hosted Live Output after it passes these checks.

**Exit criterion:** Live Output is either deliberately supported through a
secure, documented local boundary or remains explicitly desktop/local-only.

## Expected file impact

The implementation should stay focused. Expected files include:

- `.github/workflows/deploy-pages.yml` — build and deployment pipeline;
- `package.json` — only if a named Pages build or validation script is useful;
- `vite.config.ts` — only if the base cannot remain a workflow-only concern;
- `src/lib/videoExport.ts` and `src/hooks/useExport.ts` — capability fallback
  hardening;
- `src/components/modals/ExportModal.tsx` — truthful browser export messaging;
- the Live Output trigger/modal — hosted-environment explanation, if needed;
- `README.md` — hosted URL, privacy statement, capability boundary;
- colocated tests for any pure capability-selection behavior.

Do not commit `dist/`. GitHub Actions should produce it as a deployment
artifact.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pages subpath produces broken root URLs | App shell or chunks fail to load | Pages-only `/slapchop/` base plus generated HTML/network inspection |
| Pages base leaks into the Tauri build | Packaged desktop assets fail | Keep `npm run build` root-based; run native regression checks |
| WebCodecs exists but requested codec is unsupported | Video export fails unexpectedly | Select configurations with `isConfigSupported`; fall back explicitly |
| MediaRecorder changes MP4 request into WebM | Misleading output | Tell the user before export and use WebM naming/MIME |
| Large projects exceed browser memory | Crash or lost work | Retain short limits, document memory behavior, test representative libraries |
| Refresh loses the current document | User work loss | Prominent save guidance; evaluate IndexedDB recovery separately |
| HTTPS page cannot reach local `ws://` signaling | Live Output fails | Keep hosted Live Output unsupported until secure-local design is validated |
| Browser rendering differs from desktop | Visual/export mismatch | Test WebGPU, WebGL, and Canvas 2D with representative scenes |
| Public deployment exposes unexpected data | Privacy/security issue | Ship no user assets; inspect artifact and browser network traffic |
| GitHub Pages quotas become constraining | Availability problems | Monitor usage; move to another static host/CDN if adoption requires it |

## Security and privacy review

- Treat the deployed bundle and repository as public, even if repository
  visibility changes later.
- Confirm the artifact contains no `.env` files, credentials, local paths,
  downloaded sidecars, sample user media, or saved projects.
- Confirm user-selected media is represented by local `File`, data, or object
  URLs and is not sent over the network.
- Keep Tauri APIs behind `isNative()` and lazy imports.
- Do not add analytics or error reporting without an explicit product and
  privacy decision.
- If hosted Live Output is revisited, consider cross-site WebSocket and local
  service attacks, not only mixed-content compatibility.

## Operations and rollback

- A failed validation step must prevent deployment.
- Keep Pages deployments serialized so an older workflow cannot overwrite a
  newer release.
- Use `workflow_dispatch` for controlled redeployment.
- Roll back by reverting the responsible commit and redeploying `main`; do not
  hand-edit generated Pages output.
- After every deployment, perform a compact production smoke test: load, one
  asset import, one project round-trip, one PNG export, and one short video or
  GIF export.
- Review GitHub Pages bandwidth and site-size usage if the public edition gains
  sustained traffic. User media does not count as hosted content because it is
  never uploaded, but the application bundle still consumes delivery bandwidth.

## Definition of done

The GitHub Pages edition is ready when all of the following are true:

- [ ] The application deploys automatically from `main` and can also be
      deployed manually.
- [ ] `https://riebschlager.github.io/slapchop/` loads without console-breaking
      errors or failed runtime assets.
- [ ] All creative modes accept representative inputs and render successfully.
- [ ] `.slapchop` files save, download, reopen, and preserve embedded assets.
- [ ] PNG, GIF, and ZIP exports work in primary browsers.
- [ ] MP4/WebM support is capability-tested and fallback behavior is truthful.
- [ ] Native-only controls are hidden, disabled, or explained appropriately.
- [ ] The hosted product clearly warns about unsaved refreshes and in-memory
      export limits.
- [ ] No user content leaves the browser during normal editing, saving, or
      exporting.
- [ ] The full frontend validation suite passes.
- [ ] A Tauri smoke test confirms that the default build and native exports were
      not regressed.
- [ ] README documentation links to both the hosted edition and desktop setup.

## Follow-up opportunities

These are deliberately outside the first release:

- IndexedDB-backed crash/refresh recovery with an explicit storage quota UI;
- an installable PWA and offline asset caching;
- streaming browser exports through the File System Access API where available;
- longer browser exports based on measured memory and encoder behavior;
- a secure local WSS companion for hosted TouchDesigner Live Output;
- responsive or tablet-specific application chrome;
- a custom domain and corresponding root-base deployment.

## References

- [Vite: Deploying a Static Site to GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub: Securing a Pages site with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [MDN: WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [MDN: `VideoEncoder.isConfigSupported()`](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static)
- [MDN: `MediaRecorder`](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [MDN: `HTMLCanvasElement.captureStream()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [MDN: `webkitdirectory`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory)
- [MDN: Writing WebSocket client applications](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)
