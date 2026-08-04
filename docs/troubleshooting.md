# Troubleshooting

Use authenticated **Health** (`/health`) and public **`/ready`** for safe diagnostics. Do not dump raw webhook payloads, images, full plates, tokens, or secrets into logs or tickets.

## Webhook health says “Stale / quiet”

Today marks the webhook unhealthy when recent traffic is missing or old. Confirm Protect alarms still fire, the Worker URL and `X-Webhook-Secret` match production, and Access Bypass covers only `/unifi` (not the whole hostname). Check Health for last received time and last-hour counts.

## `POST /unifi` returns 401

Wrong or missing `X-Webhook-Secret` when `WEBHOOK_SECRET` is configured. Compare the Protect header to the Worker secret (rotate both if unsure). Do not paste the secret into issues.

## `POST /unifi` returns 503

Common causes: `WEBHOOK_SECRET` unset without `ALLOW_INSECURE_WEBHOOKS` (fail closed), or a retriable D1 write failure. Fix secrets/config first; check Health for D1 failure counters and config warnings. Public `/ready` returning not-ready often means schema or database issues.

## Face events not appearing

Confirm face/person alarms post to `/unifi` and return `200`. Ensure optional `TARGET_PERSON_NAMES` / `TARGET_PERSON_IDS` / `WATCH_CAMERA_IDS` are not excluding everything. Open authenticated Today / Events / Health after a known detection.

## Vehicle events not appearing

1. Set `ENABLE_VEHICLE_EVENTS=true` and redeploy.
2. Configure Protect license-plate alarms to the same `/unifi` endpoint and secret.
3. Prefer a small known-plate set; browse **Vehicles** and `/vehicle-events` (Access required).

## Events stored but missing from a UI view

Today is date/timezone scoped (`TIMEZONE`). Calendar history is people-oriented; vehicle day history is under **Vehicles** / vehicle events. Person/plate filters and URL-encoded keys (`person_key` / `plate_key`) must match stored identities. Materialized person reports may lag until cron or calendar refresh.

## Cloudflare Access blocks the dashboard

Confirm your email is an exact entry in `ALLOWED_EMAILS`, Access Allow rules match, and `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` match the application. Re-run `npm run access:configure` after allowlist changes. Local bypass is only for localhost via `ALLOW_LOCAL_AUTH_BYPASS`.

## D1 migrations not applied

```bash
npx wrangler d1 migrations list DB --local
npx wrangler d1 migrations list DB --remote
npm run db:migrate:local   # or db:migrate:prod after backup
```

If `/ready` reports schema not ready, apply pending migrations.

## Duplicate webhook delivery

Duplicates are expected from Protect retries. Parent deliveries and child `event_id`s are deduplicated; Health may show duplicate counters without double-counting events.

## Checking `/ready` and `/health`

- `GET /ready` — public readiness (no PII). Expect ready after migrations and D1 connectivity.
- `GET /health` / `GET /api/health` — Access-authenticated diagnostics (volumes, counters, config warnings). Use these instead of querying raw tables in production tickets.
