import { Env, DailyReport, FaceEvent, PresenceSession } from "../types.js";
import {
  getDistinctDatesForMonth,
  getEventsForDate,
  getMaterializationState,
  getFaceEventFreshness,
  replaceDerivedForDate,
} from "../db/queries.js";
import { createGapResolver, draftsToPresenceSessions, sessionizeEvents } from "./sessions.js";
import { roundToNearest15Mins } from "./round.js";
import { MATERIALIZER_VERSION } from "../ops/constants.js";

export { roundToNearest15Mins } from "./round.js";

function buildReportsForDate(
  localDate: string,
  events: FaceEvent[],
  sessions: PresenceSession[],
  generatedAtMs: number
): DailyReport[] {
  if (events.length === 0) return [];

  const personGroups = new Map<string, FaceEvent[]>();
  for (const event of events) {
    const key = event.person_key;
    if (!personGroups.has(key)) personGroups.set(key, []);
    personGroups.get(key)!.push(event);
  }

  const sessionsByPerson = new Map<string, PresenceSession[]>();
  for (const session of sessions) {
    const list = sessionsByPerson.get(session.person_key) || [];
    list.push(session);
    sessionsByPerson.set(session.person_key, list);
  }

  const reports: DailyReport[] = [];
  for (const [personKey, groupEvents] of personGroups.entries()) {
    groupEvents.sort((a, b) => a.seen_at_ms - b.seen_at_ms);
    const firstEvent = groupEvents[0];
    const lastEvent = groupEvents[groupEvents.length - 1];
    const rawSpanMs = lastEvent.seen_at_ms - firstEvent.seen_at_ms;
    const { roundedMinutes, roundedHours } = roundToNearest15Mins(rawSpanMs);
    const personSessions = sessionsByPerson.get(personKey) || [];
    const observedSeconds = personSessions.reduce((sum, s) => sum + s.duration_seconds, 0);
    const observed = roundToNearest15Mins(observedSeconds * 1000);

    reports.push({
      local_date: localDate,
      person_key: personKey,
      person_name: firstEvent.person_name,
      first_seen_ms: firstEvent.seen_at_ms,
      last_seen_ms: lastEvent.seen_at_ms,
      raw_span_seconds: rawSpanMs / 1000,
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
    });
  }
  return reports;
}

/**
 * Atomically replaces presence_sessions + daily_person_reports for a local date
 * with an exact snapshot of current face_events (empty when no events).
 */
export async function generateDailyReport(
  env: Env,
  localDate: string,
  options?: { force?: boolean }
): Promise<{ regenerated: boolean }> {
  const freshness = await getFaceEventFreshness(env, localDate);
  if (!options?.force) {
    const state = await getMaterializationState(env, localDate);
    if (
      state &&
      state.materializer_version === MATERIALIZER_VERSION &&
      state.source_event_count === freshness.count &&
      state.max_seen_at_ms === freshness.max_seen_at_ms
    ) {
      return { regenerated: false };
    }
  }

  const events = await getEventsForDate(env, localDate);
  const generatedAtMs = Date.now();
  const gapResolver = createGapResolver(env);
  const drafts = events.length === 0 ? [] : sessionizeEvents(events, gapResolver);
  const sessions = draftsToPresenceSessions(drafts, generatedAtMs);
  const reports = buildReportsForDate(localDate, events, sessions, generatedAtMs);

  await replaceDerivedForDate(env, localDate, sessions, reports, {
    source_event_count: freshness.count,
    max_seen_at_ms: freshness.max_seen_at_ms,
    materializer_version: MATERIALIZER_VERSION,
    generated_at_ms: generatedAtMs,
  });

  return { regenerated: true };
}

/**
 * Ensures derived rows for dates in the month that have face_events OR stale materializations.
 * Skips dates that are already fresh for the current materializer version.
 */
export async function ensureReportsForMonth(
  env: Env,
  monthStr: string
): Promise<{
  checked: number;
  regenerated: number;
}> {
  const dates = await getDistinctDatesForMonth(env, monthStr);
  let regenerated = 0;
  for (const localDate of dates) {
    const result = await generateDailyReport(env, localDate);
    if (result.regenerated) regenerated += 1;
  }
  return { checked: dates.length, regenerated };
}
