#!/usr/bin/env bash
# Packs the default piano sound into the app (so the first start works without a connection).
# Usage: fetch-sounds.sh <folder of the built web app, e.g. dist-app>
set -euo pipefail
DIR="${1:?folder of the built app}/sounds"
mkdir -p "$DIR"
URL="https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3.js"
for i in 1 2 3 4; do
  curl -fL --retry 3 -o "$DIR/acoustic_grand_piano-mp3.js" "$URL" && break
  echo "download failed (try $i), waiting"; sleep $((i * 5))
done
SIZE=$(wc -c < "$DIR/acoustic_grand_piano-mp3.js")
echo "piano sound: $SIZE bytes"
[ "$SIZE" -gt 500000 ] || { echo "the piano sound file looks wrong (too small)"; exit 1; }
