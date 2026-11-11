#!/usr/bin/env bash
# A store build (LOCAL_ONLY=1) must not contain the GitHub conversion relay UI; the web build does.
set -u -o pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
rm -rf /tmp/dist-store /tmp/dist-web
LOCAL_ONLY=1 MOBILE=1 npx vite build --outDir /tmp/dist-store --emptyOutDir > /tmp/build-store.log 2>&1 || { tail -n 8 /tmp/build-store.log; exit 1; }
LOCAL_ONLY=0 BASE_PATH=/ npx vite build --outDir /tmp/dist-web --emptyOutDir > /tmp/build-web.log 2>&1 || { tail -n 8 /tmp/build-web.log; exit 1; }
check "the web build has the connect-for-conversion button" 'grep -rq "connect-conv-btn" /tmp/dist-web/assets'
check "the store build does not" '! grep -rq "connect-conv-btn" /tmp/dist-store/assets && ! grep -rq "pianist.conv.v1" /tmp/dist-store/assets'
[ $fail = 0 ] && echo "ALL PASSED"
exit $fail
