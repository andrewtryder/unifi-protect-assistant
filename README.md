# UniFi Protect Assistant

A lightweight, premium Cloudflare Workers app that ingests webhook notifications from UniFi Protect (specifically focusing on face/person detection), stores normalized events in Cloudflare D1, generates daily first-seen/last-seen reports via cron triggers, and displays a mobile-friendly read-only dashboard.

## Features

- **Webhook Ingestion (`POST /unifi`)**: Authenticated webhook processing with schema parsing safeguards.
- **Today dashboard**: Live landing page of who is present / was seen today, unknown-face counts, last-hour activity, webhook health, and a polling event stream (computed from `face_events`).
- **People profiles**: Directory and `/people/:personKey` pages with typical arrival/departure, visit totals, camera frequency, heatmap, and recent thumbnails (keyed by stable `person_key`).
- **Health diagnostics**: `/health` shows last webhook/event, hour/day volumes, ingest counters (rejects, duplicates, D1 failures), cron last runs, row counts, and config warnings.
- **Presence sessions**: Gap-based sessionization (default 20 minutes) so daily totals reflect observed presence, not first-to-last wall clock.
- **Person Tracking**: By default, captures all known people from UniFi Protect's Face Library (`face_known`) plus unrecognized faces (`face_unknown`). Optional `TARGET_PERSON_NAMES` / `TARGET_PERSON_IDS` env vars restrict ingestion to specific individuals.
- **Person Filter Dropdown**: Calendar and Events Log views include a dropdown to filter by any detected person (or "All People").
- **Reporting**: Materializes `presence_sessions` and `daily_person_reports` (first/last wall span + observed presence hours).
- **Aesthetic UI**: A modern glassmorphism calendar and event log UI rendered server-side for rapid, responsive mobile and desktop viewing. Event thumbnails are shown when available.
- **Data Retention Policy**: Automated cleanup purging raw payloads after 30 days, and normalized events/reports/sessions after 365 days.

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
       └─────────► Read-Only Web Interface (Google OAuth + ALLOWED_EMAILS)
                   ├─► GET /login (public)
                   ├─► GET / → /today (live dashboard from face_events)
                   ├─► GET /api/today (JSON snapshot for 15s polling)
                   ├─► GET /people (directory by person_key)
                   ├─► GET /people/:personKey (profile)
                   ├─► GET /api/people (directory JSON)
                   ├─► GET /api/people/:personKey (profile JSON)
                   ├─► GET /health (diagnostics)
                   ├─► GET /api/health (diagnostics JSON)
                   ├─► GET /calendar?month=YYYY-MM&person=Name
                   ├─► GET /events?date=YYYY-MM-DD&person=Name
                   ├─► GET /api/auth/* (better-auth)
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
ALLOWED_EMAILS = ""       # Comma-separated Google emails allowed to sign in
BETTER_AUTH_URL = "https://unifi-protect-assistant.mrcoffee.workers.dev"
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
# App signing secret (≥32 chars). Separate from the Infrastructure API key.
BETTER_AUTH_SECRET=generate_a_long_random_secret_at_least_32_chars
# From your Better Auth Infrastructure project (enables dash user mgmt / analytics)
BETTER_AUTH_API_KEY=ba_...
# Honeybadger project API key (error reporting)
HONEYBADGER_API_KEY=your_honeybadger_api_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
ALLOWED_EMAILS=you@gmail.com,other@example.com
BETTER_AUTH_URL=http://localhost:8787
```

### 3. Google OAuth redirect URIs
In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → your OAuth 2.0 Client, add Authorized redirect URIs:
- Production: `https://unifi-protect-assistant.mrcoffee.workers.dev/api/auth/callback/google`
- Local: `http://localhost:8787/api/auth/callback/google`

### 4. Local Migration Application
Apply the database migrations to your local development environment:
```bash
npm run db:migrate:local
```

### 5. Running the Dev Server
Launch wrangler's local development server:
```bash
npm run dev
```

### Person Filtering

By default (with `TARGET_PERSON_NAMES` and `TARGET_PERSON_IDS` left blank), the app ingests every face detection UniFi Protect sends — all named people from your Face Library plus unrecognized faces (`Unknown`). Use the **Person** dropdown on the Calendar and Events Log pages to filter the view to a single individual, or leave it on **All People** for the combined view.

Set `TARGET_PERSON_NAMES` and/or `TARGET_PERSON_IDS` only if you want to restrict which detections are stored at ingestion time (e.g. privacy or opt-in tracking for specific individuals). The UI dropdown always reflects whoever has been ingested into the database.

### Presence sessions

Sightings are grouped into sessions when consecutive detections for the same person fall within `PRESENCE_GAP_MINUTES` (default 20). Larger gaps start a new session. Daily observed presence is the sum of session durations (rounded up to 15 minutes per session total for display hours). The calendar shows **observed** hours; tooltips still include the first–last wall-clock span for comparison.

The **Today** page recomputes this live from `face_events` every request/poll. Historical months are materialized into `presence_sessions` when the calendar loads (`ensureReportsForMonth`) or via the nightly cron.

### Person profiles

Each detected identity has a stable `person_key` (`id:…` when UniFi provides a face ID, otherwise `name:…`). Open **People** in the nav or visit `/people/<urlencoded-person_key>` (example: `/people/id%3Aabc123`). Profiles show lifetime first/last seen, observed visit totals from presence sessions, median typical arrival/departure (90 days), top cameras, a 12-month heatmap, and recent thumbnails.

### Health diagnostics

Authenticated users can open **Health** (`/health`) for:

- Last webhook received and last normalized `face_events` timestamp
- Event/webhook volumes for the past hour and day
- Today’s KV counters: rejected auth, invalid JSON (parsing failures), duplicates, zero-face webhooks, D1 write failures
- Most recent cron report/cleanup timestamps (written by the scheduled worker)
- D1 row counts (byte size remains in the Cloudflare dashboard)
- Configuration warnings (missing secrets, empty allowlist, bad gap JSON)

Reject/duplicate counters start at zero after deploy and accumulate in KV per local calendar day (~40 day TTL).

---

## Deployment & Production Setup

### Secrets configuration
Set secrets on the live worker (do not commit these values):
```bash
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_API_KEY
npx wrangler secret put HONEYBADGER_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Create a project in the [Better Auth Infrastructure](https://www.better-auth.com/docs/infrastructure/getting-started) dashboard, copy its API key into `BETTER_AUTH_API_KEY`, and keep `BETTER_AUTH_SECRET` as a separate random signing secret. The `dash()` plugin in this Worker uses the API key to connect hosted user management, sessions, analytics, and audit logs.

Set `HONEYBADGER_API_KEY` from your [Honeybadger](https://www.honeybadger.io/) project so uncaught and caught server errors (auth, webhook ingest, cron) are reported via `@honeybadger-io/cloudflare`.

`ALLOWED_EMAILS` is a Worker secret (set in GitHub Actions secrets and synced on deploy), not a `[vars]` entry.

`BETTER_AUTH_URL` defaults to `https://unifi-protect-assistant.mrcoffee.workers.dev` via `[vars]` in `wrangler.toml`.

### Production Migrations
Apply the migrations to the live Cloudflare production D1 instance:
```bash
npm run db:migrate:prod
```

### Manual Deploy
```bash
npm run deploy
```

---

## GitHub Actions Deployment (CI/CD)

This repository includes a GitHub Action to automatically deploy on push to the `main` branch. 

Add the following secrets to your GitHub Repository Settings (`Settings -> Secrets and variables -> Actions`). On every deploy to `main`, the workflow uploads the app secrets to the Cloudflare Worker (in addition to deploying `[vars]` from `wrangler.toml`):

| GitHub secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Workers, D1, KV) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `BETTER_AUTH_SECRET` | App signing secret (≥32 chars) |
| `BETTER_AUTH_API_KEY` | Better Auth Infrastructure API key (`ba_…`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated allowlisted Google emails |
| `HONEYBADGER_API_KEY` | Honeybadger project API key (error reporting) |

Optional: `WEBHOOK_SECRET` — set with `npx wrangler secret put WEBHOOK_SECRET` if you protect `POST /unifi` (not synced by CI unless you add it to the workflow and GitHub secrets).

You can also re-run **Deploy Worker** via `workflow_dispatch` to refresh Cloudflare secrets without a code change.

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

## Privacy & Security Disclaimer

The dashboard and JSON APIs (`/`, `/calendar`, `/events`, `/api/*`) require **Google OAuth** via [better-auth](https://www.better-auth.com/). Only emails listed in `ALLOWED_EMAILS` can sign up or use an active session.

`POST /unifi` remains separate: it uses the `X-Webhook-Secret` shared secret so UniFi Protect can post without a browser login.

While raw UniFi Protect payloads are not displayed publicly, authenticated users can see dates, times, camera IDs, detection thumbnails, and names of individuals detected by the system. Keep OAuth credentials and `ALLOWED_EMAILS` up to date.
