import { Env, DailyReport, FaceEvent } from "../types.js";
import {
  getDistinctDatesForMonth,
  getEventsForDate,
  replaceSessionsForDate,
  upsertDailyReport,
} from "../db/queries.js";
import { createGapResolver, draftsToPresenceSessions, sessionizeEvents } from "./sessions.js";
import { roundToNearest15Mins } from "./round.js";

export { roundToNearest15Mins } from "./round.js";

/**
 * Computes presence sessions and daily report for a given local date from face_events.
 * Idempotent: replaces sessions for the date and upserts daily_person_reports.
 */
export async function generateDailyReport(env: Env, localDate: string): Promise<void> {
  const events = await getEventsForDate(env, localDate);
  if (events.length === 0) {
    await replaceSessionsForDate(env, localDate, []);
    return;
  }

  const gapResolver = createGapResolver(env);
  const drafts = sessionizeEvents(events, gapResolver);
  const generatedAtMs = Date.now();
  const sessions = draftsToPresenceSessions(drafts, generatedAtMs);
  await replaceSessionsForDate(env, localDate, sessions);

  // Group events by person_key for first/last wall span
  const personGroups = new Map<string, FaceEvent[]>();
  for (const event of events) {
    const key = event.person_key;
    if (!personGroups.has(key)) {
      personGroups.set(key, []);
    }
    personGroups.get(key)!.push(event);
  }

  const sessionsByPerson = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const list = sessionsByPerson.get(session.person_key) || [];
    list.push(session);
    sessionsByPerson.set(session.person_key, list);
  }

  for (const [personKey, groupEvents] of personGroups.entries()) {
    groupEvents.sort((a, b) => a.seen_at_ms - b.seen_at_ms);

    const firstEvent = groupEvents[0];
    const lastEvent = groupEvents[groupEvents.length - 1];

    const firstSeenMs = firstEvent.seen_at_ms;
    const lastSeenMs = lastEvent.seen_at_ms;

    const rawSpanMs = lastSeenMs - firstSeenMs;
    const rawSpanSeconds = rawSpanMs / 1000;
    const { roundedMinutes, roundedHours } = roundToNearest15Mins(rawSpanMs);

    const personSessions = sessionsByPerson.get(personKey) || [];
    const observedSeconds = personSessions.reduce((sum, s) => sum + s.duration_seconds, 0);
    const observed = roundToNearest15Mins(observedSeconds * 1000);

    const report: DailyReport = {
      local_date: localDate,
      person_key: personKey,
      person_name: firstEvent.person_name,
      first_seen_ms: firstSeenMs,
      last_seen_ms: lastSeenMs,
      raw_span_seconds: rawSpanSeconds,
      rounded_span_minutes: roundedMinutes,
      rounded_span_hours: roundedHours,
      first_event_id: firstEvent.event_id,
      last_event_id: lastEvent.event_id,
      first_camera_id: firstEvent.camera_id,
      last_camera_id: lastEvent.camera_id,
      seen_count: groupEvents.length,
      generated_at_ms: generatedAtMs,
      observed_span_seconds: observedSeconds,
      observed_rounded_minutes: observed.roundedMinutes,
      observed_rounded_hours: observed.roundedHours,
      session_count: personSessions.length,
    };

    await upsertDailyReport(env, report);
  }
}

/**
 * Ensures daily_person_reports (and presence_sessions) exist for every local_date
 * in the month that has face_events.
 */
export async function ensureReportsForMonth(env: Env, monthStr: string): Promise<void> {
  const dates = await getDistinctDatesForMonth(env, monthStr);
  for (const localDate of dates) {
    await generateDailyReport(env, localDate);
  }
}
