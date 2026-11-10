#!/usr/bin/env bash
# Runs every end-to-end suite (browser tests with a pretend GitHub, see tests/README.md).
# Usage: tests/run-all.sh [suite-name ...]      (no names = all of tests/suites.txt)
# Starts its own dev server, runs 2 suites at a time, retries a failed suite ONCE (timing on a busy machine), exits 1 if one still fails.
set -u -o pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/tests/out"; rm -rf "$OUT"; mkdir -p "$OUT/work"
cp tests/fixtures/* "$OUT/work/"          # tests write screenshots / backups next to their inputs
PORT=5173
up() { curl -s -o /dev/null -m 3 -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null | grep -q '^[23]'; }
SERVER=""
if ! up; then
  FEEDBACK_EMAIL=feedback@example.test npx vite --port $PORT --strictPort > "$OUT/vite.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 60); do up && break; sleep 0.5; done
fi
up || { echo "dev server did not start"; tail -n 20 "$OUT/vite.log"; exit 1; }
trap '[ -n "$SERVER" ] && kill $SERVER 2>/dev/null' EXIT

# the cloud converter script against fake engines (only when running everything)
SHELLFAIL=0; SHELLLINE=""
if [ $# -eq 0 ]; then
  if bash tests/shell/convert-script.sh > "$OUT/convert-script.log" 2>&1; then SHELLLINE="PASS  shell/convert-script"; echo "$SHELLLINE"; else SHELLLINE="FAIL  shell/convert-script"; echo "$SHELLLINE"; tail -n 12 "$OUT/convert-script.log" | sed 's/^/        /'; SHELLFAIL=1; fi
fi

if [ $# -gt 0 ]; then SUITES=("$@"); else mapfile -t SUITES < tests/suites.txt; fi
run_one() {
  local s="$1" log="$OUT/$1.log"
  for attempt in 1 2; do
    D="$OUT/work/" timeout 280 node "$ROOT/tests/e2e/$s.cjs" > "$log" 2>&1 && { echo "PASS  $s"; return 0; }
    [ $attempt = 1 ] && echo "retry $s (first run failed)"
  done
  echo "FAIL  $s"; grep -E "^FAIL|Error" "$log" | head -5 | sed 's/^/        /'
  return 1
}
export -f run_one; export OUT ROOT
printf '%s\n' "${SUITES[@]}" | xargs -P 2 -I{} bash -c 'run_one {}' | tee "$OUT/summary.txt"
[ -n "$SHELLLINE" ] && echo "$SHELLLINE" >> "$OUT/summary.txt"
FAILED=$(grep -c '^FAIL' "$OUT/summary.txt")
echo; echo "$(grep -c '^PASS' "$OUT/summary.txt") passed, $FAILED failed"
[ "$FAILED" = 0 ] && [ "$SHELLFAIL" = 0 ]
