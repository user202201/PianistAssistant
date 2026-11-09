#!/usr/bin/env bash
# Converts ONE PDF / photo to MusicXML with homr (deep-learning engine). Needs: homr, poppler-utils (pdftoppm), python3.
# Usage: convert-homr.sh <input> <output.musicxml>
# Every page is recognised on its own, then the pages are joined in order. Exit code 0 = an output file was written.
set -u -o pipefail
IN="$1"; OUT="$2"
here="$(cd "$(dirname "$0")" && pwd)"
base=$(basename "$IN"); stem="${base%.*}"; ext="${base##*.}"
rm -rf /tmp/homr; mkdir -p /tmp/homr/pages /tmp/homr/res
case "$(echo "$ext" | tr A-Z a-z)" in
  pdf) pdftoppm -r 300 -png "$IN" /tmp/homr/pages/p ;;
  *)   cp "$IN" "/tmp/homr/pages/p-1.$ext" ;;
esac
n=0; ok=0
shopt -s nullglob
for page in /tmp/homr/pages/p-*; do
  n=$((n+1))
  name=$(printf 'p-%03d' "$n")
  cp "$page" "/tmp/homr/res/$name.${page##*.}"
  t0=$(date +%s)
  if timeout 1500 homr "/tmp/homr/res/$name.${page##*.}" > "/tmp/homr/log-$n.txt" 2>&1 && [ -s "/tmp/homr/res/$name.musicxml" ]; then
    ok=$((ok+1)); echo "homr: page $n recognised in $(( $(date +%s) - t0 )) s"
  else
    echo "homr: page $n FAILED"; tail -n 4 "/tmp/homr/log-$n.txt" | cut -c1-300
  fi
done
echo "homr: $ok of $n page(s) recognised"
[ "$ok" -ge 1 ] || { echo "no page could be read from the file"; exit 1; }
python3 "$here/merge-pages.py" /tmp/homr/res "$OUT" "$stem"
[ -s "$OUT" ]
