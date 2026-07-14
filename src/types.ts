export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  WEBHOOK_SECRET?: string;
  TIMEZONE?: string;
  TARGET_PERSON_NAMES?: string;
  TARGET_PERSON_IDS?: string;
  WATCH_CAMERA_IDS?: string;
  /** Comma-separated Google emails allowed to access the dashboard */
  ALLOWED_EMAILS?: string;
  BETTER_AUTH_SECRET?: string;
  /** Better Auth Infrastructure API key; also used as signing secret fallback */
  BETTER_AUTH_API_KEY?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
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
  image?: string;
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
  image?: string;
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
  image_base64?: string;
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

export interface PersonSummary {
  person_name: string;
  last_seen_ms: number;
  event_count: number;
}

export interface WebhookNotification {
  id: string;
  received_at_ms: number;
  source_ip: string;
  event_id: string;
  alarm_name: string;
  payload_json: string;
  image_base64?: string;
}
