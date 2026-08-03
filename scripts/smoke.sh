#!/usr/bin/env bash
# Post-deploy smoke checks against the production Worker behind Cloudflare Access.
# Without an Access session, dashboard routes are intercepted by Access (not served by the Worker).
# POST /unifi must reach the Worker (path Bypass) and still require X-Webhook-Secret.
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required}"
BASE_URL="${BASE_URL%/}"

echo "Smoke testing ${BASE_URL}"

expect_access_intercept() {
  local path="$1"
  local code
  code="$(curl -sS -o /tmp/smoke-body.txt -w '%{http_code}' --max-time 30 "${BASE_URL}${path}" || true)"
  if [[ "${code}" == "200" ]] && grep -q '"db_usage"' /tmp/smoke-body.txt; then
    echo "smoke fail: GET ${path} returned Worker health without Access session" >&2
    exit 1
  fi
  if [[ "${code}" != "302" && "${code}" != "401" && "${code}" != "403" && "${code}" != "200" ]]; then
    echo "smoke fail: GET ${path} expected Access intercept, got ${code}" >&2
    exit 1
  fi
  echo "ok: GET ${path} -> ${code} (Access intercept)"
}

expect_access_intercept "/"
expect_access_intercept "/today"
expect_access_intercept "/api/health"

ready_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${BASE_URL}/ready")"
if [[ "${ready_code}" != "200" ]]; then
  echo "smoke fail: GET /ready expected 200, got ${ready_code}" >&2
  exit 1
fi
echo "ok: GET /ready -> 200"

login_code="$(curl -sS -o /tmp/smoke-login.txt -w '%{http_code}' --max-time 30 "${BASE_URL}/login" || true)"
if grep -qiE 'Continue with Google|better-auth|Sign In \| UniFi' /tmp/smoke-login.txt; then
  echo "smoke fail: /login still serves Better Auth login page" >&2
  exit 1
fi
echo "ok: GET /login -> ${login_code} (not Better Auth)"

auth_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${BASE_URL}/api/auth/session" || true)"
echo "ok: GET /api/auth/session -> ${auth_code}"

code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST --max-time 30 \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "${BASE_URL}/unifi")"
if [[ "${code}" != "401" && "${code}" != "503" ]]; then
  echo "smoke fail: POST /unifi without credentials expected 401 or 503, got ${code}" >&2
  exit 1
fi
echo "ok: POST /unifi (no credentials) -> ${code}"

code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST --max-time 30 \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: invalid-smoke-secret' \
  --data '{}' \
  "${BASE_URL}/unifi")"
if [[ "${code}" != "401" && "${code}" != "503" ]]; then
  echo "smoke fail: POST /unifi invalid secret expected 401 or 503, got ${code}" >&2
  exit 1
fi
echo "ok: POST /unifi (invalid secret) -> ${code}"

get_code="$(curl -sS -o /dev/null -w '%{http_code}' -D /tmp/smoke-unifi-headers.txt -X GET --max-time 30 "${BASE_URL}/unifi")"
if [[ "${get_code}" != "405" ]]; then
  echo "smoke fail: GET /unifi expected 405, got ${get_code}" >&2
  exit 1
fi
if ! grep -qi '^allow:.*POST' /tmp/smoke-unifi-headers.txt; then
  echo "smoke fail: GET /unifi missing Allow: POST" >&2
  exit 1
fi
echo "ok: GET /unifi -> 405 Allow: POST"

echo "Smoke test passed"
