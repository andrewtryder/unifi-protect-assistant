export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  WEBHOOK_SECRET?: string;
  TIMEZONE?: string;
  TARGET_PERSON_NAMES?: string;
  TARGET_PERSON_IDS?: string;
  WATCH_CAMERA_IDS?: string;
}

export interface UnifiTrigger {
  device: string; // camera ID
  value: string;  // e.g., "Example Person" (person_name)
  key: string;    // e.g., "face_known" (trigger_key)
  group?: {
    name: string;
  };
  eventId: string;
  timestamp: number;
}

export interface UnifiAlarm {
  name: string;
  conditions: Array<{
    condition: {
      type: string;
      source: string;
      value: string; // e.g. "example-person-id"
    }
  }>;
  triggers: UnifiTrigger[];
  eventPath: string;
}

export interface UnifiWebhookPayload {
  alarm: UnifiAlarm;
  timestamp: number;
}

export interface FaceEvent {
  id: string;
  notification_id: string;
  event_id: string;
  seen_at_ms: number;
  local_date: string; // YYYY-MM-DD
  person_key: string; // name or ID normalized
  person_name: string;
  person_id: string;
  trigger_key: string;
  camera_id: string;
  alarm_name: string;
  raw_trigger_json: string;
}

export interface DailyReport {
  local_date: string;
  person_key: string;
  person_name: string;
  first_seen_ms: number;
  last_seen_ms: number;
  raw_span_seconds: number;
  rounded_span_minutes: number;
  rounded_span_hours: number;
  first_event_id: string;
  last_event_id: string;
  first_camera_id: string;
  last_camera_id: string;
  seen_count: number;
  generated_at_ms: number;
}

export interface WebhookNotification {
  id: string;
  received_at_ms: number;
  source_ip: string;
  event_id: string;
  alarm_name: string;
  payload_json: string;
}
