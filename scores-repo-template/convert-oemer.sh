#!/usr/bin/env bash
# Converts ONE PDF / photo to MusicXML with oemer (deep learning, MIT licence: the one that may be built into the apps).
# Usage: convert-oemer.sh <input> <output.musicxml>      Needs: oemer, poppler-utils (pdftoppm), python3.
# Every page on its own, then the pages are joined in order. Exit code 0 = an output file was written.
set -u -o pipefail
IN="$1"; OUT="$2"
here="$(cd "$(dirname "$0")" && pwd)"
base=$(basename "$IN"); stem="${base%.*}"; ext="${base##*.}"
rm -rf /tmp/oemer; mkdir -p /tmp/oemer/pages /tmp/oemer/res
case "$(echo "$ext" | tr A-Z a-z)" in
  pdf) pdftoppm -r 300 -png "$IN" /tmp/oemer/pages/p ;;
  *)   cp "$IN" "/tmp/oemer/pages/p-1.$ext" ;;
esac
n=0; ok=0
shopt -s nullglob
for page in /tmp/oemer/pages/p-*; do
  n=$((n+1)); name=$(printf 'p-%03d' "$n"); img="/tmp/oemer/pages/$name.${page##*.}"; cp "$page" "$img"
  t0=$(date +%s)
  if timeout 1500 oemer "$img" -o /tmp/oemer/res > "/tmp/oemer/log-$n.txt" 2>&1 && [ -s "/tmp/oemer/res/$name.musicxml" ]; then
    ok=$((ok+1)); echo "oemer: page $n recognised in $(( $(date +%s) - t0 )) s"
  else
    echo "oemer: page $n FAILED: $(tail -n 3 "/tmp/oemer/log-$n.txt" | tr '\n' ' ' | cut -c1-300)"
  fi
done
echo "oemer: $ok of $n page(s) recognised"
[ "$ok" -ge 1 ] || { echo "no page could be read from the file"; exit 1; }
python3 "$here/merge-pages.py" /tmp/oemer/res "$OUT" "$stem"
[ -s "$OUT" ]
