import { Env, DailyReport, FaceEvent, PersonSummary } from "../types.js";

/**
 * Returns distinct people seen in face_events, grouped case-insensitively by name.
 */
export async function getDistinctPeople(env: Env): Promise<PersonSummary[]> {
  const query = `
    SELECT MIN(person_name) AS person_name,
           MAX(seen_at_ms) AS last_seen_ms,
           COUNT(*) AS event_count
    FROM face_events
    GROUP BY LOWER(person_name)
    ORDER BY person_name ASC
  `;
  const { results } = await env.DB.prepare(query).all<PersonSummary>();
  return results || [];
}

/**
 * Executes a prepared query to get daily reports for a given month,
 * optionally filtered to a single person by name (case-insensitive).
 */
export async function getReportsForMonth(
  env: Env,
  monthStr: string,
  personName?: string
): Promise<DailyReport[]> {
  let query = `
    SELECT * FROM daily_person_reports
    WHERE local_date LIKE ?
  `;
  const bindings: string[] = [`${monthStr}%`];

  if (personName) {
    query += ` AND LOWER(person_name) = LOWER(?)`;
    bindings.push(personName);
  }

  query += ` ORDER BY local_date ASC, person_name ASC`;

  const { results } = await env.DB.prepare(query).bind(...bindings).all<DailyReport>();
  return results || [];
}

/**
 * Query face events for a specific local date,
 * optionally filtered to a single person by name (case-insensitive).
 */
export async function getEventsForDate(
  env: Env,
  dateStr: string,
  personName?: string
): Promise<FaceEvent[]> {
  let query = `
    SELECT id, notification_id, event_id, seen_at_ms, local_date,
           person_key, person_name, person_id, trigger_key, camera_id, alarm_name,
           image_base64
    FROM face_events
    WHERE local_date = ?
  `;
  const bindings: string[] = [dateStr];

  if (personName) {
    query += ` AND LOWER(person_name) = LOWER(?)`;
    bindings.push(personName);
  }

  query += ` ORDER BY seen_at_ms ASC`;

  const { results } = await env.DB.prepare(query).bind(...bindings).all<FaceEvent>();
  return results || [];
}

/**
 * Inserts or replaces a daily report record
 */
export async function upsertDailyReport(env: Env, report: DailyReport): Promise<void> {
  const query = `
    INSERT OR REPLACE INTO daily_person_reports (
      local_date, person_key, person_name, first_seen_ms, last_seen_ms,
      raw_span_seconds, rounded_span_minutes, rounded_span_hours,
      first_event_id, last_event_id, first_camera_id, last_camera_id,
      seen_count, generated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  await env.DB.prepare(query).bind(
    report.local_date,
    report.person_key,
    report.person_name,
    report.first_seen_ms,
    report.last_seen_ms,
    report.raw_span_seconds,
    report.rounded_span_minutes,
    report.rounded_span_hours,
    report.first_event_id,
    report.last_event_id,
    report.first_camera_id,
    report.last_camera_id,
    report.seen_count,
    report.generated_at_ms
  ).run();
}
