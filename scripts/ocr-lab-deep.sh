#!/usr/bin/env bash
# Audiveris against homr (deep learning), on the lab scores: as exported (clean PDF) and as a bad scan (tilted, blurred, noisy,
# low resolution, JPEG) -- scanned old editions are what the app mostly meets. Needs AUD, homr, poppler, imagemagick, img2pdf.
set -u -o pipefail
cd "$(dirname "$0")/.."
OUT=/tmp/deep-out; mkdir -p "$OUT"
ROWS=/tmp/rows.md; : > "$ROWS"
short() { cut -c1-220; }
for src in Four-Hands-Test Test-Piece Expression-Test Long3; do
  pdf="samples/ocr-lab/$src.pdf"
  # a bad scan of the same pages
  rm -rf /tmp/sc; mkdir -p /tmp/sc
  pdftoppm -r 150 -gray -png "$pdf" /tmp/sc/s
  for p in /tmp/sc/s-*.png; do
    convert "$p" -rotate 0.7 -background white -blur 0x0.8 -attenuate 0.35 +noise Gaussian -contrast-stretch 1%x3% -quality 40 "${p%.png}.jpg"
  done
  img2pdf /tmp/sc/s-*.jpg -o "$OUT/$src-scan.pdf" 2>&1 | tail -n 1
  for variant in clean scan; do
    in="$pdf"; [ "$variant" = scan ] && in="$OUT/$src-scan.pdf"
    for engine in audiveris homr oemer; do
      res="$OUT/$src.$variant.$engine.musicxml"; t0=$(date +%s)
      if [ "$engine" = audiveris ]; then AUD="$AUD" bash scores-repo-template/convert-one.sh "$in" "$res" > "$OUT/$src.$variant.$engine.log" 2>&1
      elif [ "$engine" = homr ]; then bash scores-repo-template/convert-homr.sh "$in" "$res" > "$OUT/$src.$variant.$engine.log" 2>&1
      else bash scores-repo-template/convert-oemer.sh "$in" "$res" > "$OUT/$src.$variant.$engine.log" 2>&1; fi
      secs=$(( $(date +%s) - t0 ))
      echo "[$src $variant $engine] $(grep -E "FAILED|recognised" "$OUT/$src.$variant.$engine.log" | tail -n 2 | short | tr '\n' ' ')"
      if [ -s "$res" ]; then
        row=$(python3 scripts/ocr-compare.py "samples/ocr-lab/$src.musicxml" "$res" "$src" "$variant / $engine" 2>/dev/null | head -n 1)
        echo "$row $secs s |" >> "$ROWS"
      else
        echo "| $src | $variant / $engine | – | – | NO RESULT | | $secs s |" >> "$ROWS"
      fi
    done
  done
done
echo; echo "================ RESULT"
echo "| file | input / engine | measures (truth→result) | notes (truth→result) | recall by measure | precision | recall anywhere | time |"
echo "|---|---|---|---|---|---|---|---|"
cat "$ROWS"
echo; echo "--- model files"
find / -name "*.onnx" \( -path "*homr*" -o -path "*oemer*" \) -size +500k -printf "%s %p\n" 2>/dev/null | awk '{printf "%.1f MB  %s\n", $1/1048576, $2}'
