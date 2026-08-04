# Database and retention

Normalized face and vehicle events live in Cloudflare D1. Operational counters and markers use KV. Bindings are configured in `wrangler.toml` (use your own D1/KV IDs).

## Presence and reports (people)

Sightings for the same person within `PRESENCE_GAP_MINUTES` (default 20) form a session. Daily **observed** presence is derived from those sessions. The **Today** page recomputes live from `face_events`. Historical days are materialized into `presence_sessions` and `daily_person_reports` (cron regenerates yesterday; calendar may refresh stale days).

Person identity uses a stable `person_key` (`id:…` when UniFi provides a face ID, otherwise `name:…`).

## Vehicles

Vehicle rows use `plate_key` (`plate:…` / `plate:unknown`). Directory, profile, day log, and Today vehicle rows read from `vehicle_events`. Visit/heatmap-style stats are computed on-read (no separate vehicle session/report tables).

## Retention (approximate)

| Data                                     | Retention | Behavior                                          |
| ---------------------------------------- | --------- | ------------------------------------------------- |
| Raw webhook payload / images             | ~30 days  | Scrubbed, then parent rows removed                |
| Face/vehicle raw trigger JSON + images   | ~30 days  | Scrubbed; normalized row kept until row retention |
| Face/vehicle event rows                  | ~365 days | Deleted                                           |
| Daily person reports / presence sessions | ~365 days | Deleted                                           |

After a parent webhook row is deleted, child `notification_id` values may be `NULL` (`ON DELETE SET NULL`).

Apply migrations locally with `npm run db:migrate:local` and remotely with `npm run db:migrate:prod` (back up production D1 first).
