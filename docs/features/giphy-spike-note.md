# GIPHY Phase 0 spike note

- Status: **Open — awaiting human-led provider resolution and spike runs.**
- Opened: 2026-09-05.
- Owner: (unassigned — human-led; see below.)
- Governs: [GIPHY integration development plan](./giphy-integration.md), Phase 0.

This note is the working record for Phase 0. It has two halves: **provider
questions**, which only a person can answer, and **request results**, which the
harness produces. Phase 6 stays blocked until the retention question below is
answered. Phases 1–5 are unblocked by the request results alone.

An agent may prepare this note and the harness. An agent must not contact GIPHY,
register a key, or accept terms on the user's behalf. Every answer below is
transcribed by a person from a source they name.

---

## Part 1 — Provider questions (human-led)

Answer each with the wording of the source relied on, plus a link and a date.
"Probably fine" is not an answer; leave it Open instead. `Open` questions that
touch retention keep Phase 6 blocked.

### 1.1 Retention of local copies

> May validated GIF bytes be written to app-owned local storage (desktop
> application-data directory, browser IndexedDB) and kept until the user removes
> them?

- Status: **Open**
- Answer:
- Source and date:
- Conditions (revalidation interval, TTL, deletion triggers):

### 1.2 Permanence of project embedding

> May those bytes be embedded permanently in a portable `.slapchop` file that
> the user can move between machines and open years later?

- Status: **Open**
- Answer:
- Source and date:
- Conditions:

Note that an approval for *delivery caching* would not by itself cover permanent
embedding. If the answer distinguishes the two, record both.

### 1.3 Offline export

> May a composition containing imported GIF frames be rendered and exported with
> no network connection and no key present?

- Status: **Open**
- Answer:
- Source and date:
- Conditions:

### 1.4 Recent Imports vs. the database/directory restriction

> Does a user-facing list of that user's own imports, with re-add and delete,
> count as building or supplementing a GIF database/directory?

- Status: **Open**
- Answer:
- Source and date:
- Conditions:

### 1.5 Attribution

> What attribution is required, and where: the picker grid, the imported asset's
> place in the document, the Recent Imports list, and exported media?

- Status: **Open**
- Required in picker:
- Required on retained assets:
- Required in exported media:
- Powered By GIPHY asset and placement rules:
- Source and date:

Exported media is the sharp edge. Slapchop exports GIF, MP4/WebM, ProRes, PNG,
and ZIP frame sequences; if attribution must appear in exported output, that is a
renderer-visible requirement and needs to be raised before Phase 4, not at
Phase 7.

### 1.6 Platform and section key mapping

> Does one shared cross-mode picker count as a single integration section? Is the
> Tauri desktop build classified separately from the browser edition?

- Status: **Open**
- Answer:
- Source and date:
- Keys required (how many, per what):

If more than one key is required, Phase 3's `giphySettings.ts` needs a
context-key map rather than a single field. Record that here so Phase 3 is not
started against the wrong shape.

### 1.7 Rate limits and production classification

> Confirmed beta limit, production limit, and whether personal use changes it.

- Status: **Open**
- Documented beta limit:
- Observed limit (from Part 2):
- Answer:
- Source and date:

---

## Part 2 — Request spike (three origins)

### How to run

```sh
scripts/giphy-spike.sh stage     # copies the harness into public/
npm run dev                      # then open http://localhost:3000/__giphy-spike/
scripts/giphy-spike.sh unstage   # always finish here
```

`scripts/giphy-spike.sh` with no argument prints the per-origin procedure,
including the console-paste route for the hosted origin (which needs no deploy —
the origin is what is under test, not the page).

The harness never stores the key and redacts it from every surface. Each run
spends one API call; the optional burst spends one per attempt.

### What counts as a pass

| Check | Passing result |
| --- | --- |
| Search API | HTTP 200 with a parsed result array |
| Preview `<img>` | Loads at expected dimensions |
| `images.original.url` fetch | HTTP 200, GIF87a/GIF89a signature, plausible byte length |
| CORS on media host | The original-rendition fetch succeeds cross-origin, from script, without a proxy |

The third row is the one that decides the feature. A plain `<img>` needs no CORS
grant, so a working preview grid is not evidence the importer will work. If the
original-rendition fetch is blocked on any origin, record it plainly here and
raise it before Phase 2 — the plan forbids a backend proxy workaround, and a
native HTTP fallback is a separate decision.

### 2.1 `localhost:3000` (Vite dev server)

- Run: **not yet run**

_(Paste the harness markdown block here.)_

### 2.2 Hosted browser origin

- Origin under test:
- Run: **not yet run**

_(Paste the harness markdown block here.)_

### 2.3 Packaged desktop app (`npm run tauri build`)

- Run: **not yet run**
- Origin reported by the webview:
- Devtools available in the packaged build? (If not, note whether the packaged
  origin was covered by the in-app harness or only approximated with
  `npm run tauri dev`.)

_(Paste the harness markdown block here.)_

`src-tauri/tauri.conf.json` currently sets `security.csp` to `null`, so no policy
blocks `api.giphy.com` today. That is the state at the time of the spike, not a
guarantee; if a CSP is introduced later, GIPHY's API and media hosts must be
added deliberately.

### 2.4 Full response headers

Script can only read CORS-safelisted headers plus those the server exposes.
Record the full set from curl (which is not subject to CORS) or the devtools
Network tab.

| Origin | `access-control-allow-origin` | `access-control-expose-headers` | Rate-limit headers seen |
| --- | --- | --- | --- |
| localhost | | | |
| hosted | | | |
| packaged | | | |

### 2.5 Rate limiting and `Retry-After`

- Observed limit before 429:
- Was `Retry-After` sent on the 429? **Unobserved**
- Rate-limit header names actually returned:
- Are media requests counted against the API quota?

If `Retry-After` is never sent, Phase 3 must offer manual retry without
inventing a reset time — do not synthesize a countdown from an unobserved value.

---

## Part 3 — Decision

Fill this in once Parts 1 and 2 are complete, then copy the outcome into the
Provider feasibility section of the plan and update its Status line.

- Decision date:
- Decision: **Pending**
- Conditions carried into implementation:
- Phase 6 (durable storage): **Blocked** — unblocked only by an explicit yes to
  1.1, 1.2, and 1.3 together.
- Phases 1–5: unblocked once Part 2 passes on all three origins.
- Requirements to revisit with the user, if any:

If retention is refused, stop before Phase 6 and revisit the product requirement.
A remote-URL-only picker is a scope change and does not fulfill the plan. Phases
1–5 still ship a working session-scoped importer whose output is preserved by an
ordinary project save.
