#!/usr/bin/env bash
# How big are the piano sounds? (to decide which ones can be packed into the apps) Prints the size of every candidate, in MB.
set -u
head_size() { curl -sIL --retry 2 "$1" | tr -d '\r' | awk 'tolower($1)=="content-length:"{s=$2} END{print s+0}'; }
echo "== General MIDI soundfonts (one file per instrument, mp3)"
for kit in FluidR3_GM MusyngKite; do for ins in acoustic_grand_piano bright_acoustic_piano electric_piano_1 electric_grand_piano; do
  s=$(head_size "https://gleitz.github.io/midi-js-soundfonts/$kit/$ins-mp3.js"); awk -v s="$s" -v n="$kit/$ins" 'BEGIN{printf "%8.1f MB  %s\n", s/1048576, n}'; done; done
echo "== Splendid Grand Piano (many small sample files; ogg and m4a)"
names=$(node -e '
const s=require("fs").readFileSync("node_modules/smplr/dist/index.mjs","utf8"); const a=s.indexOf("var LAYERS = [");
const seg=s.slice(a, s.indexOf("\n];", a)); const set=new Set([...seg.matchAll(/\[\d+, "([^"]+)"\]/g)].map(m=>m[1])); console.log([...set].join("\n"))')
for fmt in ogg m4a; do
  total=0; n=0
  while IFS= read -r name; do
    enc=$(printf '%s' "$name" | sed 's/ /%20/g; s/#/%23/g')
    s=$(head_size "https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples/$enc.$fmt"); total=$((total + s)); n=$((n + 1))
  done <<< "$names"
  awk -v t="$total" -v n="$n" -v f="$fmt" 'BEGIN{printf "%8.1f MB  Splendid %s (%d files)\n", t/1048576, f, n}'
done
