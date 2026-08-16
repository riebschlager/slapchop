#!/bin/sh
# Fetch the static arm64 macOS ffmpeg build used as the Tauri sidecar.
# The binary is not committed (63 MB); run this once before `npm run tauri build`.
set -eu

DEST="$(dirname "$0")/../src-tauri/binaries/ffmpeg-aarch64-apple-darwin"
if [ -x "$DEST" ]; then
  echo "ffmpeg sidecar already present: $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading static ffmpeg (macOS arm64)…"
curl -sL -o "$TMP/ffmpeg.zip" "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip"
unzip -q -o "$TMP/ffmpeg.zip" -d "$TMP"
mkdir -p "$(dirname "$DEST")"
cp "$TMP/ffmpeg" "$DEST"
chmod +x "$DEST"
echo "Installed: $DEST"
"$DEST" -version | head -1
