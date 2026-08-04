# UniFi Protect Assistant

A lightweight, premium Cloudflare Workers app that ingests webhook notifications from UniFi Protect (specifically focusing on face/person detection), stores normalized events in Cloudflare D1, generates daily first-seen/last-seen reports via cron triggers, and displays a mobile-friendly read-only dashboard.

## Features

- **Webhook Ingestion (`POST /unifi`)**: Authenticated webhook processing with schema parsing safeguards.
- **Today dashboard**: Live landing page of who is present / was seen today, unknown-face counts, last-hour activity, webhook health, and a polling event stream (computed from `face_events`).
- **People profiles**: Directory and `/people/:personKey` pages with typical arrival/departure, visit totals, camera frequency, heatmap, and recent thumbnails (keyed by stable `person_key`).
- **Vehicles**: Directory and `/vehicles/:plateKey` plus `/vehicle-events` day log (keyed by `plate_key`). Visit/heatmap stats are derived on-read from `vehicle_events`.
- **Health diagnostics**: `/health` shows last webhook/event, hour/day volumes, ingest counters (rejects, duplicates, D1 failures), cron last runs, row counts, and config warnings.
- **Presence sessions**: Gap-based sessionization (default 20 minutes) so daily totals reflect observed presence, not first-to-last wall clock.
- **Person Tracking**: By default, captures all known people from UniFi Protect's Face Library (`face_known`) plus unrecognized faces (`face_unknown`). Optional `TARGET_PERSON_NAMES` / `TARGET_PERSON_IDS` env vars restrict ingestion to specific individuals.
- **Person Filter Dropdown**: Calendar and Events Log views include a dropdown to filter by any detected person (or "All People").
- **Reporting**: Materializes `presence_sessions` and `daily_person_reports` (first/last wall span + observed presence hours).
- **Aesthetic UI**: A modern glassmorphism calendar and event log UI rendered server-side for rapid, responsive mobile and desktop viewing. Event thumbnails are shown when available.
- **Data Retention Policy**: Scrubs raw payloads/images after ~30 days; deletes normalized events, reports, and sessions after ~365 days. Parent webhook rows can be removed while retained children keep `notification_id = NULL` (`ON DELETE SET NULL`).
- **Vehicle events**: License-plate ingestion is gated behind `ENABLE_VEHICLE_EVENTS=true`. Browse `/vehicles`, `/vehicles/:plateKey`, and `/vehicle-events` (same Access gate as People). Plate values are never logged or sent to Honeybadger.
- **Readiness**: Public `GET /ready` checks D1 connectivity and required schema without exposing counts or config.

---

## Architecture Overview

```
UniFi Protect NVR (Alarm Webhook)
       │
       ▼
 ┌───────────┐    Authenticate X-Webhook-Secret
 │ Cloudflare│───► Ingest raw payload to `webhook_notifications`
 │  Worker   │───► Parse face recognition events
 └─────┬─────┘───► Ingest to `face_events` (deduplicated by eventId)
       │
       ├─────────► Scheduled Cron Handler (once daily after midnight America/New_York)
       │           ├─► Compute Yesterday's `presence_sessions` + `daily_person_reports`
       │           └─► Purge expired records (30 days raw / 1 yr events, reports & sessions)
       │
       └─────────► Read-Only Web Interface (Cloudflare Zero Trust Access + ALLOWED_EMAILS)
                                      ├─► GET / → /today (live dashboard from face_events)
                   ├─► GET /api/today (JSON snapshot for 15s polling)
                   ├─► GET /people (directory by person_key)
                   ├─► GET /people/:personKey (profile)
                   ├─► GET /api/people (directory JSON)
                   ├─► GET /api/people/:personKey (profile JSON)
                   ├─► GET /vehicles (directory by plate_key)
                   ├─► GET /vehicles/:plateKey (profile)
                   ├─► GET /api/vehicles (directory JSON)
                   ├─► GET /api/vehicles/:plateKey (profile JSON)
                   ├─► GET /vehicle-events?date=YYYY-MM-DD&plate=plate:KEY
                   ├─► GET /health (diagnostics)
                   ├─► GET /api/health (diagnostics JSON)
                   ├─► GET /calendar?month=YYYY-MM&person=Name
                   ├─► GET /events?date=YYYY-MM-DD&person=Name
                                      ├─► GET /api/reports?month=YYYY-MM&person=Name
                   └─► GET /api/events?date=YYYY-MM-DD&person=Name
```

---

## Cloudflare Prerequisites

1. Install Wrangler CLI locally:
   ```bash
   npm install -g wrangler
   ```
2. Authenticate Wrangler:
   ```bash
   npx wrangler login
   ```
3. Create your D1 Database:
   ```bash
   npx wrangler d1 create unifi_protect_db
   ```
4. Create your KV Namespace:
   ```bash
   npx wrangler kv namespace create unifi_protect_kv
   ```

---

## Configuration & Local Development

### 1. `wrangler.toml` Setup

Configure the bindings matching your database and KV namespace IDs:

```toml
name = "unifi-protect-assistant"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
TIMEZONE = "America/New_York"
TARGET_PERSON_NAMES = ""  # Optional: comma-separated names to restrict ingestion (blank = all people)
TARGET_PERSON_IDS = ""    # Optional: comma-separated UniFi face IDs to restrict ingestion
WATCH_CAMERA_IDS = ""     # Optional list to narrow down cameras
ALLOWED_EMAILS = ""       # Shown for docs only — production uses a Worker secret
# CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are Worker secrets (not [vars])
PRESENCE_GAP_MINUTES = "20"   # Minutes between sightings before a new presence session
PRESENCE_GAP_BY_PERSON = ""   # Optional JSON: {"id:personKey": 45}
PRESENCE_GAP_BY_CAMERA = ""   # Optional JSON: {"camera-id": 5} (same-camera consecutive events)

[[d1_databases]]
binding = "DB"
database_name = "unifi_protect_db"
database_id = "YOUR_D1_DATABASE_ID"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"
```

### 2. Local Environment Variables

Create a `.dev.vars` file in the root directory:

```env
WEBHOOK_SECRET=your_dev_shared_webhook_secret
ALLOWED_EMAILS=you@example.com,other@example.com
CF_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CF_ACCESS_AUD=your_access_application_aud_tag
HONEYBADGER_API_KEY=your_honeybadger_api_key
# Local UI only — never enable in production:
# ALLOW_LOCAL_AUTH_BYPASS=true
# ALLOW_INSECURE_WEBHOOKS=true
# MAX_WEBHOOK_BODY_BYTES=2097152
# ENABLE_VEHICLE_EVENTS=true
```

> **Warning:** `ALLOW_INSECURE_WEBHOOKS=true` disables webhook authentication. Use only on localhost. Production must set `WEBHOOK_SECRET` and leave insecure mode `false`.

### 3. Local Migration Application

Apply the database migrations to your local development environment:

```bash
npm run db:migrate:local
```

### 4. Running the Dev Server

Launch wrangler's local development server:

```bash
npm run dev
```

### Person Filtering

By default (with `TARGET_PERSON_NAMES` and `TARGET_PERSON_IDS` left blank), the app ingests every face detection UniFi Protect sends — all named people from your Face Library plus unrecognized faces (`Unknown`). Use the **Person** dropdown on the Calendar and Events Log pages to filter the view to a single individual, or leave it on **All People** for the combined view.

Set `TARGET_PERSON_NAMES` and/or `TARGET_PERSON_IDS` only if you want to restrict which detections are stored at ingestion time (e.g. privacy or opt-in tracking for specific individuals). The UI dropdown always reflects whoever has been ingested into the database.

### Presence sessions

Sightings are grouped into sessions when consecutive detections for the same person fall within `PRESENCE_GAP_MINUTES` (default 20). Larger gaps start a new session. Daily observed presence is the sum of session durations (rounded up to 15 minutes per session total for display hours). The calendar shows **observed** hours; tooltips still include the first–last wall-clock span for comparison.

The **Today** page recomputes this live from `face_events` every request/poll. Historical months use a freshness check (`materialization_state`: event count, max timestamp, materializer version) so already-fresh dates are not rewritten on every calendar GET. Cron still force-regenerates yesterday safely.

### Person profiles

Each detected identity has a stable `person_key` (`id:…` when UniFi provides a face ID, otherwise `name:…`). Open **People** in the nav or visit `/people/<urlencoded-person_key>` (example: `/people/id%3Aabc123`). Profiles show lifetime first/last seen, observed visit totals from presence sessions, median typical arrival/departure (90 days), top cameras, a 12-month heatmap, and recent thumbnails.

### Vehicle profiles

License plates use a stable `plate_key` (`plate:ABC123` or `plate:unknown`). Open **Vehicles** in the nav or visit `/vehicles/<urlencoded-plate_key>` (example: `/vehicles/plate%3AABC123`). Visit counts, typical arrival/departure, and heatmaps are derived on-read from `vehicle_events` using the same gap minutes as people (`PRESENCE_GAP_MINUTES`). Day logs live at `/vehicle-events`. Configure Protect alarms to send only the plate subset you care about.

### Retention (raw vs normalized)

| Data                                                       | Retention | Behavior                                           |
| ---------------------------------------------------------- | --------- | -------------------------------------------------- |
| `webhook_notifications.payload_json` / `image_base64`      | ~30 days  | Scrubbed to `{}` / `NULL`, then parent row deleted |
| `face_events` / `vehicle_events` raw trigger JSON + images | ~30 days  | Scrubbed; normalized row retained                  |
| `face_events` / `vehicle_events` rows                      | ~365 days | Deleted                                            |
| `daily_person_reports` / `presence_sessions`               | ~365 days | Deleted                                            |
| Child `notification_id` after parent delete                | —         | Set `NULL` via `ON DELETE SET NULL`                |

### Webhook status / retry behavior

- Missing `WEBHOOK_SECRET` (without insecure opt-in) → **503** (configuration error; fail closed).
- Wrong secret → **401**.
- Oversized body → **413** (Content-Length fast-path + streaming byte cap).
- Invalid JSON / timestamps → **400** (generic message; no internals).
- Transient D1 / write failures → **503** (retriable). Successful writes only return **200**.
- Exact duplicate deliveries use a privacy-safe `delivery_key` (`ON CONFLICT DO NOTHING` on the parent); child rows dedupe with `ON CONFLICT(event_id) DO NOTHING`.

### Health diagnostics

Authenticated users can open **Health** (`/health`) for:

- Last webhook received and last normalized `face_events` timestamp
- Event/webhook volumes for the past hour and day
- Today’s D1 atomic counters: rejected auth/JSON/body, duplicates, zero-detection webhooks, D1 write failures
- Most recent cron report/cleanup timestamps, cleanup summary counts, FK integrity check marker
- D1 row counts (byte size remains in the Cloudflare dashboard)
- Configuration warnings (missing secrets, empty allowlist, stale cleanup, bad gap JSON)
- Redacted error codes/operations only (no raw SQL on the health page)

---

## Deployment & Production Setup

### Secrets configuration

Set secrets on the live worker (do not commit these values):

```bash
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ALLOWED_EMAILS
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put HONEYBADGER_API_KEY
```

Set `HONEYBADGER_API_KEY` from your [Honeybadger](https://www.honeybadger.io/) project so uncaught and caught server errors (auth, webhook ingest, cron) are reported via `@honeybadger-io/cloudflare`.

`ALLOWED_EMAILS` is a Worker secret (set in GitHub Actions secrets and synced on deploy), not a `[vars]` entry. `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are also Worker secrets, typically synced from Access provisioning output during deploy.

### Production migrations (expand / migrate / contract)

1. **Backup**: Cloudflare snapshots D1 before remote migration apply; also export if you need a portable copy:
   ```bash
   npx wrangler d1 export unifi_protect_db --remote --output backup.sql
   ```
2. **Apply additive migrations** (this release includes `0008_retention_fk_ops.sql` table rebuilds using `PRAGMA defer_foreign_keys`):
   ```bash
   npm run db:migrate:prod
   ```
3. **Deploy Worker** that understands the new schema (`npm run deploy` or CI).
4. **Rollback limitations**: Worker code can be rolled back with `wrangler rollback`. D1 migrations are forward-only — dropping rebuilt tables or reversing `ON DELETE SET NULL` requires a new forward migration and may lose data. Do not assume schema rollback.

### Incident recovery (retention FK)

If Honeybadger reports `FOREIGN KEY constraint failed` during cleanup before this migration:

```bash
# Confirm migration 0008 is applied remotely
npx wrangler d1 migrations list DB --remote
# Apply if pending, then redeploy Worker
npm run db:migrate:prod
npm run deploy
# Optional integrity check via Worker cron or local:
# PRAGMA foreign_key_check;
```

### Manual Deploy

```bash
npm run deploy
```

---

## GitHub Actions Deployment (CI/CD)

Pull requests run the **quality** job only (install, typecheck, lint, format, unit + real SQLite migration/integration tests, fresh local D1 migrate, populated-schema upgrade). Production **deploy** runs only after quality succeeds on `main`.

Add the following secrets to your GitHub Repository Settings (`Settings -> Secrets and variables -> Actions`):

| GitHub secret           | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token (Workers, D1, KV, Access Apps write) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID                                     |
| `WEBHOOK_SECRET`        | Shared secret for `POST /unifi`                           |
| `ALLOWED_EMAILS`        | Comma-separated exact-email allowlist (Access + Worker)   |
| `HONEYBADGER_API_KEY`   | Honeybadger project API key (error reporting)             |

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are written to the Worker as secrets during deploy from the Access provisioning script output. They do not need to be stored as separate GitHub secrets unless you prefer to pin them.

Smoke tests verify Access intercepts dashboard routes, `/ready` stays public, `/login` and `/api/auth/*` are gone, and `POST /unifi` still requires `X-Webhook-Secret`. They never insert biometric or plate data.

After a successful cutover, manually delete obsolete repository secrets if present: `BETTER_AUTH_SECRET`, `BETTER_AUTH_API_KEY`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

You can also re-run the workflow via `workflow_dispatch` to refresh Cloudflare secrets without a code change.

---

## UniFi Protect Webhook Configuration

In the UniFi Protect controller interface under the **Alarm Manager**:

1. Create a new alarm triggering on person/face detections.
2. Select **Webhook** as the notification type.
3. Method: `POST`
4. URL: `https://unifi-protect-assistant.YOUR-SUBDOMAIN.workers.dev/unifi`
5. Header: `X-Webhook-Secret: <YOUR_WEBHOOK_SECRET>`
6. Ensure thumbnail attachments are disabled.

---

## Authentication (Cloudflare Zero Trust Access)

Dashboard routes are protected by **Cloudflare Access** at the edge and again inside the Worker.

Login uses the **Cloudflare** Access identity provider with instant authentication (same pattern as sunsethue-helper), protecting the public Worker hostname. One-time PIN is only a fallback when Cloudflare IdP is absent. Access still allows only emails listed in `ALLOWED_EMAILS`.

### ALLOWED_EMAILS (source of truth)

Comma-separated **exact** email addresses (no wildcards, no `*@domain`, no domain-only rules):

```env
ALLOWED_EMAILS=alice@example.com,bob@example.com
```

Normalization: trim, lowercase, drop empties, dedupe. Malformed entries fail closed.

The same normalized list drives:

1. Cloudflare Access **Allow** policy (one exact-email rule per address)
2. Worker JWT email authorization after cryptographic validation

After changing `ALLOWED_EMAILS`, rerun Access provisioning and redeploy Worker secrets:

```bash
npm run access:configure
# then set CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN from the script output
```

### Worker JWT validation

Protected requests must present `Cf-Access-Jwt-Assertion`. The Worker validates RS256 via jose against JWKS at `{CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, then checks `iss`, `aud` (`CF_ACCESS_AUD`), `exp`/`nbf`, and that `email` is in `ALLOWED_EMAILS`.

Retrieve the AUD from Zero Trust → Access → Applications → UniFi Protect Assistant → Application Audience, or from `npm run access:configure` output.

### `/unifi` and `/ready` path exceptions

UniFi Protect cannot complete a browser Access login. A separate Access application covers **only** `…workers.dev/unifi` with **Bypass / Everyone**.

A second path-scoped Bypass covers **only** `/ready` (public readiness probe; no secrets, allowlist, or PII).

Bypass disables Access authentication and Access request logging for those paths. The Worker’s fail-closed `X-Webhook-Secret` validation remains mandatory on `/unifi`.

### Local development

Set `ALLOW_LOCAL_AUTH_BYPASS=true` in `.dev.vars` for `localhost` / `127.0.0.1` only. Never enable in production. Missing JWT is not treated as authenticated without this explicit flag.

### Logout

Use `/cdn-cgi/access/logout`. Session duration is 8 hours (Access policy).

### Provisioning

```bash
# Dry-run (no mutations)
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… ALLOWED_EMAILS='alice@example.com'   node scripts/configure-cloudflare-access.mjs --dry-run

# Apply
npm run access:configure
```

`CLOUDFLARE_API_TOKEN` is a **provisioning/deployment** credential only. It is never passed to the Worker runtime.

### Manual dashboard verification

Zero Trust → Access controls → Applications → **UniFi Protect Assistant**:

- each `ALLOWED_EMAILS` entry has an exact-email Allow rule
- no email-domain or Everyone Allow rule
- only the webhook app has Bypass for `/unifi`

### Obsolete secrets to remove manually after cutover

Remove from GitHub Actions and Cloudflare Worker secrets if still present:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_API_KEY`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Privacy & Security Disclaimer

The dashboard and JSON APIs require **Cloudflare Access**. Only emails listed in `ALLOWED_EMAILS` may authenticate (Access policy + Worker JWT check).

`POST /unifi` remains separate: it uses the `X-Webhook-Secret` shared secret so UniFi Protect can post without a browser login. Requests without a configured secret fail closed with 503 unless `ALLOW_INSECURE_WEBHOOKS=true` (local only).

While raw UniFi Protect payloads are not displayed publicly, authenticated users can see dates, times, camera IDs, detection thumbnails, and names of individuals detected by the system. Keep `ALLOWED_EMAILS` and Access policies up to date. License-plate text is treated as sensitive personal data.
