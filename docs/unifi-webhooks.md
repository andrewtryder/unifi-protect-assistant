# UniFi Protect webhooks

## Alarm setup

In Protect **Alarm Manager**:

1. Create alarms for the face and/or license-plate detections you want stored.
2. Add a **Webhook** notification.
3. Method: `POST`
4. URL: `https://<your-worker>.workers.dev/unifi`
5. Header: `X-Webhook-Secret: <your WEBHOOK_SECRET>`

What the app stores depends on which triggers Protect sends. Leave `TARGET_PERSON_*` / `WATCH_CAMERA_IDS` empty to accept all matching detections the Worker is configured to ingest; set them only to restrict at ingest time.

### Vehicles

License-plate ingestion is gated by `ENABLE_VEHICLE_EVENTS=true`. Prefer Protect alarms that send only the plate subset you care about. Plate text is treated as sensitive and must not appear in logs or error reports.

### Thumbnails

If Protect includes image data on a trigger, the Worker can store it for dashboard thumbnails. Configure Protect according to your privacy preference.

## Response status (Worker)

| Status | Typical meaning                                                                |
| ------ | ------------------------------------------------------------------------------ |
| `200`  | Accepted (including idempotent duplicates)                                     |
| `400`  | Invalid JSON / timestamps (generic message)                                    |
| `401`  | Wrong or missing webhook secret (when secret is configured)                    |
| `413`  | Body too large                                                                 |
| `503`  | Missing `WEBHOOK_SECRET` without insecure opt-in, or retriable storage failure |

Exact duplicate deliveries are deduplicated with a privacy-safe delivery key; child events dedupe by `event_id`.

## Public readiness

`GET /ready` is intended to stay reachable without Access. It checks D1 connectivity and required schema without exposing counts, config, or PII.
