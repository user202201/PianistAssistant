#!/usr/bin/env bash
# Builds scores-repo-bundle.zip: the files that make the PRIVATE scores repository independent of this (code) repository.
# The user drops its content into the scores repository once (docs/going-private/README.md, step 2).
set -euo pipefail
OUT="$(realpath -m "${1:-scores-repo-bundle.zip}")"
cd "$(dirname "$0")/.."
rm -rf /tmp/bundle && mkdir -p /tmp/bundle/tools /tmp/bundle/.github/workflows
cp scores-repo-template/convert.sh scores-repo-template/convert-one.sh scores-repo-template/convert-homr.sh scores-repo-template/convert-oemer.sh scores-repo-template/merge-pages.py /tmp/bundle/tools/
cp scores-repo-template/.github/workflows/convert.yml scores-repo-template/.github/workflows/lab.yml /tmp/bundle/.github/workflows/
cat > /tmp/bundle/README.txt <<'TXT'
Put these two folders (".github" and "tools") into the root of your PRIVATE scores repository (PianistScores).
GitHub web page of that repository -> "Add file" -> "Upload files" -> drag the two folders in -> "Commit changes".
After that, PDF conversion no longer needs the code repository at all.
(lab.yml: a private comparison of the recognition engines on your own PDFs; put them in a folder "lab" of that repository; they are deleted after the run and after two days at the latest.)
TXT
(cd /tmp/bundle && zip -qr "$OUT" .github tools README.txt)
echo "created $OUT"
