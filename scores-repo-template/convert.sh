#!/usr/bin/env bash
# Converts PDFs / photos in inbox/ to MusicXML in scores/ using Audiveris (open-source OMR).
# Run from the root of the PRIVATE scores repo, on a GitHub Actions Ubuntu runner.
# Any failure is written to inbox/<file>.failed.txt so the app can show the reason.
set -u -o pipefail
shopt -s nullglob nocaseglob

LOG=/tmp/convert-setup.log
: > "$LOG"

files=(inbox/*.pdf inbox/*.png inbox/*.jpg inbox/*.jpeg inbox/*.tif inbox/*.tiff inbox/*.bmp)
todo=()
for f in "${files[@]}"; do
  [ -e "$f.failed.txt" ] || todo+=("$f")
done
echo "${#todo[@]} file(s) to convert"
[ "${#todo[@]}" -eq 0 ] && exit 0

commit_results() {
  git config user.name "score-converter"
  git config user.email "converter@users.noreply.github.com"
  git add -A scores inbox
  if git diff --cached --quiet; then echo "nothing to commit"; return 0; fi
  git commit -q -m "Convert scores from inbox"
  git push || { git pull --rebase origin "$(git rev-parse --abbrev-ref HEAD)" && git push; }
}

fail_all() { # $1 = reason; marks every file that is still queued as failed
  echo "FATAL: $1" | tee -a "$LOG"
  for f in "${todo[@]}"; do
    [ -e "$f" ] || continue
    { echo "$1"; echo "-----"; tail -n 60 "$LOG"; } > "$f.failed.txt"
  done
  commit_results
  exit 1
}

# ---- install Audiveris (unpack the .deb without running its desktop-menu post-install script) ----
if [ -n "${AUDIVERIS_BIN:-}" ]; then
  AUD="$AUDIVERIS_BIN"   # test hook
else
  {
    set -e
    sudo apt-get update -qq
    sudo apt-get install -y -qq tesseract-ocr tesseract-ocr-eng jq unzip
    auth=()
    [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
    url=$(curl -fsSL "${auth[@]}" https://api.github.com/repos/Audiveris/audiveris/releases/latest |
      jq -r '([.assets[].browser_download_url | select(test("(?i)ubuntu.*(x86_64|amd64).*\\.deb$"))][0]) // ([.assets[].browser_download_url | select(test("(?i)\\.deb$"))][0])')
    echo "Using $url"
    curl -fsSL -o /tmp/audiveris.deb "$url"
    mkdir -p /tmp/audiveris-root
    dpkg-deb -x /tmp/audiveris.deb /tmp/audiveris-root
  } >> "$LOG" 2>&1 || fail_all "Installing Audiveris failed"
  AUD=$(find /tmp/audiveris-root -type f -name Audiveris 2>/dev/null | head -1)
  [ -n "$AUD" ] || { ls -R /tmp/audiveris-root 2>&1 | head -40 >> "$LOG"; fail_all "Audiveris executable not found in the package"; }
  chmod +x "$AUD"
fi
echo "Audiveris: $AUD" | tee -a "$LOG"
td=$(find /usr/share -name eng.traineddata 2>/dev/null | head -1)
[ -n "$td" ] && export TESSDATA_PREFIX="$(dirname "$td")"
export JAVA_TOOL_OPTIONS="-Djava.awt.headless=true"
echo "TESSDATA_PREFIX=${TESSDATA_PREFIX:-unset}" >> "$LOG"

# ---- convert ----
mkdir -p scores
for f in "${todo[@]}"; do
  [ -e "$f.failed.txt" ] && continue
  base=$(basename "$f"); stem="${base%.*}"; ext="${base##*.}"
  rm -rf /tmp/omr; mkdir -p /tmp/omr/in /tmp/omr/out
  cp "$f" "/tmp/omr/in/score.$ext"   # ASCII name: safest for the OMR engine
  rc=0
  timeout 1500 "$AUD" -batch -transcribe -export -output /tmp/omr/out -- "/tmp/omr/in/score.$ext" > /tmp/omr/log.txt 2>&1 || rc=$?
  res=$(find /tmp/omr/out -type f -name '*.mxl' | sort | head -1)
  [ -n "$res" ] || res=$(find /tmp/omr/out -type f -name '*.xml' | sort | head -1)
  if [ -n "$res" ]; then
    case "$res" in
      *.mxl)
        inner=$(unzip -Z1 "$res" | grep -v '^META-INF' | grep -iE '\.(xml|musicxml)$' | head -1)
        unzip -p "$res" "$inner" > "scores/$stem.musicxml" ;;
      *) cp "$res" "scores/$stem.musicxml" ;;
    esac
    git rm -q -f "$f"
    echo "OK: $base"
  else
    { echo "Conversion failed (exit $rc): $base"; echo "-----"; tail -n 80 /tmp/omr/log.txt; echo "----- setup"; tail -n 20 "$LOG"; } > "$f.failed.txt"
    echo "FAILED: $base"
  fi
done

commit_results
