#!/usr/bin/env bash
# Real PDFs (samples/ocr-real/*.pdf: scanned editions, no reference score) through Audiveris, homr and oemer; each result is checked by scripts/ocr-validate.py
# (structure only: do the bars add up, are all staves declared, ...). Prints a table; the MusicXML files are kept as artifacts so they can be looked at.
# Needs AUD (path of the Audiveris binary), homr, oemer, poppler, python3.
set -u -o pipefail
cd "$(dirname "$0")/.."
OUT=/tmp/real-out; mkdir -p "$OUT"; ROWS=/tmp/real-rows.md; : > "$ROWS"
for pdf in samples/ocr-real/*.pdf; do
  [ -e "$pdf" ] || { echo "no PDFs in samples/ocr-real"; exit 0; }
  src=$(basename "$pdf" .pdf); pages=$(pdfinfo "$pdf" 2>/dev/null | awk '/^Pages:/{print $2}')
  for engine in audiveris homr oemer; do
    res="$OUT/$src.$engine.musicxml"; log="$OUT/$src.$engine.log"; t0=$(date +%s)
    case "$engine" in
      audiveris) AUD="${AUD:-}" bash scores-repo-template/convert-one.sh "$pdf" "$res" > "$log" 2>&1 ;;
      homr) bash scores-repo-template/convert-homr.sh "$pdf" "$res" > "$log" 2>&1 ;;
      oemer) bash scores-repo-template/convert-oemer.sh "$pdf" "$res" > "$log" 2>&1 ;;
    esac
    secs=$(( $(date +%s) - t0 ))
    if [ -s "$res" ]; then
      row=$(python3 scripts/ocr-validate.py "$res" 2>&1 | head -n 1)
      echo "| $src ($pages p.) | $engine | $row | $secs s |" >> "$ROWS"
      echo "  -- structure of $src / $engine:"; python3 scripts/xml-structure.py "$res" 2>&1 | cut -c1-300
    else
      echo "| $src ($pages p.) | $engine | NO RESULT | | | | | | $secs s |" >> "$ROWS"; tail -n 3 "$log" | cut -c1-200
    fi
  done
done
{
  echo "### Real PDFs: structure check (no reference score; higher % = more bars add up)"
  echo "| file | engine | measures | notes | bars add up | bad bars | empty bars | time signatures | flags | time |"
  echo "|---|---|---|---|---|---|---|---|---|---|"
  cat "$ROWS"
} | tee "$OUT/report.md"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || cat "$OUT/report.md" >> "$GITHUB_STEP_SUMMARY"
