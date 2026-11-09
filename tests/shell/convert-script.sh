#!/usr/bin/env bash
# The cloud converter script (scores-repo-template/convert.sh) against FAKE engines: which engine is used for which file, how the
# results are named, that engine notes are cleaned up, and that one failing file does not stop the others.
set -u -o pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/remote.git" "$W/work"; cd "$W"
git init -q --bare remote.git; cd work; git init -q -b main; git remote add origin ../remote.git; mkdir inbox
PDF="$ROOT/tests/fixtures/Test-Piece-for-OCR.pdf"
for n in Plain OnlyHomr OnlyOemer Both All; do cp "$PDF" "inbox/$n.pdf"; done
echo homr > inbox/OnlyHomr.pdf.engine.txt; echo oemer > inbox/OnlyOemer.pdf.engine.txt; echo both > inbox/Both.pdf.engine.txt; echo all > inbox/All.pdf.engine.txt
echo "not a pdf" > inbox/Broken.pdf; echo homr > inbox/Broken.pdf.engine.txt   # unreadable file
git add -A; git -c user.email=a@b -c user.name=t commit -qm init; git push -q -u origin main 2>/dev/null
XML() { echo "<?xml version=\"1.0\"?><score-partwise><part-list><score-part id=\"P1\"/></part-list><part id=\"P1\"><measure number=\"1\"><note><pitch><step>$1</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>"; }
cat > "$W/bin/fakeaud" <<EOS
#!/bin/bash
out=""; while [ \$# -gt 0 ]; do [ "\$1" = "-output" ] && out="\$2"; shift; done
mkdir -p "\$out"; echo '$(XML C)' > "\$out/score.xml"
EOS
cat > "$W/bin/homr" <<EOS
#!/bin/bash
f="\$1"; echo '$(XML D)' > "\${f%.*}.musicxml"
EOS
cat > "$W/bin/oemer" <<EOS
#!/bin/bash
img="\$1"; out="\$3"; b=\$(basename "\$img"); mkdir -p "\$out"; echo '$(XML E)' > "\$out/\${b%.*}.musicxml"
EOS
printf '#!/bin/bash\nexit 0\n' > "$W/bin/sudo"
chmod +x "$W/bin/"*
# no real installs: the engines above are on the PATH
sed 's#python3 -m pip install --upgrade pip#true#; s#python3 -m pip install homr .*#true#; s#python3 -m pip install oemer#true#' "$ROOT/scores-repo-template/convert.sh" > "$W/convert.sh"
cp "$ROOT"/scores-repo-template/convert-*.sh "$ROOT/scores-repo-template/merge-pages.py" "$W/"
PATH="$W/bin:$PATH" AUDIVERIS_BIN="$W/bin/fakeaud" bash "$W/convert.sh" > "$W/run.log" 2>&1
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
first() { grep -o "<step>[A-G]" "scores/$1" | head -1 | sed 's/<step>//'; }
check "default engine (Audiveris) -> Plain.musicxml" '[ "$(first Plain.musicxml)" = C ]'
check "homr only -> OnlyHomr.musicxml" '[ "$(first OnlyHomr.musicxml)" = D ]'
check "oemer only -> OnlyOemer.musicxml" '[ "$(first OnlyOemer.musicxml)" = E ]'
check "both -> Both.musicxml (Audiveris) and 'Both [homr].musicxml'" '[ "$(first Both.musicxml)" = C ] && [ "$(first "Both [homr].musicxml")" = D ]'
check "all -> three results" '[ "$(first All.musicxml)" = C ] && [ "$(first "All [homr].musicxml")" = D ] && [ "$(first "All [oemer].musicxml")" = E ]'
check "a title is set for deep-learning results" 'grep -q "<work-title>OnlyHomr" scores/OnlyHomr.musicxml'
check "engine notes are cleaned up and converted PDFs are removed" '[ -z "$(ls inbox | grep -v Broken)" ]'
check "a failing file does not stop the others, and says why" '[ -f inbox/Broken.pdf.failed.txt ] && grep -q "homr failed" inbox/Broken.pdf.failed.txt'
check "everything is committed and pushed" '[ -z "$(git status --porcelain)" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]'
[ $fail = 0 ] && echo "ALL PASSED" || { echo; tail -n 30 "$W/run.log"; }
exit $fail
