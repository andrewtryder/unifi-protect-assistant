-- Add base64 image support to webhook_notifications and face_events
ALTER TABLE webhook_notifications ADD COLUMN image_base64 TEXT;
ALTER TABLE face_events ADD COLUMN image_base64 TEXT;
