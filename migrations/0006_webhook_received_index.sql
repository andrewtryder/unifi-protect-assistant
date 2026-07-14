CREATE INDEX IF NOT EXISTS idx_webhook_notifications_received_at
  ON webhook_notifications(received_at_ms);
