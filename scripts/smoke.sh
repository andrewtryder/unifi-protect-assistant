#!/usr/bin/env bash
# Post-deploy smoke checks against the production Worker.
# Auth-gated routes should redirect or 401; public login/ready must stay up.
# Does not insert biometric or plate data into production.
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required}"
BASE_URL="${BASE_URL%/}"

expect_status() {
  local method="$1"
  local path="$2"
  local expected="$3"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X "${method}" --max-time 30 "${BASE_URL}${path}")"
  if [[ "${code}" != "${expected}" ]]; then
    echo "smoke fail: ${method} ${path} expected ${expected}, got ${code}" >&2
    exit 1
  fi
  echo "ok: ${method} ${path} -> ${code}"
}

echo "Smoke testing ${BASE_URL}"
expect_status GET "/login" "200"
expect_status GET "/ready" "200"
expect_status GET "/" "302"
expect_status GET "/api/health" "401"
# Webhook must fail closed without credentials (401 wrong/missing secret, or 503 if unset)
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "${BASE_URL}/unifi")"
if [[ "${code}" != "401" && "${code}" != "503" ]]; then
  echo "smoke fail: POST /unifi without credentials expected 401 or 503, got ${code}" >&2
  exit 1
fi
echo "ok: POST /unifi (no credentials) -> ${code}"
echo "Smoke test passed"
