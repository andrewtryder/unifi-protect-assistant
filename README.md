# UniFi Protect Assistant

A lightweight, premium Cloudflare Workers app that ingests webhook notifications from UniFi Protect (specifically focusing on face/person detection), stores normalized events in Cloudflare D1, generates daily first-seen/last-seen reports via cron triggers, and displays a mobile-friendly read-only dashboard.

## Features

- **Webhook Ingestion (`POST /unifi`)**: Authenticated webhook processing with schema parsing safeguards.
- **Person Tracking**: By default, captures all known people from UniFi Protect's Face Library (`face_known`) plus unrecognized faces (`face_unknown`). Optional `TARGET_PERSON_NAMES` / `TARGET_PERSON_IDS` env vars restrict ingestion to specific individuals.
- **Person Filter Dropdown**: Calendar and Events Log views include a dropdown to filter by any detected person (or "All People").
- **Reporting**: Computes first-seen, last-seen, total time (rounded up to the nearest 15 minutes), and frequency counts.
- **Aesthetic UI**: A modern glassmorphism calendar and event log UI rendered server-side for rapid, responsive mobile and desktop viewing. Event thumbnails are shown when available.
- **Data Retention Policy**: Automated cleanup purging raw payloads after 30 days, and normalized events/reports after 365 days.

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
       │           ├─► Compute Yesterday's `daily_person_reports`
       │           └─► Purge expired records (30 days raw / 1 yr events & reports)
       │
       └─────────► Read-Only Web Interface (Google OAuth + ALLOWED_EMAILS)
                   ├─► GET /login (public)
                   ├─► GET / (Redirects to current month; auth required)
                   ├─► GET /calendar?month=YYYY-MM&person=Name
                   ├─► GET /events?date=YYYY-MM-DD&person=Name
                   ├─► GET /api/auth/* (better-auth)
                   ├─► GET /api/people
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
BETTER_AUTH_SECRET=generate_a_long_random_secret_at_least_32_chars
# Optional: Better Auth Infrastructure API key (also used as secret fallback if BETTER_AUTH_SECRET unset)
BETTER_AUTH_API_KEY=ba_...
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

---

## Deployment & Production Setup

### Secrets configuration
Set secrets on the live worker (do not commit these values):
```bash
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Set the allowlist (plain Worker var is fine):
```bash
npx wrangler secret put ALLOWED_EMAILS
# or edit ALLOWED_EMAILS under [vars] in wrangler.toml
```

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

Add the following secrets to your GitHub Repository Settings (`Settings -> Secrets and variables -> Actions`):
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API Token (needs permissions for Workers, D1, and KV).
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.

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
