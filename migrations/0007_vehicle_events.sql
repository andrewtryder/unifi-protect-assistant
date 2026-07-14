-- License plate / vehicle detections from UniFi Protect webhooks
CREATE TABLE IF NOT EXISTS vehicle_events (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  seen_at_ms INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  plate_key TEXT NOT NULL,
  plate_text TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  alarm_name TEXT NOT NULL,
  raw_trigger_json TEXT NOT NULL,
  image_base64 TEXT,
  FOREIGN KEY(notification_id) REFERENCES webhook_notifications(id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_events_date_plate ON vehicle_events (local_date, plate_key);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_seen_at ON vehicle_events (seen_at_ms DESC);
