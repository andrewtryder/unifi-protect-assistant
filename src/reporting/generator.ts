import { Env, DailyReport, FaceEvent } from "../types.js";
import { getEventsForDate, upsertDailyReport } from "../db/queries.js";

/**
 * Rounds milliseconds up to the nearest 15-minute interval
 */
export function roundToNearest15Mins(ms: number): { roundedMinutes: number; roundedHours: number } {
  const seconds = ms / 1000;
  const minutes = seconds / 60;
  
  // Round up to nearest 15 minutes
  const roundedMinutes = Math.ceil(minutes / 15) * 15;
  const roundedHours = Number((roundedMinutes / 60).toFixed(2));
  
  return { roundedMinutes, roundedHours };
}

/**
 * Computes the daily report for a given local date based on all face_events.
 * This runs idempotently by replacing any existing report.
 */
export async function generateDailyReport(env: Env, localDate: string): Promise<void> {
  const events = await getEventsForDate(env, localDate);
  if (events.length === 0) {
    return;
  }

  // Group events by person_key
  const personGroups = new Map<string, FaceEvent[]>();
  for (const event of events) {
    const key = event.person_key;
    if (!personGroups.has(key)) {
      personGroups.set(key, []);
    }
    personGroups.get(key)!.push(event);
  }

  const generatedAtMs = Date.now();

  for (const [personKey, groupEvents] of personGroups.entries()) {
    // Sort by seen_at_ms asc just in case
    groupEvents.sort((a, b) => a.seen_at_ms - b.seen_at_ms);

    const firstEvent = groupEvents[0];
    const lastEvent = groupEvents[groupEvents.length - 1];

    const firstSeenMs = firstEvent.seen_at_ms;
    const lastSeenMs = lastEvent.seen_at_ms;

    const rawSpanMs = lastSeenMs - firstSeenMs;
    const rawSpanSeconds = rawSpanMs / 1000;

    const { roundedMinutes, roundedHours } = roundToNearest15Mins(rawSpanMs);

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
    };

    await upsertDailyReport(env, report);
  }
}
