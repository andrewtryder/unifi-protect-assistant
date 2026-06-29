-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_face_events_local_date ON face_events (local_date);
CREATE INDEX IF NOT EXISTS idx_face_events_person_key ON face_events (person_key);
CREATE INDEX IF NOT EXISTS idx_face_events_seen_at_ms ON face_events (seen_at_ms);
