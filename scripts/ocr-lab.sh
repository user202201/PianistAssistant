#!/usr/bin/env bash
# OCR lab: converts the PDFs in samples/ocr-lab/ (made from known MusicXML scores) with different settings and scores the results
# against the known scores. Run by .github/workflows/ocr-lab.yml; needs AUD (path of Audiveris), poppler-utils, libtiff-tools.
set -u -o pipefail
cd "$(dirname "$0")/.."
: "${AUD:?AUD must point to Audiveris}"
OUT=/tmp/lab-out; mkdir -p "$OUT"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
echo "| file | variant | measures (truth→result) | notes (truth→result) | recall by measure | precision | recall anywhere |" >> "$SUMMARY"
echo "|---|---|---|---|---|---|---|" >> "$SUMMARY"

score() { # $1 stem  $2 variant  $3 result.musicxml
  local truth="samples/ocr-lab/$1.musicxml"
  if [ ! -s "$3" ]; then echo "| $1 | $2 | – | – | NO RESULT | | |" | tee -a "$SUMMARY"; return; fi
  python3 scripts/ocr-compare.py "$truth" "$3" "$1" "$2" | tee -a "$SUMMARY"
  # titles / tempo / text found?
  echo "    text in result: credits=[$(grep -o '<credit-words[^>]*>[^<]*' "$3" | sed 's/<[^>]*>//' | tr '\n' '|')] words=$(grep -c '<words' "$3") tempo=$(grep -c '<sound tempo\|<metronome' "$3")"
  echo "    text in truth:  title=$(grep -o '<work-title>[^<]*' "$truth" | sed 's/<[^>]*>//') words=$(grep -c '<words' "$truth") tempo=$(grep -c '<sound tempo\|<metronome' "$truth")"
}

# language data for the text recognition: the one from Ubuntu ("distro") and the full English model from the Tesseract project
mkdir -p /tmp/tess-full && curl -fsSL -o /tmp/tess-full/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata && echo "full eng model: $(wc -c < /tmp/tess-full/eng.traineddata) bytes"
DISTRO_TESS="${TESSDATA_PREFIX:-}"

for pdf in samples/ocr-lab/*.pdf; do
  stem=$(basename "$pdf" .pdf)
  echo "=================== $stem ($(pdfinfo "$pdf" | grep Pages))"
  # 1. as the app does it today
  AUD="$AUD" bash scores-repo-template/convert-one.sh "$pdf" "$OUT/$stem.default.musicxml" 2>&1 | sed "s/^/[default] /"
  cp /tmp/omr/log.txt "$OUT/$stem.default.log" 2>/dev/null || true
  score "$stem" "default (PDF as is)" "$OUT/$stem.default.musicxml"
  # 2. every page drawn at 400 dpi first, as one multi-page TIFF
  rm -rf /tmp/pages; mkdir -p /tmp/pages
  pdftoppm -r 400 -gray -tiff "$pdf" /tmp/pages/p
  tiffcp /tmp/pages/p-*.tif "$OUT/$stem.400.tif"
  AUD="$AUD" bash scores-repo-template/convert-one.sh "$OUT/$stem.400.tif" "$OUT/$stem.tiff400.musicxml" 2>&1 | sed "s/^/[tiff400] /"
  cp /tmp/omr/log.txt "$OUT/$stem.tiff400.log" 2>/dev/null || true
  score "$stem" "400 dpi TIFF" "$OUT/$stem.tiff400.musicxml"
  # 3. the PDF as is, with the full English text model
  TESSDATA_PREFIX=/tmp/tess-full AUD="$AUD" bash scores-repo-template/convert-one.sh "$pdf" "$OUT/$stem.tessfull.musicxml" 2>&1 | sed "s/^/[tessfull] /"
  cp /tmp/omr/log.txt "$OUT/$stem.tessfull.log" 2>/dev/null || true
  score "$stem" "PDF + full text model" "$OUT/$stem.tessfull.musicxml"
done
cat "$SUMMARY" 2>/dev/null | tail -30
