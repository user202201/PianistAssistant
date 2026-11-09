#!/usr/bin/env bash
# Converts PDFs / photos in inbox/ to MusicXML in scores/ using Audiveris (open-source OMR).
# Run from the root of the PRIVATE scores repo, on a GitHub Actions Ubuntu runner.
# Any failure is written to inbox/<file>.failed.txt so the app can show the reason.
set -u -o pipefail
shopt -s nullglob nocaseglob

LOG=/tmp/convert-setup.log
: > "$LOG"

commit_results() {
  git config user.name "score-converter"
  git config user.email "converter@users.noreply.github.com"
  # inbox/ may no longer exist after its last file was converted (git does not track empty folders)
  git add -A -- scores 2>/dev/null || true
  if [ -d inbox ]; then git add -A -- inbox; fi
  if git diff --cached --quiet; then echo "nothing to commit"; return 0; fi
  git commit -q -m "Convert scores from inbox"
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  for _ in 1 2 3; do
    git push && return 0
    git pull --rebase origin "$branch" || return 1
  done
  return 1
}


# "retry" markers written by the app only exist to trigger this workflow: remove them
for r in inbox/*.retry.txt; do git rm -q -f "$r"; done

files=(inbox/*.pdf inbox/*.png inbox/*.jpg inbox/*.jpeg inbox/*.tif inbox/*.tiff inbox/*.bmp)
todo=()
for f in "${files[@]}"; do
  [ -e "$f.failed.txt" ] || todo+=("$f")
done
echo "${#todo[@]} file(s) to convert"
if [ "${#todo[@]}" -eq 0 ]; then commit_results; exit 0; fi

handled=0
fail_all() { # $1 = reason; marks every file that is still queued as failed
  handled=1
  echo "FATAL: $1" | tee -a "$LOG"
  for f in "${todo[@]}"; do
    [ -e "$f" ] || continue
    { echo "$1"; echo "-----"; tail -n 60 "$LOG"; } > "$f.failed.txt"
  done
  commit_results
  exit 1
}

# Safety net: if anything unexpected kills the script, still tell the app instead of leaving it "converting" forever
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$handled" -eq 0 ]; then
    handled=1
    for f in "${todo[@]}"; do
      [ -e "$f" ] || continue
      [ -e "$f.failed.txt" ] || { echo "Unexpected error (exit $rc) while converting"; echo "-----"; tail -n 60 "$LOG"; } > "$f.failed.txt"
    done
    commit_results || true
  fi
}
trap on_exit EXIT

# ---- which engine for which file: inbox/<file>.engine.txt says "audiveris" (default), "homr" or "both" ----
engine_of() {
  local e="audiveris"
  [ -f "$1.engine.txt" ] && e=$(tr -d ' \r\n' < "$1.engine.txt")
  case "$e" in homr|oemer|both|all|audiveris) echo "$e" ;; *) echo audiveris ;; esac
}
need_aud=0; need_homr=0; need_oemer=0
for f in "${todo[@]}"; do
  case "$(engine_of "$f")" in
    audiveris) need_aud=1 ;; homr) need_homr=1 ;; oemer) need_oemer=1 ;;
    both) need_aud=1; need_homr=1 ;; all) need_aud=1; need_homr=1; need_oemer=1 ;;
  esac
done

# ---- install Audiveris (unpack the .deb without running its desktop-menu post-install script) ----
install_audiveris() {
  if [ -n "${AUDIVERIS_BIN:-}" ]; then
    AUD="$AUDIVERIS_BIN"   # test hook
  else
    (
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
    ) >> "$LOG" 2>&1 || fail_all "Installing Audiveris failed"
    AUD=$(find /tmp/audiveris-root -type f -name Audiveris 2>/dev/null | head -1)
    [ -n "$AUD" ] || { ls -R /tmp/audiveris-root 2>&1 | head -40 >> "$LOG"; fail_all "Audiveris executable not found in the package"; }
    chmod +x "$AUD"
  fi
  echo "Audiveris: $AUD" | tee -a "$LOG"
  td=$(find /usr/share -name eng.traineddata 2>/dev/null | head -1)
  [ -n "$td" ] && export TESSDATA_PREFIX="$(dirname "$td")"
  # Ubuntu's English model cannot be loaded by Audiveris ("Could not initialize TessBaseAPI ... legacy mode"), so titles, tempo marks and
  # other text were lost. The full model from the Tesseract project works (measured in the OCR lab, .github/workflows/ocr-lab.yml).
  mkdir -p /tmp/tessdata-full
  if curl -fsSL --retry 3 -o /tmp/tessdata-full/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata && [ "$(wc -c < /tmp/tessdata-full/eng.traineddata)" -gt 1000000 ]; then
    export TESSDATA_PREFIX=/tmp/tessdata-full
    echo "using the full English text model" >> "$LOG"
  else
    echo "could not download the full English text model, using the system one" >> "$LOG"
  fi
  export JAVA_TOOL_OPTIONS="-Djava.awt.headless=true"
  echo "TESSDATA_PREFIX=${TESSDATA_PREFIX:-unset}" >> "$LOG"
}
# ---- install homr (deep-learning engine; its models are downloaded the first time it runs) ----
install_homr() {
  (
    set -e
    sudo apt-get update -qq
    sudo apt-get install -y -qq poppler-utils libgl1
    python3 -m pip install --upgrade pip
    python3 -m pip install homr || python3 -m pip install "git+https://github.com/liebharc/homr.git"
    command -v homr
  ) >> "$LOG" 2>&1 || fail_all "Installing homr failed"
}
# ---- install oemer (deep learning, MIT licence) ----
install_oemer() {
  (
    set -e
    sudo apt-get update -qq
    sudo apt-get install -y -qq poppler-utils libgl1
    python3 -m pip install --upgrade pip
    python3 -m pip install oemer
    command -v oemer
  ) >> "$LOG" 2>&1 || fail_all "Installing oemer failed"
}
[ "$need_aud" = 1 ] && install_audiveris
[ "$need_homr" = 1 ] && install_homr
[ "$need_oemer" = 1 ] && install_oemer

# ---- convert ----
mkdir -p scores
for f in "${todo[@]}"; do
  [ -e "$f.failed.txt" ] && continue
  base=$(basename "$f"); stem="${base%.*}"; ext="${base##*.}"
  engine=$(engine_of "$f")
  echo "== $base  (engine: $engine)"
  ok_any=0; report=""
  # Audiveris -> scores/<name>.musicxml ; homr -> scores/<name>.musicxml, or "<name> [homr].musicxml" when both engines run (to compare)
  if [ "$engine" = audiveris ] || [ "$engine" = both ] || [ "$engine" = all ]; then
    rc=0
    AUD="$AUD" bash "$(dirname "$0")/convert-one.sh" "$f" "scores/$stem.musicxml" > /tmp/omr-run.txt 2>&1 || rc=$?
    cat /tmp/omr-run.txt
    if [ "$rc" -eq 0 ]; then ok_any=1; else report="$report"$'\n'"Audiveris failed (exit $rc):"$'\n'"$(tail -n 30 /tmp/omr-run.txt)"$'\n'"$(tail -n 60 /tmp/omr/log.txt 2>/dev/null)"; fi
  fi
  multi=0; { [ "$engine" = both ] || [ "$engine" = all ]; } && multi=1
  if [ "$engine" = homr ] || [ "$multi" = 1 ]; then
    out="scores/$stem.musicxml"; [ "$multi" = 1 ] && out="scores/$stem [homr].musicxml"
    rc=0
    bash "$(dirname "$0")/convert-homr.sh" "$f" "$out" > /tmp/homr-run.txt 2>&1 || rc=$?
    cat /tmp/homr-run.txt
    if [ "$rc" -eq 0 ]; then ok_any=1; else report="$report"$'\n'"homr failed (exit $rc):"$'\n'"$(tail -n 40 /tmp/homr-run.txt | cut -c1-300)"; fi
  fi
  if [ "$engine" = oemer ] || [ "$engine" = all ]; then
    out="scores/$stem.musicxml"; [ "$multi" = 1 ] && out="scores/$stem [oemer].musicxml"
    rc=0
    bash "$(dirname "$0")/convert-oemer.sh" "$f" "$out" > /tmp/oemer-run.txt 2>&1 || rc=$?
    cat /tmp/oemer-run.txt
    if [ "$rc" -eq 0 ]; then ok_any=1; else report="$report"$'\n'"oemer failed (exit $rc):"$'\n'"$(tail -n 40 /tmp/oemer-run.txt | cut -c1-300)"; fi
  fi
  if [ "$ok_any" = 1 ]; then
    git rm -q -f "$f" 2>/dev/null || true; git rm -q -f "$f.engine.txt" 2>/dev/null || true
    echo "OK: $base"
  else
    { echo "Conversion failed ($engine): $base"; echo "-----"; echo "$report"; echo "----- setup"; tail -n 20 "$LOG"; } > "$f.failed.txt"
    echo "FAILED: $base"
  fi
done

commit_results || exit 1
