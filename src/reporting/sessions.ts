import {
  Env,
  FaceEvent,
  PresenceSession,
  TodayPersonRow,
  TodaySnapshot,
  TodayStreamEvent,
  TodayVehicleRow,
  VehicleEvent,
} from "../types.js";
import { getEventsForDate, getVehicleEventsForDate, getWebhookHealth } from "../db/queries.js";
import { getLocalDate } from "../webhook/parser.js";
import { roundToNearest15Mins } from "./round.js";
import { WEBHOOK_STALE_MS } from "../ops/constants.js";

const DEFAULT_GAP_MINUTES = 20;

export type GapResolver = (personKey: string, cameraId?: string) => number;

function parseGapMap(raw?: string): Map<string, number> {
  if (!raw?.trim()) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed)) {
      const minutes = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(minutes) && minutes > 0) {
        map.set(key, minutes);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Build a gap resolver from env.
 * Precedence for consecutive events: person override → same-camera override → default.
 */
export function createGapResolver(env: Env): GapResolver {
  const defaultMinutes = Number(env.PRESENCE_GAP_MINUTES);
  const defaultMs =
    (Number.isFinite(defaultMinutes) && defaultMinutes > 0 ? defaultMinutes : DEFAULT_GAP_MINUTES) *
    60 *
    1000;

  const byPerson = parseGapMap(env.PRESENCE_GAP_BY_PERSON);
  const byCamera = parseGapMap(env.PRESENCE_GAP_BY_CAMERA);

  return (personKey: string, cameraId?: string) => {
    const personMinutes = byPerson.get(personKey);
    if (personMinutes != null) return personMinutes * 60 * 1000;

    if (cameraId) {
      const cameraMinutes = byCamera.get(cameraId);
      if (cameraMinutes != null) return cameraMinutes * 60 * 1000;
    }

    return defaultMs;
  };
}

export interface SessionDraft {
  person_key: string;
  person_name: string;
  local_date: string;
  started_at_ms: number;
  ended_at_ms: number;
  first_event_id: string;
  last_event_id: string;
  first_camera_id: string;
  last_camera_id: string;
  sighting_count: number;
}

/**
 * Pure sessionization: sort events, split when gap exceeded.
 * Camera override applies when both consecutive events share the same camera_id.
 */
export function sessionizeEvents(events: FaceEvent[], gapResolver: GapResolver): SessionDraft[] {
  if (events.length === 0) return [];

  const byPerson = new Map<string, FaceEvent[]>();
  for (const event of events) {
    const list = byPerson.get(event.person_key) || [];
    list.push(event);
    byPerson.set(event.person_key, list);
  }

  const sessions: SessionDraft[] = [];

  for (const [, personEvents] of byPerson) {
    personEvents.sort((a, b) => a.seen_at_ms - b.seen_at_ms);

    let current: SessionDraft | null = null;
    let prevCameraId: string | undefined;

    for (const event of personEvents) {
      if (!current) {
        current = {
          person_key: event.person_key,
          person_name: event.person_name,
          local_date: event.local_date,
          started_at_ms: event.seen_at_ms,
          ended_at_ms: event.seen_at_ms,
          first_event_id: event.event_id,
          last_event_id: event.event_id,
          first_camera_id: event.camera_id,
          last_camera_id: event.camera_id,
          sighting_count: 1,
        };
        prevCameraId = event.camera_id;
        continue;
      }

      const sameCamera =
        prevCameraId && event.camera_id && prevCameraId === event.camera_id
          ? event.camera_id
          : undefined;
      const gapMs = gapResolver(event.person_key, sameCamera);
      const delta = event.seen_at_ms - current.ended_at_ms;

      if (delta > gapMs) {
        sessions.push(current);
        current = {
          person_key: event.person_key,
          person_name: event.person_name,
          local_date: event.local_date,
          started_at_ms: event.seen_at_ms,
          ended_at_ms: event.seen_at_ms,
          first_event_id: event.event_id,
          last_event_id: event.event_id,
          first_camera_id: event.camera_id,
          last_camera_id: event.camera_id,
          sighting_count: 1,
        };
      } else {
        current.ended_at_ms = event.seen_at_ms;
        current.last_event_id = event.event_id;
        current.last_camera_id = event.camera_id;
        current.sighting_count += 1;
      }
      prevCameraId = event.camera_id;
    }

    if (current) sessions.push(current);
  }

  sessions.sort((a, b) => a.started_at_ms - b.started_at_ms);
  return sessions;
}

export interface VehicleSessionDraft {
  plate_key: string;
  plate_text: string;
  local_date: string;
  started_at_ms: number;
  ended_at_ms: number;
  first_event_id: string;
  last_event_id: string;
  first_camera_id: string;
  last_camera_id: string;
  sighting_count: number;
}

/**
 * Gap-sessionize vehicle events by plate_key (reuses person/camera gap resolver keys).
 */
export function sessionizeVehicleEvents(
  events: VehicleEvent[],
  gapResolver: GapResolver
): VehicleSessionDraft[] {
  if (events.length === 0) return [];

  const byPlate = new Map<string, VehicleEvent[]>();
  for (const event of events) {
    const list = byPlate.get(event.plate_key) || [];
    list.push(event);
    byPlate.set(event.plate_key, list);
  }

  const sessions: VehicleSessionDraft[] = [];

  for (const [, plateEvents] of byPlate) {
    plateEvents.sort((a, b) => a.seen_at_ms - b.seen_at_ms);

    let current: VehicleSessionDraft | null = null;
    let prevCameraId: string | undefined;

    for (const event of plateEvents) {
      if (!current) {
        current = {
          plate_key: event.plate_key,
          plate_text: event.plate_text || event.plate_key.replace(/^plate:/, ""),
          local_date: event.local_date,
          started_at_ms: event.seen_at_ms,
          ended_at_ms: event.seen_at_ms,
          first_event_id: event.event_id,
          last_event_id: event.event_id,
          first_camera_id: event.camera_id,
          last_camera_id: event.camera_id,
          sighting_count: 1,
        };
        prevCameraId = event.camera_id;
        continue;
      }

      const sameCamera =
        prevCameraId && event.camera_id && prevCameraId === event.camera_id
          ? event.camera_id
          : undefined;
      const gapMs = gapResolver(event.plate_key, sameCamera);
      const delta = event.seen_at_ms - current.ended_at_ms;

      if (delta > gapMs) {
        sessions.push(current);
        current = {
          plate_key: event.plate_key,
          plate_text: event.plate_text || event.plate_key.replace(/^plate:/, ""),
          local_date: event.local_date,
          started_at_ms: event.seen_at_ms,
          ended_at_ms: event.seen_at_ms,
          first_event_id: event.event_id,
          last_event_id: event.event_id,
          first_camera_id: event.camera_id,
          last_camera_id: event.camera_id,
          sighting_count: 1,
        };
      } else {
        current.ended_at_ms = event.seen_at_ms;
        current.last_event_id = event.event_id;
        current.last_camera_id = event.camera_id;
        if (event.plate_text) current.plate_text = event.plate_text;
        current.sighting_count += 1;
      }
      prevCameraId = event.camera_id;
    }

    if (current) sessions.push(current);
  }

  sessions.sort((a, b) => a.started_at_ms - b.started_at_ms);
  return sessions;
}

export function draftsToPresenceSessions(
  drafts: SessionDraft[],
  generatedAtMs: number,
  nowMs?: number,
  gapResolver?: GapResolver
): PresenceSession[] {
  return drafts.map((draft) => {
    const durationMs = Math.max(0, draft.ended_at_ms - draft.started_at_ms);
    const { roundedMinutes } = roundToNearest15Mins(durationMs);
    let isOpen = 0;
    if (nowMs != null && gapResolver) {
      const gapMs = gapResolver(draft.person_key, draft.last_camera_id);
      if (nowMs - draft.ended_at_ms <= gapMs) {
        isOpen = 1;
      }
    }
    return {
      id: crypto.randomUUID(),
      local_date: draft.local_date,
      person_key: draft.person_key,
      person_name: draft.person_name,
      started_at_ms: draft.started_at_ms,
      ended_at_ms: draft.ended_at_ms,
      duration_seconds: durationMs / 1000,
      rounded_duration_minutes: roundedMinutes,
      sighting_count: draft.sighting_count,
      first_event_id: draft.first_event_id,
      last_event_id: draft.last_event_id,
      first_camera_id: draft.first_camera_id,
      last_camera_id: draft.last_camera_id,
      is_open: isOpen,
      generated_at_ms: generatedAtMs,
    };
  });
}

function isUnknownFace(event: FaceEvent): boolean {
  return event.trigger_key === "face_unknown" || event.person_name.toLowerCase() === "unknown";
}

/**
 * Live Today snapshot from face_events (no materialized session dependency).
 */
export async function buildTodaySnapshot(
  env: Env,
  nowMs: number = Date.now()
): Promise<TodaySnapshot> {
  const timezone = env.TIMEZONE || "America/New_York";
  const localDate = getLocalDate(nowMs, timezone);
  const gapResolver = createGapResolver(env);
  const events = await getEventsForDate(env, localDate);
  const drafts = sessionizeEvents(events, gapResolver);
  const sessions = draftsToPresenceSessions(drafts, nowMs, nowMs, gapResolver);

  const byPerson = new Map<string, TodayPersonRow>();
  for (const session of sessions) {
    const existing = byPerson.get(session.person_key);
    const observedSeconds = (existing?.observed_span_seconds || 0) + session.duration_seconds;
    const sightingCount = (existing?.sighting_count || 0) + session.sighting_count;
    const sessionCount = (existing?.session_count || 0) + 1;
    const firstSeen = existing
      ? Math.min(existing.first_seen_ms, session.started_at_ms)
      : session.started_at_ms;
    const lastSeen = existing
      ? Math.max(existing.last_seen_ms, session.ended_at_ms)
      : session.ended_at_ms;
    const lastCamera =
      !existing || session.ended_at_ms >= existing.last_seen_ms
        ? session.last_camera_id
        : existing.last_camera_id;

    const gapMs = gapResolver(session.person_key, lastCamera);
    const status: "present" | "away" = nowMs - lastSeen <= gapMs ? "present" : "away";

    const { roundedMinutes, roundedHours } = roundToNearest15Mins(observedSeconds * 1000);

    byPerson.set(session.person_key, {
      person_key: session.person_key,
      person_name: session.person_name,
      status,
      first_seen_ms: firstSeen,
      last_seen_ms: lastSeen,
      last_camera_id: lastCamera,
      observed_span_seconds: observedSeconds,
      observed_rounded_minutes: roundedMinutes,
      observed_rounded_hours: roundedHours,
      session_count: sessionCount,
      sighting_count: sightingCount,
    });
  }

  const people = [...byPerson.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "present" ? -1 : 1;
    return b.last_seen_ms - a.last_seen_ms;
  });

  const hourAgo = nowMs - 60 * 60 * 1000;
  const eventsLastHour = events.filter((e) => e.seen_at_ms >= hourAgo).length;
  const unknownFaceCount = events.filter(isUnknownFace).length;

  const webhook = await getWebhookHealth(env, hourAgo);
  const healthy =
    webhook.last_received_at_ms != null && nowMs - webhook.last_received_at_ms <= WEBHOOK_STALE_MS;

  const recentEvents: TodayStreamEvent[] = [...events]
    .sort((a, b) => b.seen_at_ms - a.seen_at_ms)
    .slice(0, 20)
    .map((e) => ({
      event_id: e.event_id,
      seen_at_ms: e.seen_at_ms,
      person_name: e.person_name,
      camera_id: e.camera_id,
      trigger_key: e.trigger_key,
      image_base64: e.image_base64,
    }));

  const vehicleEvents = await getVehicleEventsForDate(env, localDate);
  const vehicleDrafts = sessionizeVehicleEvents(vehicleEvents, gapResolver);
  const byPlate = new Map<string, TodayVehicleRow>();
  for (const session of vehicleDrafts) {
    const existing = byPlate.get(session.plate_key);
    const observedSeconds =
      (existing?.observed_span_seconds || 0) +
      Math.max(0, session.ended_at_ms - session.started_at_ms) / 1000;
    const sightingCount = (existing?.sighting_count || 0) + session.sighting_count;
    const sessionCount = (existing?.session_count || 0) + 1;
    const firstSeen = existing
      ? Math.min(existing.first_seen_ms, session.started_at_ms)
      : session.started_at_ms;
    const lastSeen = existing
      ? Math.max(existing.last_seen_ms, session.ended_at_ms)
      : session.ended_at_ms;
    const lastCamera =
      !existing || session.ended_at_ms >= existing.last_seen_ms
        ? session.last_camera_id
        : existing.last_camera_id;
    const plateText =
      !existing || session.ended_at_ms >= existing.last_seen_ms
        ? session.plate_text
        : existing.plate_text;

    const gapMs = gapResolver(session.plate_key, lastCamera);
    const status: "present" | "away" = nowMs - lastSeen <= gapMs ? "present" : "away";
    const { roundedMinutes, roundedHours } = roundToNearest15Mins(observedSeconds * 1000);

    byPlate.set(session.plate_key, {
      plate_key: session.plate_key,
      plate_text: plateText,
      status,
      first_seen_ms: firstSeen,
      last_seen_ms: lastSeen,
      last_camera_id: lastCamera,
      observed_span_seconds: observedSeconds,
      observed_rounded_minutes: roundedMinutes,
      observed_rounded_hours: roundedHours,
      session_count: sessionCount,
      sighting_count: sightingCount,
    });
  }

  const vehicles = [...byPlate.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "present" ? -1 : 1;
    return b.last_seen_ms - a.last_seen_ms;
  });
  const vehicleEventsLastHour = vehicleEvents.filter((e) => e.seen_at_ms >= hourAgo).length;

  return {
    local_date: localDate,
    generated_at_ms: nowMs,
    present_count: people.filter((p) => p.status === "present").length,
    seen_today_count: people.length,
    unknown_face_count: unknownFaceCount,
    events_last_hour: eventsLastHour,
    vehicles_present_count: vehicles.filter((v) => v.status === "present").length,
    vehicles_seen_today_count: vehicles.length,
    vehicle_events_last_hour: vehicleEventsLastHour,
    webhook: {
      last_received_at_ms: webhook.last_received_at_ms,
      count_last_hour: webhook.count_last_hour,
      healthy,
    },
    people,
    vehicles,
    recent_events: recentEvents,
  };
}
