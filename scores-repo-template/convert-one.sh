#!/usr/bin/env bash
# Converts ONE PDF / photo to MusicXML with Audiveris.
# Usage: AUD=/path/to/Audiveris convert-one.sh <input> <output.musicxml>
# Exit code 0 = an output file was written. Details of what Audiveris did are printed (and kept in /tmp/omr/log.txt).
# Used by convert.sh (the real pipeline) and by the OCR lab workflow (measuring the quality against known scores).
set -u -o pipefail
IN="$1"; OUT="$2"
: "${AUD:?AUD must point to the Audiveris executable}"
base=$(basename "$IN"); ext="${base##*.}"
rm -rf /tmp/omr; mkdir -p /tmp/omr/in /tmp/omr/out
cp "$IN" "/tmp/omr/in/score.$ext"   # ASCII name: safest for the OMR engine
rc=0
# OMR_OPTS: extra "-option key=value" pairs for experiments
# shellcheck disable=SC2086
timeout 1500 "$AUD" -batch -transcribe -export ${OMR_OPTS:-} -output /tmp/omr/out -- "/tmp/omr/in/score.$ext" > /tmp/omr/log.txt 2>&1 || rc=$?
echo "audiveris exit code: $rc"
# Audiveris may split a multi-page / multi-section score into several "movement" files (score.mvt1.mxl, score.mvt2.mxl ...):
# take ALL of them and join them in order (taking only the first one loses everything after the first section)
rm -rf /tmp/omr/x; mkdir -p /tmp/omr/x
n=0
while IFS= read -r m; do
  n=$((n+1))
  case "$m" in
    *.mxl) inner=$(unzip -Z1 "$m" | grep -v '^META-INF' | grep -iE '\.(xml|musicxml)$' | head -1)
           unzip -p "$m" "$inner" > "/tmp/omr/x/$(printf %03d $n).xml" ;;
    *) cp "$m" "/tmp/omr/x/$(printf %03d $n).xml" ;;
  esac
done < <(find /tmp/omr/out -type f \( -name '*.mxl' -o -name '*.xml' \) | sort -V)
echo "movement files found: $n"
res=""
if [ "$n" -ge 1 ]; then
  python3 - /tmp/omr/x "$OUT" <<'PY' && res=ok
import sys, glob
import xml.etree.ElementTree as ET
files = sorted(glob.glob(sys.argv[1] + "/*.xml"))
base = ET.parse(files[0])
root = base.getroot()
parts = root.findall("part")
for extra in files[1:]:
  r = ET.parse(extra).getroot()
  for i, part in enumerate(r.findall("part")):
      if i >= len(parts):
          break
      last = 0
      for m in parts[i].findall("measure"):
          try:
              last = max(last, int(m.get("number", "0")))
          except ValueError:
              last += 1
      for m in part.findall("measure"):
          last += 1
          m.set("number", str(last))
          parts[i].append(m)
# tidy the recognised text: bar numbers that were read as text are noise; the first real text becomes the title
import re
def credit_text(c):
    return "".join(w.text or "" for w in c.findall("credit-words")).strip()
for c in list(root.findall("credit")):
    if re.fullmatch(r"[\d\W_]*", credit_text(c)):
        root.remove(c)
first = next((credit_text(c) for c in root.findall("credit") if credit_text(c)), "")
if first and root.find("work/work-title") is None:
    work = ET.Element("work")
    ET.SubElement(work, "work-title").text = first
    root.insert(0, work)
base.write(sys.argv[2], encoding="UTF-8", xml_declaration=True)
PY
fi

# what Audiveris complained about (helps to understand lost parts)
grep -E "WARN|ERROR|No staves|too small|Cannot|Unable|insufficient|skipped" /tmp/omr/log.txt | sort | uniq -c | sort -rn | head -15 | sed 's/^/audiveris: /'
[ -n "$res" ]
