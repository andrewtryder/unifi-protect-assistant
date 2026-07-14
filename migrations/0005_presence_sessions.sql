-- Presence sessions (gap-based observed duration) + observed columns on daily reports

CREATE TABLE IF NOT EXISTS presence_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  duration_seconds REAL NOT NULL,
  rounded_duration_minutes INTEGER NOT NULL,
  sighting_count INTEGER NOT NULL,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  first_camera_id TEXT NOT NULL,
  last_camera_id TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 0,
  generated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_local_date_person
  ON presence_sessions(local_date, person_key);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_ended_at
  ON presence_sessions(ended_at_ms);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_person_started
  ON presence_sessions(person_key, started_at_ms);

ALTER TABLE daily_person_reports ADD COLUMN observed_span_seconds REAL;
ALTER TABLE daily_person_reports ADD COLUMN observed_rounded_minutes INTEGER;
ALTER TABLE daily_person_reports ADD COLUMN observed_rounded_hours REAL;
ALTER TABLE daily_person_reports ADD COLUMN session_count INTEGER;
