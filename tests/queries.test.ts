import { describe, it, expect } from "vitest";
import {
  getDistinctPeople,
  getDistinctPeopleForDate,
  getDistinctPeopleForMonth,
  getDistinctDatesForMonth,
  getReportsForMonth,
  getEventsForDate,
} from "../src/db/queries.js";
import { Env, FaceEvent, DailyReport } from "../src/types.js";

const sampleFaceEvents: FaceEvent[] = [
  {
    id: "evt-1",
    notification_id: "notif-1",
    event_id: "event-1",
    seen_at_ms: 1746970986798,
    local_date: "2025-07-01",
    person_key: "id:person-a",
    person_name: "Alice",
    person_id: "person-a",
    trigger_key: "face_known",
    camera_id: "cam-1",
    alarm_name: "Alice Detected",
    raw_trigger_json: "{}",
    image_base64: "abc123",
  },
  {
    id: "evt-2",
    notification_id: "notif-2",
    event_id: "event-2",
    seen_at_ms: 1746971086798,
    local_date: "2025-07-01",
    person_key: "id:person-b",
    person_name: "Bob",
    person_id: "person-b",
    trigger_key: "face_known",
    camera_id: "cam-2",
    alarm_name: "Bob Detected",
    raw_trigger_json: "{}",
  },
  {
    id: "evt-3",
    notification_id: "notif-3",
    event_id: "event-3",
    seen_at_ms: 1747057386798,
    local_date: "2025-07-02",
    person_key: "name:unknown",
    person_name: "Unknown",
    person_id: "",
    trigger_key: "face_unknown",
    camera_id: "cam-1",
    alarm_name: "Unknown Face",
    raw_trigger_json: "{}",
  },
  {
    id: "evt-4",
    notification_id: "notif-4",
    event_id: "event-4",
    seen_at_ms: 1747143786798,
    local_date: "2025-07-03",
    person_key: "id:person-a",
    person_name: "alice",
    person_id: "person-a",
    trigger_key: "face_known",
    camera_id: "cam-1",
    alarm_name: "Alice Detected",
    raw_trigger_json: "{}",
  },
];

const sampleReports: DailyReport[] = [
  {
    local_date: "2025-07-01",
    person_key: "id:person-a",
    person_name: "Alice",
    first_seen_ms: 1746970986798,
    last_seen_ms: 1746970986798,
    raw_span_seconds: 0,
    rounded_span_minutes: 0,
    rounded_span_hours: 0,
    first_event_id: "event-1",
    last_event_id: "event-1",
    first_camera_id: "cam-1",
    last_camera_id: "cam-1",
    seen_count: 1,
    generated_at_ms: 1746972000000,
  },
  {
    local_date: "2025-07-01",
    person_key: "id:person-b",
    person_name: "Bob",
    first_seen_ms: 1746971086798,
    last_seen_ms: 1746971086798,
    raw_span_seconds: 0,
    rounded_span_minutes: 0,
    rounded_span_hours: 0,
    first_event_id: "event-2",
    last_event_id: "event-2",
    first_camera_id: "cam-2",
    last_camera_id: "cam-2",
    seen_count: 1,
    generated_at_ms: 1746972000000,
  },
  {
    local_date: "2025-07-02",
    person_key: "name:unknown",
    person_name: "Unknown",
    first_seen_ms: 1747057386798,
    last_seen_ms: 1747057386798,
    raw_span_seconds: 0,
    rounded_span_minutes: 0,
    rounded_span_hours: 0,
    first_event_id: "event-3",
    last_event_id: "event-3",
    first_camera_id: "cam-1",
    last_camera_id: "cam-1",
    seen_count: 1,
    generated_at_ms: 1747060000000,
  },
];

/**
 * Lightweight in-memory D1 mock that simulates the query functions' SQL behavior.
 */
function createMockEnv(faceEvents: FaceEvent[], dailyReports: DailyReport[]): Env {
  function executeAll<T>(query: string, boundArgs: unknown[]): Promise<{ results: T[] }> {
    return Promise.resolve().then(() => {
      if (query.includes("GROUP BY LOWER(person_name)")) {
        let scoped = faceEvents;
        if (query.includes("WHERE local_date = ?")) {
          scoped = faceEvents.filter((e) => e.local_date === boundArgs[0]);
        } else if (query.includes("WHERE local_date LIKE ?")) {
          const prefix = String(boundArgs[0]).replace("%", "");
          scoped = faceEvents.filter((e) => e.local_date.startsWith(prefix));
        }

        const groups = new Map<
          string,
          { person_name: string; last_seen_ms: number; event_count: number }
        >();
        for (const e of scoped) {
          const key = e.person_name.toLowerCase();
          const existing = groups.get(key);
          if (!existing) {
            groups.set(key, {
              person_name: e.person_name,
              last_seen_ms: e.seen_at_ms,
              event_count: 1,
            });
          } else {
            existing.event_count++;
            if (e.seen_at_ms > existing.last_seen_ms) {
              existing.last_seen_ms = e.seen_at_ms;
            }
            if (e.person_name < existing.person_name) {
              existing.person_name = e.person_name;
            }
          }
        }
        const results = Array.from(groups.values()).sort((a, b) =>
          a.person_name.localeCompare(b.person_name)
        );
        return { results: results as T[] };
      }

      if (query.includes("SELECT DISTINCT local_date")) {
        const prefix = String(boundArgs[0]).replace("%", "");
        const dates = [
          ...new Set(
            faceEvents.filter((e) => e.local_date.startsWith(prefix)).map((e) => e.local_date)
          ),
        ].sort();
        return { results: dates.map((local_date) => ({ local_date })) as T[] };
      }

      if (query.includes("FROM daily_person_reports")) {
        const monthPrefix = boundArgs[0] as string;
        let results = dailyReports.filter((r) =>
          r.local_date.startsWith(monthPrefix.replace("%", ""))
        );
        if (query.includes("LOWER(person_name)") && boundArgs[1]) {
          const personName = (boundArgs[1] as string).toLowerCase();
          results = results.filter((r) => r.person_name.toLowerCase() === personName);
        }
        results.sort(
          (a, b) =>
            a.local_date.localeCompare(b.local_date) || a.person_name.localeCompare(b.person_name)
        );
        return { results: results as T[] };
      }

      if (query.includes("FROM face_events")) {
        const dateStr = boundArgs[0] as string;
        let results = faceEvents.filter((e) => e.local_date === dateStr);
        if (query.includes("LOWER(person_name)") && boundArgs[1]) {
          const personName = (boundArgs[1] as string).toLowerCase();
          results = results.filter((e) => e.person_name.toLowerCase() === personName);
        }
        results.sort((a, b) => a.seen_at_ms - b.seen_at_ms);
        return { results: results as T[] };
      }

      return { results: [] as T[] };
    });
  }

  const db = {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            all: <T>() => executeAll<T>(query, args),
            async run() {
              return { success: true };
            },
          };
        },
        all: <T>() => executeAll<T>(query, []),
        async run() {
          return { success: true };
        },
      };
    },
  };

  return { DB: db as unknown as D1Database, KV: {} as KVNamespace };
}

describe("Query layer - person filtering", () => {
  const env = createMockEnv(sampleFaceEvents, sampleReports);

  it("getDistinctPeople returns unique people grouped case-insensitively", async () => {
    const people = await getDistinctPeople(env);
    expect(people).toHaveLength(3);
    expect(people.map((p) => p.person_name).sort()).toEqual(["Alice", "Bob", "Unknown"]);
    const alice = people.find((p) => p.person_name.toLowerCase() === "alice");
    expect(alice?.event_count).toBe(2);
    expect(alice?.last_seen_ms).toBe(1747143786798);
  });

  it("getDistinctPeopleForDate only includes people seen on that date", async () => {
    const people = await getDistinctPeopleForDate(env, "2025-07-01");
    expect(people.map((p) => p.person_name).sort()).toEqual(["Alice", "Bob"]);
    expect(people.find((p) => p.person_name === "Unknown")).toBeUndefined();
  });

  it("getDistinctPeopleForDate excludes people only seen on other days", async () => {
    const people = await getDistinctPeopleForDate(env, "2025-07-02");
    expect(people).toHaveLength(1);
    expect(people[0].person_name).toBe("Unknown");
  });

  it("getDistinctPeopleForMonth scopes people to the month", async () => {
    const people = await getDistinctPeopleForMonth(env, "2025-07");
    expect(people.map((p) => p.person_name).sort()).toEqual(["Alice", "Bob", "Unknown"]);
    const empty = await getDistinctPeopleForMonth(env, "2025-06");
    expect(empty).toHaveLength(0);
  });

  it("getDistinctDatesForMonth returns unique dates with events", async () => {
    const dates = await getDistinctDatesForMonth(env, "2025-07");
    expect(dates).toEqual(["2025-07-01", "2025-07-02", "2025-07-03"]);
  });

  it("getReportsForMonth returns all reports for a month without person filter", async () => {
    const reports = await getReportsForMonth(env, "2025-07");
    expect(reports).toHaveLength(3);
  });

  it("getReportsForMonth filters by person name case-insensitively", async () => {
    const reports = await getReportsForMonth(env, "2025-07", "alice");
    expect(reports).toHaveLength(1);
    expect(reports[0].person_name).toBe("Alice");
    expect(reports[0].local_date).toBe("2025-07-01");
  });

  it("getReportsForMonth returns empty when person has no reports that month", async () => {
    const reports = await getReportsForMonth(env, "2025-06", "Alice");
    expect(reports).toHaveLength(0);
  });

  it("getEventsForDate returns all events for a date without person filter", async () => {
    const events = await getEventsForDate(env, "2025-07-01");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.person_name)).toEqual(["Alice", "Bob"]);
  });

  it("getEventsForDate filters by person name case-insensitively", async () => {
    const events = await getEventsForDate(env, "2025-07-03", "ALICE");
    expect(events).toHaveLength(1);
    expect(events[0].person_name).toBe("alice");
    expect(events[0].event_id).toBe("event-4");
  });

  it("getEventsForDate includes image_base64 in results", async () => {
    const events = await getEventsForDate(env, "2025-07-01", "Alice");
    expect(events[0].image_base64).toBe("abc123");
  });

  it("getEventsForDate returns Unknown face events", async () => {
    const events = await getEventsForDate(env, "2025-07-02", "Unknown");
    expect(events).toHaveLength(1);
    expect(events[0].trigger_key).toBe("face_unknown");
  });
});
