#!/usr/bin/env bash
# Post-deploy smoke checks against the production Worker.
# Auth-gated routes should redirect or 401; public login must stay up.
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required}"
BASE_URL="${BASE_URL%/}"

expect_status() {
  local path="$1"
  local expected="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${BASE_URL}${path}")"
  if [[ "${code}" != "${expected}" ]]; then
    echo "smoke fail: GET ${path} expected ${expected}, got ${code}" >&2
    exit 1
  fi
  echo "ok: GET ${path} -> ${code}"
}

echo "Smoke testing ${BASE_URL}"
expect_status "/login" "200"
expect_status "/" "302"
expect_status "/api/health" "401"
echo "Smoke test passed"
