import { describe, it, expect } from "vitest";
import { createGapResolver, sessionizeEvents } from "../src/reporting/sessions.js";
import { roundToNearest15Mins } from "../src/reporting/round.js";
import { Env, FaceEvent } from "../src/types.js";

function event(
  partial: Partial<FaceEvent> &
    Pick<FaceEvent, "event_id" | "seen_at_ms" | "person_key" | "person_name">
): FaceEvent {
  return {
    id: partial.id || partial.event_id,
    notification_id: partial.notification_id || "n1",
    event_id: partial.event_id,
    seen_at_ms: partial.seen_at_ms,
    local_date: partial.local_date || "2025-07-14",
    person_key: partial.person_key,
    person_name: partial.person_name,
    person_id: partial.person_id || "p",
    trigger_key: partial.trigger_key || "face_known",
    camera_id: partial.camera_id || "cam-1",
    alarm_name: partial.alarm_name || "Alarm",
    raw_trigger_json: "{}",
  };
}

describe("sessionizeEvents", () => {
  const gap20m = () => 20 * 60 * 1000;

  it("returns empty for no events", () => {
    expect(sessionizeEvents([], gap20m)).toEqual([]);
  });

  it("creates one session for a single event", () => {
    const sessions = sessionizeEvents(
      [event({ event_id: "e1", seen_at_ms: 1_000, person_key: "id:a", person_name: "Alice" })],
      gap20m
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sighting_count).toBe(1);
    expect(sessions[0].started_at_ms).toBe(1_000);
    expect(sessions[0].ended_at_ms).toBe(1_000);
    expect(sessions[0].ended_at_ms - sessions[0].started_at_ms).toBe(0);
  });

  it("continues a session when events are within the gap", () => {
    const t0 = Date.parse("2025-07-14T13:00:00Z");
    const sessions = sessionizeEvents(
      [
        event({
          event_id: "e1",
          seen_at_ms: t0,
          person_key: "id:a",
          person_name: "Alice",
          camera_id: "cam-1",
        }),
        event({
          event_id: "e2",
          seen_at_ms: t0 + 10 * 60 * 1000,
          person_key: "id:a",
          person_name: "Alice",
          camera_id: "cam-2",
        }),
      ],
      gap20m
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sighting_count).toBe(2);
    expect(sessions[0].first_camera_id).toBe("cam-1");
    expect(sessions[0].last_camera_id).toBe("cam-2");
    expect(sessions[0].ended_at_ms - sessions[0].started_at_ms).toBe(10 * 60 * 1000);
  });

  it("splits 9am and 5pm into two sessions instead of an 8-hour span", () => {
    const morning = Date.parse("2025-07-14T13:00:00Z"); // 9am ET
    const evening = Date.parse("2025-07-14T21:00:00Z"); // 5pm ET
    const sessions = sessionizeEvents(
      [
        event({ event_id: "e1", seen_at_ms: morning, person_key: "id:a", person_name: "Alice" }),
        event({ event_id: "e2", seen_at_ms: evening, person_key: "id:a", person_name: "Alice" }),
      ],
      gap20m
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[0].started_at_ms).toBe(morning);
    expect(sessions[1].started_at_ms).toBe(evening);
    const observedMs = sessions.reduce((sum, s) => sum + (s.ended_at_ms - s.started_at_ms), 0);
    expect(observedMs).toBe(0);
  });

  it("sessionizes each person independently", () => {
    const t0 = 1_000_000;
    const sessions = sessionizeEvents(
      [
        event({ event_id: "a1", seen_at_ms: t0, person_key: "id:a", person_name: "Alice" }),
        event({ event_id: "b1", seen_at_ms: t0 + 1000, person_key: "id:b", person_name: "Bob" }),
        event({
          event_id: "a2",
          seen_at_ms: t0 + 5 * 60 * 1000,
          person_key: "id:a",
          person_name: "Alice",
        }),
      ],
      gap20m
    );
    expect(sessions.filter((s) => s.person_key === "id:a")).toHaveLength(1);
    expect(sessions.filter((s) => s.person_key === "id:b")).toHaveLength(1);
    expect(sessions.find((s) => s.person_key === "id:a")?.sighting_count).toBe(2);
  });
});

describe("createGapResolver", () => {
  it("uses default 20 minutes", () => {
    const resolver = createGapResolver({ DB: {} as D1Database, KV: {} as KVNamespace });
    expect(resolver("id:anyone")).toBe(20 * 60 * 1000);
  });

  it("prefers person override over camera and default", () => {
    const env: Env = {
      DB: {} as D1Database,
      KV: {} as KVNamespace,
      PRESENCE_GAP_MINUTES: "20",
      PRESENCE_GAP_BY_PERSON: JSON.stringify({ "id:alice": 45 }),
      PRESENCE_GAP_BY_CAMERA: JSON.stringify({ "cam-1": 5 }),
    };
    const resolver = createGapResolver(env);
    expect(resolver("id:alice", "cam-1")).toBe(45 * 60 * 1000);
    expect(resolver("id:bob", "cam-1")).toBe(5 * 60 * 1000);
    expect(resolver("id:bob", "cam-other")).toBe(20 * 60 * 1000);
  });

  it("applies camera override when consecutive events share a camera", () => {
    const env: Env = {
      DB: {} as D1Database,
      KV: {} as KVNamespace,
      PRESENCE_GAP_MINUTES: "20",
      PRESENCE_GAP_BY_CAMERA: JSON.stringify({ "cam-tight": 5 }),
    };
    const resolver = createGapResolver(env);
    const t0 = 1_000_000;
    // 10 minutes apart — within default 20m but beyond camera 5m
    const sessions = sessionizeEvents(
      [
        event({
          event_id: "e1",
          seen_at_ms: t0,
          person_key: "id:a",
          person_name: "Alice",
          camera_id: "cam-tight",
        }),
        event({
          event_id: "e2",
          seen_at_ms: t0 + 10 * 60 * 1000,
          person_key: "id:a",
          person_name: "Alice",
          camera_id: "cam-tight",
        }),
      ],
      resolver
    );
    expect(sessions).toHaveLength(2);
  });
});

describe("roundToNearest15Mins for session duration", () => {
  it("rounds a 1-minute session up to 15 minutes", () => {
    const r = roundToNearest15Mins(60 * 1000);
    expect(r.roundedMinutes).toBe(15);
    expect(r.roundedHours).toBe(0.25);
  });
});
