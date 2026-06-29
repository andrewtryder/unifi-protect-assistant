-- Initial schema setup
CREATE TABLE IF NOT EXISTS webhook_notifications (
  id TEXT PRIMARY KEY,
  received_at_ms INTEGER NOT NULL,
  source_ip TEXT NOT NULL,
  event_id TEXT NOT NULL,
  alarm_name TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS face_events (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  seen_at_ms INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL,
  person_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  alarm_name TEXT NOT NULL,
  raw_trigger_json TEXT NOT NULL,
  FOREIGN KEY(notification_id) REFERENCES webhook_notifications(id)
);

CREATE TABLE IF NOT EXISTS daily_person_reports (
  local_date TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  raw_span_seconds REAL NOT NULL,
  rounded_span_minutes INTEGER NOT NULL,
  rounded_span_hours REAL NOT NULL,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  first_camera_id TEXT NOT NULL,
  last_camera_id TEXT NOT NULL,
  seen_count INTEGER NOT NULL,
  generated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (local_date, person_key)
);
