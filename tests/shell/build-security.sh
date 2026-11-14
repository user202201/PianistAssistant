#!/usr/bin/env bash
# Security checks on the BUILT website and the BUILT store bundle (see build-security.cjs).
set -u -o pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
rm -rf /tmp/sec-web /tmp/sec-store
BASE_PATH=/ LOCAL_ONLY=0 npx vite build --outDir /tmp/sec-web --emptyOutDir > /tmp/sec-build-web.log 2>&1 || { tail -n 8 /tmp/sec-build-web.log; exit 1; }
LOCAL_ONLY=1 MOBILE=1 npx vite build --outDir /tmp/sec-store --emptyOutDir > /tmp/sec-build-store.log 2>&1 || { tail -n 8 /tmp/sec-build-store.log; exit 1; }
node tests/shell/build-security.cjs /tmp/sec-web /tmp/sec-store
