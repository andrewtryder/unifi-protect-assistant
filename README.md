# UniFi Protect Assistant

A lightweight, premium Cloudflare Workers app that ingests webhook notifications from UniFi Protect (specifically focusing on face/person detection), stores normalized events in Cloudflare D1, generates daily first-seen/last-seen reports via cron triggers, and displays a mobile-friendly read-only dashboard.

## Features

- **Webhook Ingestion (`POST /unifi`)**: Authenticated webhook processing with schema parsing safeguards.
- **Filtering**: Target specifically configured person names and face IDs, or capture all detections if no filter is set.
- **Reporting**: Computes first-seen, last-seen, total time (rounded up to the nearest 15 minutes), and frequency counts.
- **Aesthetic UI**: A modern glassmorphism calendar and event log UI rendered server-side for rapid, responsive mobile and desktop viewing.
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
       └─────────► Read-Only Web Interface
                   ├─► GET / (Redirects to current month)
                   ├─► GET /calendar?month=YYYY-MM (Month View Grid)
                   └─► GET /events?date=YYYY-MM-DD (Detailed Day Logs)
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
compatibility_date = "2024-05-29"

[vars]
TIMEZONE = "America/New_York"
TARGET_PERSON_NAMES = "John Doe, Jane Smith"
TARGET_PERSON_IDS = "unifi-face-id-1, unifi-face-id-2"
WATCH_CAMERA_IDS = "" # Optional list to narrow down cameras

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
```

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

---

## Deployment & Production Setup

### Secrets configuration
Set your webhook verification secret on the live worker:
```bash
npx wrangler secret put WEBHOOK_SECRET
```

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

This dashboard serves a **read-only UI with NO authentication**. Anyone visiting the worker URL can view the calendar and the daily log tables.
While raw UniFi Protect payloads (including original NVR event metadata paths and raw trigger contexts) are not displayed publicly, the UI exposes the dates, times, camera IDs, and names of individuals detected by the system.
Please ensure the deployment URL is kept private, or deploy behind Cloudflare Access if strict authentication is required.
