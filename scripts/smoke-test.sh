#!/usr/bin/env bash
# Usage: smoke-test.sh <base-url>
# Exits non-zero on any failure — CI treats this as a blocking gate.
set -euo pipefail

BASE_URL="${1:?Usage: smoke-test.sh <base-url>}"
PASS=0
FAIL=0

check() {
  local name="$1" url="$2" expected="$3"
  local body
  body=$(curl -sf --max-time 10 "$url") || { echo "✗ $name — no response from $url"; FAIL=$((FAIL+1)); return; }
  if echo "$body" | grep -q "$expected"; then
    echo "✓ $name"
    PASS=$((PASS+1))
  else
    echo "✗ $name — expected '$expected' in response: $body"
    FAIL=$((FAIL+1))
  fi
}

echo "Smoke tests → $BASE_URL"
echo "──────────────────────────────────"

check "root endpoint returns hello world" "${BASE_URL}/"       '"message":"Hello, World!"'
check "health endpoint returns ok"        "${BASE_URL}/health"  '"status":"ok"'

echo "──────────────────────────────────"
echo "Results: ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
