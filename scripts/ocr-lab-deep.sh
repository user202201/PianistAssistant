#!/usr/bin/env bash
# Deep-learning OMR engines (oemer, homr) on the lab scores, compared with the known scores: could one of them live inside the app?
# Prints accuracy, run time per page and model sizes. Run by .github/workflows/ocr-lab-deep.yml.
set -u -o pipefail
cd "$(dirname "$0")/.."
OUT=/tmp/deep-out; mkdir -p "$OUT"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
echo "| file | engine | measures (truth→result) | notes (truth→result) | recall by measure | precision | seconds/page |" | tee -a "$SUMMARY"
echo "|---|---|---|---|---|---|---|" | tee -a "$SUMMARY"
for pdf in samples/ocr-lab/Four-Hands-Test.pdf samples/ocr-lab/Test-Piece.pdf samples/ocr-lab/Expression-Test.pdf samples/ocr-lab/Long3.pdf; do
  stem=$(basename "$pdf" .pdf)
  rm -rf /tmp/pg; mkdir -p /tmp/pg
  pdftoppm -r 300 -png "$pdf" /tmp/pg/p
  pages=$(ls /tmp/pg/p-*.png | wc -l)
  for engine in oemer homr; do
    res=/tmp/res-$engine; rm -rf "$res"; mkdir -p "$res"
    t0=$(date +%s)
    for png in /tmp/pg/p-*.png; do
      b=$(basename "$png" .png)
      if [ "$engine" = oemer ]; then
        timeout 900 oemer "$png" -o "$res" > "$OUT/$stem.$engine.$b.log" 2>&1 || echo "[$engine] failed on $b (see below)"
      else
        cp "$png" "$res/$b.png"
        timeout 900 homr "$res/$b.png" > "$OUT/$stem.$engine.$b.log" 2>&1 || echo "[$engine] failed on $b (see below)"
      fi
      tail -n 3 "$OUT/$stem.$engine.$b.log" | sed "s/^/[$engine $b] /"
    done
    secs=$(( ( $(date +%s) - t0 ) / pages ))
    if ls "$res"/*.musicxml >/dev/null 2>&1; then
      python3 scripts/merge-musicxml-pages.py "$res" "$OUT/$stem.$engine.musicxml" 2>&1 | tail -n 2
      python3 scripts/ocr-compare.py "samples/ocr-lab/$stem.musicxml" "$OUT/$stem.$engine.musicxml" "$stem" "$engine" 2>&1 | sed "s/\$/ $secs |/" | tee -a "$SUMMARY"
    else
      echo "| $stem | $engine | – | – | NO RESULT | | $secs |" | tee -a "$SUMMARY"
    fi
  done
done
echo "--- model files (size matters for packing them into an app)"
find / \( -name "*.onnx" -o -name "*.tflite" -o -name "*.pth" -o -name "*.h5" -o -name "*.pt" \) -size +500k -not -path "/proc/*" -printf "%s %p\n" 2>/dev/null | sort -rn | head -20 | awk '{printf "%.1f MB  %s\n", $1/1048576, $2}'
