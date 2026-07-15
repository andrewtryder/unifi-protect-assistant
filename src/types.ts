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
  /** Honeybadger project API key for Worker error reporting */
  HONEYBADGER_API_KEY?: string;
  /** Default gap minutes between sightings before a new presence session (default 20) */
  PRESENCE_GAP_MINUTES?: string;
  /** JSON map of person_key → gap minutes */
  PRESENCE_GAP_BY_PERSON?: string;
  /** JSON map of camera_id → gap minutes */
  PRESENCE_GAP_BY_CAMERA?: string;
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

export interface VehicleEvent {
  id: string;
  notification_id: string;
  event_id: string;
  seen_at_ms: number;
  local_date: string; // YYYY-MM-DD
  /** Normalized plate identity: plate:ABC123 or plate:unknown */
  plate_key: string;
  /** Raw plate text from trigger.value (may be empty on test fires) */
  plate_text: string;
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
  /** First-to-last wall-clock span (can overstate presence) */
  raw_span_seconds: number;
  rounded_span_minutes: number;
  rounded_span_hours: number;
  first_event_id: string;
  last_event_id: string;
  first_camera_id: string;
  last_camera_id: string;
  seen_count: number;
  generated_at_ms: number;
  /** Sum of presence session durations (accurate observed presence) */
  observed_span_seconds?: number | null;
  observed_rounded_minutes?: number | null;
  observed_rounded_hours?: number | null;
  session_count?: number | null;
}

export interface PresenceSession {
  id: string;
  local_date: string;
  person_key: string;
  person_name: string;
  started_at_ms: number;
  ended_at_ms: number;
  duration_seconds: number;
  rounded_duration_minutes: number;
  sighting_count: number;
  first_event_id: string;
  last_event_id: string;
  first_camera_id: string;
  last_camera_id: string;
  is_open: number; // 0 | 1
  generated_at_ms: number;
}

export interface TodayPersonRow {
  person_key: string;
  person_name: string;
  status: "present" | "away";
  first_seen_ms: number;
  last_seen_ms: number;
  last_camera_id: string;
  observed_span_seconds: number;
  observed_rounded_minutes: number;
  observed_rounded_hours: number;
  session_count: number;
  sighting_count: number;
}

export interface TodayStreamEvent {
  event_id: string;
  seen_at_ms: number;
  person_name: string;
  camera_id: string;
  trigger_key: string;
  image_base64?: string;
}

export interface TodaySnapshot {
  local_date: string;
  generated_at_ms: number;
  present_count: number;
  seen_today_count: number;
  unknown_face_count: number;
  events_last_hour: number;
  webhook: {
    last_received_at_ms: number | null;
    count_last_hour: number;
    healthy: boolean;
  };
  people: TodayPersonRow[];
  recent_events: TodayStreamEvent[];
}

export interface PersonSummary {
  person_name: string;
  last_seen_ms: number;
  event_count: number;
}

export interface PersonDirectoryEntry {
  person_key: string;
  person_name: string;
  person_id: string;
  first_seen_ms: number;
  last_seen_ms: number;
  event_count: number;
}

export interface PersonCameraStat {
  camera_id: string;
  event_count: number;
}

export interface PersonHeatmapDay {
  local_date: string;
  observed_span_seconds: number;
  observed_rounded_hours: number;
  session_count: number;
}

export interface PersonProfile {
  person_key: string;
  person_name: string;
  person_id: string;
  first_seen_ms: number;
  last_seen_ms: number;
  event_count: number;
  visit_count: number;
  observed_span_seconds: number;
  observed_rounded_hours: number;
  /** Minutes from local midnight, or null if insufficient data */
  typical_arrival_minutes: number | null;
  typical_departure_minutes: number | null;
  typical_arrival_label: string | null;
  typical_departure_label: string | null;
  cameras: PersonCameraStat[];
  heatmap: PersonHeatmapDay[];
  recent_events: FaceEvent[];
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

export interface HealthDbUsage {
  webhook_notifications: number;
  face_events: number;
  vehicle_events: number;
  daily_person_reports: number;
  presence_sessions: number;
}

export interface HealthSnapshot {
  generated_at_ms: number;
  local_date: string;
  last_webhook_at_ms: number | null;
  last_event_at_ms: number | null;
  webhook_healthy: boolean;
  events_last_hour: number;
  events_last_day: number;
  webhooks_last_hour: number;
  webhooks_last_day: number;
  today_counters: {
    rejected_auth: number;
    rejected_json: number;
    ingested_webhooks: number;
    events_attempted: number;
    events_inserted: number;
    duplicates: number;
    vehicles_attempted: number;
    vehicles_inserted: number;
    vehicle_duplicates: number;
    zero_face_webhooks: number;
    d1_failures: number;
  };
  last_cron_report_at_ms: number | null;
  last_cron_report_date: string | null;
  last_cleanup_at_ms: number | null;
  last_cleanup_summary: Record<string, number> | null;
  last_d1_error_at_ms: number | null;
  last_d1_error: string | null;
  last_cron_error: { at_ms: number; message: string } | null;
  db_usage: HealthDbUsage;
  config_warnings: string[];
}
