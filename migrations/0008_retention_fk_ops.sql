-- Retention FK redesign, ops counters, materialization freshness, delivery idempotency.
-- D1 keeps foreign_keys ON; use defer_foreign_keys for table rebuilds (not PRAGMA foreign_keys=off).

PRAGMA defer_foreign_keys = on;

-- ---------------------------------------------------------------------------
-- face_events: nullable notification_id + ON DELETE SET NULL
-- ---------------------------------------------------------------------------
CREATE TABLE face_events_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  notification_id TEXT CHECK (notification_id IS NULL OR length(notification_id) > 0),
  event_id TEXT NOT NULL UNIQUE CHECK (length(event_id) > 0),
  seen_at_ms INTEGER NOT NULL CHECK (seen_at_ms >= 0),
  local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  person_key TEXT NOT NULL CHECK (length(person_key) > 0),
  person_name TEXT NOT NULL,
  person_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  alarm_name TEXT NOT NULL,
  raw_trigger_json TEXT NOT NULL,
  image_base64 TEXT,
  FOREIGN KEY (notification_id) REFERENCES webhook_notifications(id) ON DELETE SET NULL
);

INSERT INTO face_events_new (
  id, notification_id, event_id, seen_at_ms, local_date,
  person_key, person_name, person_id, trigger_key, camera_id,
  alarm_name, raw_trigger_json, image_base64
)
SELECT
  id, notification_id, event_id, seen_at_ms, local_date,
  person_key, person_name, person_id, trigger_key, camera_id,
  alarm_name, raw_trigger_json, image_base64
FROM face_events;

DROP TABLE face_events;
ALTER TABLE face_events_new RENAME TO face_events;

CREATE INDEX IF NOT EXISTS idx_face_events_local_date ON face_events (local_date);
CREATE INDEX IF NOT EXISTS idx_face_events_person_key ON face_events (person_key);
CREATE INDEX IF NOT EXISTS idx_face_events_seen_at_ms ON face_events (seen_at_ms);
CREATE INDEX IF NOT EXISTS idx_face_events_notification_id ON face_events (notification_id);

-- ---------------------------------------------------------------------------
-- vehicle_events: nullable notification_id + ON DELETE SET NULL
-- ---------------------------------------------------------------------------
CREATE TABLE vehicle_events_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  notification_id TEXT CHECK (notification_id IS NULL OR length(notification_id) > 0),
  event_id TEXT NOT NULL UNIQUE CHECK (length(event_id) > 0),
  seen_at_ms INTEGER NOT NULL CHECK (seen_at_ms >= 0),
  local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  plate_key TEXT NOT NULL CHECK (length(plate_key) > 0),
  plate_text TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  alarm_name TEXT NOT NULL,
  raw_trigger_json TEXT NOT NULL,
  image_base64 TEXT,
  FOREIGN KEY (notification_id) REFERENCES webhook_notifications(id) ON DELETE SET NULL
);

INSERT INTO vehicle_events_new (
  id, notification_id, event_id, seen_at_ms, local_date,
  plate_key, plate_text, trigger_key, camera_id,
  alarm_name, raw_trigger_json, image_base64
)
SELECT
  id, notification_id, event_id, seen_at_ms, local_date,
  plate_key, plate_text, trigger_key, camera_id,
  alarm_name, raw_trigger_json, image_base64
FROM vehicle_events;

DROP TABLE vehicle_events;
ALTER TABLE vehicle_events_new RENAME TO vehicle_events;

CREATE INDEX IF NOT EXISTS idx_vehicle_events_date_plate ON vehicle_events (local_date, plate_key);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_seen_at ON vehicle_events (seen_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_notification_id ON vehicle_events (notification_id);

PRAGMA defer_foreign_keys = off;

-- ---------------------------------------------------------------------------
-- Webhook delivery idempotency key (privacy-safe; backfill existing rows with id)
-- ---------------------------------------------------------------------------
ALTER TABLE webhook_notifications ADD COLUMN delivery_key TEXT;
UPDATE webhook_notifications SET delivery_key = id WHERE delivery_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_notifications_delivery_key
  ON webhook_notifications (delivery_key);

-- Retention predicate indexes (standalone timestamps)
CREATE INDEX IF NOT EXISTS idx_daily_person_reports_first_seen
  ON daily_person_reports (first_seen_ms);
CREATE INDEX IF NOT EXISTS idx_presence_sessions_started_at
  ON presence_sessions (started_at_ms);

-- ---------------------------------------------------------------------------
-- Derived-report freshness tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materialization_state (
  local_date TEXT PRIMARY KEY NOT NULL
    CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_event_count INTEGER NOT NULL CHECK (source_event_count >= 0),
  max_seen_at_ms INTEGER NOT NULL CHECK (max_seen_at_ms >= 0),
  materializer_version INTEGER NOT NULL CHECK (materializer_version > 0),
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0)
);

-- ---------------------------------------------------------------------------
-- Atomic daily ops counters (replaces lossy KV RMW for exact counts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops_daily_counters (
  local_date TEXT NOT NULL
    CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  field TEXT NOT NULL CHECK (length(field) > 0),
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (local_date, field)
);

-- Soft CHECK on is_open for new writes: rebuild presence_sessions with constraint
PRAGMA defer_foreign_keys = on;

CREATE TABLE presence_sessions_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  local_date TEXT NOT NULL
    CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  person_key TEXT NOT NULL CHECK (length(person_key) > 0),
  person_name TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  ended_at_ms INTEGER NOT NULL CHECK (ended_at_ms >= 0),
  duration_seconds REAL NOT NULL CHECK (duration_seconds >= 0),
  rounded_duration_minutes INTEGER NOT NULL,
  sighting_count INTEGER NOT NULL CHECK (sighting_count >= 0),
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  first_camera_id TEXT NOT NULL,
  last_camera_id TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0)
);

INSERT INTO presence_sessions_new
SELECT
  id, local_date, person_key, person_name,
  started_at_ms, ended_at_ms, duration_seconds, rounded_duration_minutes,
  sighting_count, first_event_id, last_event_id,
  first_camera_id, last_camera_id,
  CASE WHEN is_open IN (0, 1) THEN is_open ELSE 0 END,
  generated_at_ms
FROM presence_sessions;

DROP TABLE presence_sessions;
ALTER TABLE presence_sessions_new RENAME TO presence_sessions;

CREATE INDEX IF NOT EXISTS idx_presence_sessions_local_date_person
  ON presence_sessions (local_date, person_key);
CREATE INDEX IF NOT EXISTS idx_presence_sessions_ended_at
  ON presence_sessions (ended_at_ms);
CREATE INDEX IF NOT EXISTS idx_presence_sessions_person_started
  ON presence_sessions (person_key, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_presence_sessions_started_at
  ON presence_sessions (started_at_ms);

PRAGMA defer_foreign_keys = off;
