#!/usr/bin/env bash
# Stage the GIPHY Phase 0 request spike into public/ so it is reachable from the
# dev server, a Pages-style build, and a packaged Tauri app.
#
# The harness is NOT product code. It lives in docs/ and is copied into public/
# only for the duration of a spike run. public/__giphy-spike/ is gitignored, so
# a forgotten copy cannot be committed or deployed -- but still run `unstage`
# before any real build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/docs/features/giphy-spike"
TARGET="$ROOT/public/__giphy-spike"

usage() {
  cat <<'USAGE'
Usage: scripts/giphy-spike.sh <command>

  stage      Copy the harness into public/__giphy-spike/
  unstage    Remove it again
  status     Report whether it is currently staged

Origins to cover (see docs/features/giphy-spike-note.md):

  1. localhost dev server
       scripts/giphy-spike.sh stage
       npm run dev
       open http://localhost:3000/__giphy-spike/

  2. hosted browser origin
       No staging or deploy needed. Open the deployed app, then paste the
       contents of docs/features/giphy-spike/spike.js into the devtools console
       and run:
         __giphySpike('YOUR_KEY').then(r => console.log(__giphySpikeMarkdown(r)))
       The origin is what is under test, not the page.

  3. packaged app
       A release build has no devtools, so the page must ship inside it:
         scripts/giphy-spike.sh stage
         npm run tauri build
       Launch the built app, open the spike from its URL bar if available;
       otherwise run `npm run tauri dev` and use the devtools console instead,
       and record in the note that the packaged origin was not fully covered.

  Always finish with:
       scripts/giphy-spike.sh unstage
USAGE
}

case "${1:-}" in
  stage)
    [ -d "$SOURCE" ] || { echo "missing harness source: $SOURCE" >&2; exit 1; }
    rm -rf "$TARGET"
    mkdir -p "$TARGET"
    cp "$SOURCE/index.html" "$SOURCE/spike.js" "$TARGET/"
    echo "staged -> public/__giphy-spike/"
    echo "dev URL: http://localhost:3000/__giphy-spike/"
    echo "remember: scripts/giphy-spike.sh unstage when finished"
    ;;
  unstage)
    if [ -d "$TARGET" ]; then
      rm -rf "$TARGET"
      echo "unstaged"
    else
      echo "not staged"
    fi
    ;;
  status)
    if [ -d "$TARGET" ]; then
      echo "STAGED: public/__giphy-spike/ exists -- unstage before building for release"
      exit 1
    fi
    echo "clean: harness is not staged"
    ;;
  *)
    usage
    exit 1
    ;;
esac
