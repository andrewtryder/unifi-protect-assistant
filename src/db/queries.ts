import {
  Env,
  DailyReport,
  FaceEvent,
  PersonSummary,
  PresenceSession,
  PersonDirectoryEntry,
  PersonCameraStat,
  PersonHeatmapDay,
  PersonProfile,
} from "../types.js";
import { getLocalDate } from "../webhook/parser.js";
import {
  formatMinutesAsTime,
  localDateDaysAgo,
  typicalArrivalDeparture,
} from "../reporting/profileStats.js";
import { roundToNearest15Mins } from "../reporting/round.js";

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
 * Returns distinct people seen on a specific local date.
 */
export async function getDistinctPeopleForDate(
  env: Env,
  dateStr: string
): Promise<PersonSummary[]> {
  const query = `
    SELECT MIN(person_name) AS person_name,
           MAX(seen_at_ms) AS last_seen_ms,
           COUNT(*) AS event_count
    FROM face_events
    WHERE local_date = ?
    GROUP BY LOWER(person_name)
    ORDER BY person_name ASC
  `;
  const { results } = await env.DB.prepare(query).bind(dateStr).all<PersonSummary>();
  return results || [];
}

/**
 * Returns distinct people seen in a given YYYY-MM month.
 */
export async function getDistinctPeopleForMonth(
  env: Env,
  monthStr: string
): Promise<PersonSummary[]> {
  const query = `
    SELECT MIN(person_name) AS person_name,
           MAX(seen_at_ms) AS last_seen_ms,
           COUNT(*) AS event_count
    FROM face_events
    WHERE local_date LIKE ?
    GROUP BY LOWER(person_name)
    ORDER BY person_name ASC
  `;
  const { results } = await env.DB.prepare(query).bind(`${monthStr}%`).all<PersonSummary>();
  return results || [];
}

/**
 * Returns distinct local_date values that have face_events in a YYYY-MM month.
 */
export async function getDistinctDatesForMonth(env: Env, monthStr: string): Promise<string[]> {
  const query = `
    SELECT DISTINCT local_date
    FROM face_events
    WHERE local_date LIKE ?
    ORDER BY local_date ASC
  `;
  const { results } = await env.DB.prepare(query)
    .bind(`${monthStr}%`)
    .all<{ local_date: string }>();
  return (results || []).map((r) => r.local_date);
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

  const { results } = await env.DB.prepare(query)
    .bind(...bindings)
    .all<DailyReport>();
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

  const { results } = await env.DB.prepare(query)
    .bind(...bindings)
    .all<FaceEvent>();
  return results || [];
}

/**
 * Face events with seen_at_ms >= sinceMs.
 */
export async function getEventsSince(env: Env, sinceMs: number): Promise<FaceEvent[]> {
  const query = `
    SELECT id, notification_id, event_id, seen_at_ms, local_date,
           person_key, person_name, person_id, trigger_key, camera_id, alarm_name,
           image_base64
    FROM face_events
    WHERE seen_at_ms >= ?
    ORDER BY seen_at_ms DESC
  `;
  const { results } = await env.DB.prepare(query).bind(sinceMs).all<FaceEvent>();
  return results || [];
}

/**
 * Webhook ingestion health: last received timestamp and count since sinceMs.
 */
export async function getWebhookHealth(
  env: Env,
  sinceMs: number
): Promise<{ last_received_at_ms: number | null; count_last_hour: number }> {
  const lastRow = await env.DB.prepare(
    `
    SELECT MAX(received_at_ms) AS last_received_at_ms
    FROM webhook_notifications
  `
  ).first<{ last_received_at_ms: number | null }>();

  const countRow = await env.DB.prepare(
    `
    SELECT COUNT(*) AS cnt
    FROM webhook_notifications
    WHERE received_at_ms >= ?
  `
  )
    .bind(sinceMs)
    .first<{ cnt: number }>();

  return {
    last_received_at_ms: lastRow?.last_received_at_ms ?? null,
    count_last_hour: countRow?.cnt ?? 0,
  };
}

/**
 * Sessions for a local date, optional person filter.
 */
export async function getSessionsForDate(
  env: Env,
  dateStr: string,
  personName?: string
): Promise<PresenceSession[]> {
  let query = `
    SELECT * FROM presence_sessions
    WHERE local_date = ?
  `;
  const bindings: string[] = [dateStr];

  if (personName) {
    query += ` AND LOWER(person_name) = LOWER(?)`;
    bindings.push(personName);
  }

  query += ` ORDER BY started_at_ms ASC`;

  const { results } = await env.DB.prepare(query)
    .bind(...bindings)
    .all<PresenceSession>();
  return results || [];
}

/**
 * Replace all presence_sessions for a local_date with the provided rows.
 * Prefer replaceDerivedForDate for atomic session+report updates.
 */
export async function replaceSessionsForDate(
  env: Env,
  localDate: string,
  sessions: PresenceSession[]
): Promise<void> {
  await env.DB.prepare(`DELETE FROM presence_sessions WHERE local_date = ?`).bind(localDate).run();

  if (sessions.length === 0) return;

  const stmts = sessions.map((s) =>
    env.DB.prepare(
      `
      INSERT INTO presence_sessions (
        id, local_date, person_key, person_name,
        started_at_ms, ended_at_ms, duration_seconds, rounded_duration_minutes,
        sighting_count, first_event_id, last_event_id,
        first_camera_id, last_camera_id, is_open, generated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).bind(
      s.id,
      s.local_date,
      s.person_key,
      s.person_name,
      s.started_at_ms,
      s.ended_at_ms,
      s.duration_seconds,
      s.rounded_duration_minutes,
      s.sighting_count,
      s.first_event_id,
      s.last_event_id,
      s.first_camera_id,
      s.last_camera_id,
      s.is_open,
      s.generated_at_ms
    )
  );

  await env.DB.batch(stmts);
}

/**
 * Atomically replace derived sessions + daily reports for one local date,
 * and upsert materialization_state. Leaves both tables empty when inputs are empty.
 */
export async function replaceDerivedForDate(
  env: Env,
  localDate: string,
  sessions: PresenceSession[],
  reports: DailyReport[],
  state: {
    source_event_count: number;
    max_seen_at_ms: number;
    materializer_version: number;
    generated_at_ms: number;
  }
): Promise<void> {
  const stmts = [
    env.DB.prepare(`DELETE FROM presence_sessions WHERE local_date = ?`).bind(localDate),
    env.DB.prepare(`DELETE FROM daily_person_reports WHERE local_date = ?`).bind(localDate),
  ];

  for (const s of sessions) {
    stmts.push(
      env.DB.prepare(
        `
        INSERT INTO presence_sessions (
          id, local_date, person_key, person_name,
          started_at_ms, ended_at_ms, duration_seconds, rounded_duration_minutes,
          sighting_count, first_event_id, last_event_id,
          first_camera_id, last_camera_id, is_open, generated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).bind(
        s.id,
        s.local_date,
        s.person_key,
        s.person_name,
        s.started_at_ms,
        s.ended_at_ms,
        s.duration_seconds,
        s.rounded_duration_minutes,
        s.sighting_count,
        s.first_event_id,
        s.last_event_id,
        s.first_camera_id,
        s.last_camera_id,
        s.is_open,
        s.generated_at_ms
      )
    );
  }

  for (const report of reports) {
    stmts.push(
      env.DB.prepare(
        `
        INSERT INTO daily_person_reports (
          local_date, person_key, person_name, first_seen_ms, last_seen_ms,
          raw_span_seconds, rounded_span_minutes, rounded_span_hours,
          first_event_id, last_event_id, first_camera_id, last_camera_id,
          seen_count, generated_at_ms,
          observed_span_seconds, observed_rounded_minutes, observed_rounded_hours,
          session_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).bind(
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
        report.generated_at_ms,
        report.observed_span_seconds ?? null,
        report.observed_rounded_minutes ?? null,
        report.observed_rounded_hours ?? null,
        report.session_count ?? null
      )
    );
  }

  stmts.push(
    env.DB.prepare(
      `
      INSERT INTO materialization_state (
        local_date, source_event_count, max_seen_at_ms, materializer_version, generated_at_ms
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(local_date) DO UPDATE SET
        source_event_count = excluded.source_event_count,
        max_seen_at_ms = excluded.max_seen_at_ms,
        materializer_version = excluded.materializer_version,
        generated_at_ms = excluded.generated_at_ms
    `
    ).bind(
      localDate,
      state.source_event_count,
      state.max_seen_at_ms,
      state.materializer_version,
      state.generated_at_ms
    )
  );

  await env.DB.batch(stmts);
}

export async function getMaterializationState(
  env: Env,
  localDate: string
): Promise<{
  local_date: string;
  source_event_count: number;
  max_seen_at_ms: number;
  materializer_version: number;
  generated_at_ms: number;
} | null> {
  return (
    (await env.DB.prepare(
      `
      SELECT local_date, source_event_count, max_seen_at_ms, materializer_version, generated_at_ms
      FROM materialization_state
      WHERE local_date = ?
    `
    )
      .bind(localDate)
      .first()) ?? null
  );
}

export async function getFaceEventFreshness(
  env: Env,
  localDate: string
): Promise<{ count: number; max_seen_at_ms: number }> {
  const row = await env.DB.prepare(
    `
    SELECT COUNT(*) AS count, COALESCE(MAX(seen_at_ms), 0) AS max_seen_at_ms
    FROM face_events
    WHERE local_date = ?
  `
  )
    .bind(localDate)
    .first<{ count: number; max_seen_at_ms: number }>();
  return { count: row?.count ?? 0, max_seen_at_ms: row?.max_seen_at_ms ?? 0 };
}

/**
 * Inserts or updates a daily report record (ON CONFLICT DO UPDATE).
 * Prefer replaceDerivedForDate for full-date atomic replacement.
 */
export async function upsertDailyReport(env: Env, report: DailyReport): Promise<void> {
  const query = `
    INSERT INTO daily_person_reports (
      local_date, person_key, person_name, first_seen_ms, last_seen_ms,
      raw_span_seconds, rounded_span_minutes, rounded_span_hours,
      first_event_id, last_event_id, first_camera_id, last_camera_id,
      seen_count, generated_at_ms,
      observed_span_seconds, observed_rounded_minutes, observed_rounded_hours,
      session_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_date, person_key) DO UPDATE SET
      person_name = excluded.person_name,
      first_seen_ms = excluded.first_seen_ms,
      last_seen_ms = excluded.last_seen_ms,
      raw_span_seconds = excluded.raw_span_seconds,
      rounded_span_minutes = excluded.rounded_span_minutes,
      rounded_span_hours = excluded.rounded_span_hours,
      first_event_id = excluded.first_event_id,
      last_event_id = excluded.last_event_id,
      first_camera_id = excluded.first_camera_id,
      last_camera_id = excluded.last_camera_id,
      seen_count = excluded.seen_count,
      generated_at_ms = excluded.generated_at_ms,
      observed_span_seconds = excluded.observed_span_seconds,
      observed_rounded_minutes = excluded.observed_rounded_minutes,
      observed_rounded_hours = excluded.observed_rounded_hours,
      session_count = excluded.session_count
  `;
  await env.DB.prepare(query)
    .bind(
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
      report.generated_at_ms,
      report.observed_span_seconds ?? null,
      report.observed_rounded_minutes ?? null,
      report.observed_rounded_hours ?? null,
      report.session_count ?? null
    )
    .run();
}

/**
 * People directory grouped by stable person_key.
 */
export async function getPeopleDirectory(env: Env): Promise<PersonDirectoryEntry[]> {
  const query = `
    SELECT person_key,
           MAX(person_name) AS person_name,
           MAX(person_id) AS person_id,
           MIN(seen_at_ms) AS first_seen_ms,
           MAX(seen_at_ms) AS last_seen_ms,
           COUNT(*) AS event_count
    FROM face_events
    GROUP BY person_key
    ORDER BY MAX(person_name) ASC
  `;
  const { results } = await env.DB.prepare(query).all<PersonDirectoryEntry>();
  return results || [];
}

/**
 * Full person profile for a stable person_key, or null if unknown.
 */
export async function getPersonProfile(env: Env, personKey: string): Promise<PersonProfile | null> {
  const timezone = env.TIMEZONE || "America/New_York";
  const identity = await env.DB.prepare(
    `
    SELECT person_key,
           MAX(person_name) AS person_name,
           MAX(person_id) AS person_id,
           MIN(seen_at_ms) AS first_seen_ms,
           MAX(seen_at_ms) AS last_seen_ms,
           COUNT(*) AS event_count
    FROM face_events
    WHERE person_key = ?
    GROUP BY person_key
  `
  )
    .bind(personKey)
    .first<{
      person_key: string;
      person_name: string;
      person_id: string;
      first_seen_ms: number;
      last_seen_ms: number;
      event_count: number;
    }>();

  if (!identity) return null;

  const today = getLocalDate(Date.now(), timezone);
  const since90 = localDateDaysAgo(today, 90);
  const since365 = localDateDaysAgo(today, 365);

  const sessionTotals = await env.DB.prepare(
    `
    SELECT COUNT(*) AS visit_count,
           COALESCE(SUM(duration_seconds), 0) AS observed_span_seconds
    FROM presence_sessions
    WHERE person_key = ?
  `
  )
    .bind(personKey)
    .first<{ visit_count: number; observed_span_seconds: number }>();

  const visit_count = sessionTotals?.visit_count ?? 0;
  const observed_span_seconds = sessionTotals?.observed_span_seconds ?? 0;
  const { roundedHours } = roundToNearest15Mins(observed_span_seconds * 1000);

  // Per-day first session start / last session end for typical times (90d)
  const sessionDays = await env.DB.prepare(
    `
    SELECT local_date,
           MIN(started_at_ms) AS started_at_ms,
           MAX(ended_at_ms) AS ended_at_ms
    FROM presence_sessions
    WHERE person_key = ? AND local_date >= ?
    GROUP BY local_date
  `
  )
    .bind(personKey, since90)
    .all<{
      local_date: string;
      started_at_ms: number;
      ended_at_ms: number;
    }>();

  let dayWindows = sessionDays.results || [];

  if (dayWindows.length === 0) {
    const reportDays = await env.DB.prepare(
      `
      SELECT local_date, first_seen_ms AS started_at_ms, last_seen_ms AS ended_at_ms
      FROM daily_person_reports
      WHERE person_key = ? AND local_date >= ?
    `
    )
      .bind(personKey, since90)
      .all<{
        local_date: string;
        started_at_ms: number;
        ended_at_ms: number;
      }>();
    dayWindows = reportDays.results || [];
  }

  const { arrivalMinutes, departureMinutes } = typicalArrivalDeparture(dayWindows, timezone);

  const camerasResult = await env.DB.prepare(
    `
    SELECT camera_id, COUNT(*) AS event_count
    FROM face_events
    WHERE person_key = ?
    GROUP BY camera_id
    ORDER BY event_count DESC
    LIMIT 10
  `
  )
    .bind(personKey)
    .all<PersonCameraStat>();

  // Heatmap: prefer daily reports observed span; else sum sessions
  const reportHeat = await env.DB.prepare(
    `
    SELECT local_date,
           COALESCE(observed_span_seconds, raw_span_seconds, 0) AS observed_span_seconds,
           COALESCE(observed_rounded_hours, rounded_span_hours, 0) AS observed_rounded_hours,
           COALESCE(session_count, 1) AS session_count
    FROM daily_person_reports
    WHERE person_key = ? AND local_date >= ?
    ORDER BY local_date ASC
  `
  )
    .bind(personKey, since365)
    .all<PersonHeatmapDay>();

  let heatmap: PersonHeatmapDay[] = reportHeat.results || [];

  if (heatmap.length === 0) {
    const sessionHeat = await env.DB.prepare(
      `
      SELECT local_date,
             SUM(duration_seconds) AS observed_span_seconds,
             COUNT(*) AS session_count
      FROM presence_sessions
      WHERE person_key = ? AND local_date >= ?
      GROUP BY local_date
      ORDER BY local_date ASC
    `
    )
      .bind(personKey, since365)
      .all<{
        local_date: string;
        observed_span_seconds: number;
        session_count: number;
      }>();
    heatmap = (sessionHeat.results || []).map((row) => {
      const { roundedHours: h } = roundToNearest15Mins(row.observed_span_seconds * 1000);
      return {
        local_date: row.local_date,
        observed_span_seconds: row.observed_span_seconds,
        observed_rounded_hours: h,
        session_count: row.session_count,
      };
    });
  }

  const recent = await env.DB.prepare(
    `
    SELECT id, notification_id, event_id, seen_at_ms, local_date,
           person_key, person_name, person_id, trigger_key, camera_id, alarm_name,
           image_base64
    FROM face_events
    WHERE person_key = ?
    ORDER BY seen_at_ms DESC
    LIMIT 24
  `
  )
    .bind(personKey)
    .all<FaceEvent>();

  return {
    person_key: identity.person_key,
    person_name: identity.person_name,
    person_id: identity.person_id || "",
    first_seen_ms: identity.first_seen_ms,
    last_seen_ms: identity.last_seen_ms,
    event_count: identity.event_count,
    visit_count,
    observed_span_seconds,
    observed_rounded_hours: roundedHours,
    typical_arrival_minutes: arrivalMinutes,
    typical_departure_minutes: departureMinutes,
    typical_arrival_label: formatMinutesAsTime(arrivalMinutes),
    typical_departure_label: formatMinutesAsTime(departureMinutes),
    cameras: camerasResult.results || [],
    heatmap,
    recent_events: recent.results || [],
  };
}

/**
 * Traffic + row-count facts for the health/diagnostics page.
 */
export async function getHealthDbFacts(
  env: Env,
  nowMs: number = Date.now()
): Promise<{
  last_webhook_at_ms: number | null;
  last_event_at_ms: number | null;
  events_last_hour: number;
  events_last_day: number;
  webhooks_last_hour: number;
  webhooks_last_day: number;
  db_usage: {
    webhook_notifications: number;
    face_events: number;
    vehicle_events: number;
    daily_person_reports: number;
    presence_sessions: number;
  };
}> {
  const hourAgo = nowMs - 60 * 60 * 1000;
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;

  const [
    lastWebhook,
    lastEvent,
    eventsHour,
    eventsDay,
    webhooksHour,
    webhooksDay,
    countWebhooks,
    countEvents,
    countVehicles,
    countReports,
    countSessions,
  ] = await Promise.all([
    env.DB.prepare(`SELECT MAX(received_at_ms) AS v FROM webhook_notifications`).first<{
      v: number | null;
    }>(),
    env.DB.prepare(`SELECT MAX(seen_at_ms) AS v FROM face_events`).first<{ v: number | null }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM face_events WHERE seen_at_ms >= ?`)
      .bind(hourAgo)
      .first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM face_events WHERE seen_at_ms >= ?`)
      .bind(dayAgo)
      .first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM webhook_notifications WHERE received_at_ms >= ?`)
      .bind(hourAgo)
      .first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM webhook_notifications WHERE received_at_ms >= ?`)
      .bind(dayAgo)
      .first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM webhook_notifications`).first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM face_events`).first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM vehicle_events`).first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM daily_person_reports`).first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM presence_sessions`).first<{ c: number }>(),
  ]);

  return {
    last_webhook_at_ms: lastWebhook?.v ?? null,
    last_event_at_ms: lastEvent?.v ?? null,
    events_last_hour: eventsHour?.c ?? 0,
    events_last_day: eventsDay?.c ?? 0,
    webhooks_last_hour: webhooksHour?.c ?? 0,
    webhooks_last_day: webhooksDay?.c ?? 0,
    db_usage: {
      webhook_notifications: countWebhooks?.c ?? 0,
      face_events: countEvents?.c ?? 0,
      vehicle_events: countVehicles?.c ?? 0,
      daily_person_reports: countReports?.c ?? 0,
      presence_sessions: countSessions?.c ?? 0,
    },
  };
}
