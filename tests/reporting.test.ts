import { describe, it, expect } from "vitest";
import { getLocalDate } from "../src/webhook/parser.js";
import { ensureReportsForMonth, roundToNearest15Mins } from "../src/reporting/generator.js";
import { Env, FaceEvent, DailyReport, PresenceSession } from "../src/types.js";

describe("Reporting Utils Tests", () => {
  it("should calculate local date correctly in America/New_York", () => {
    const ms = 1719655200000;
    const localDate = getLocalDate(ms, "America/New_York");
    expect(localDate).toBe("2024-06-29");
  });

  it("should round elapsed time up to the nearest 15 minutes", () => {
    expect(roundToNearest15Mins(0)).toEqual({ roundedMinutes: 0, roundedHours: 0 });
    expect(roundToNearest15Mins(60 * 1000).roundedMinutes).toBe(15);
    expect(roundToNearest15Mins(14 * 60 * 1000).roundedMinutes).toBe(15);
    expect(roundToNearest15Mins(16 * 60 * 1000).roundedMinutes).toBe(30);
    expect(roundToNearest15Mins(225 * 60 * 1000).roundedHours).toBe(3.75);
    expect(roundToNearest15Mins(221 * 60 * 1000).roundedMinutes).toBe(225);
  });
});

describe("ensureReportsForMonth", () => {
  const faceEvents: FaceEvent[] = [
    {
      id: "evt-1",
      notification_id: "notif-1",
      event_id: "event-1",
      seen_at_ms: 1_000,
      local_date: "2025-07-01",
      person_key: "id:alice",
      person_name: "Alice",
      person_id: "alice",
      trigger_key: "face_known",
      camera_id: "cam-1",
      alarm_name: "Alice Detected",
      raw_trigger_json: "{}",
    },
    {
      id: "evt-2",
      notification_id: "notif-2",
      event_id: "event-2",
      seen_at_ms: 2_000,
      local_date: "2025-07-01",
      person_key: "id:alice",
      person_name: "Alice",
      person_id: "alice",
      trigger_key: "face_known",
      camera_id: "cam-1",
      alarm_name: "Alice Detected",
      raw_trigger_json: "{}",
    },
    {
      id: "evt-3",
      notification_id: "notif-3",
      event_id: "event-3",
      seen_at_ms: 3_000,
      local_date: "2025-07-02",
      person_key: "id:bob",
      person_name: "Bob",
      person_id: "bob",
      trigger_key: "face_known",
      camera_id: "cam-2",
      alarm_name: "Bob Detected",
      raw_trigger_json: "{}",
    },
  ];

  function createMutableEnv(events: FaceEvent[]): {
    env: Env;
    reports: DailyReport[];
    sessions: PresenceSession[];
  } {
    const reports: DailyReport[] = [];
    let sessions: PresenceSession[] = [];

    type BoundStmt = {
      all: <T>() => Promise<{ results: T[] }>;
      run: () => Promise<{ success: boolean }>;
    };

    function executeAll<T>(query: string, boundArgs: unknown[]): Promise<{ results: T[] }> {
      return Promise.resolve().then(() => {
        if (query.includes("SELECT DISTINCT local_date")) {
          const prefix = String(boundArgs[0]).replace("%", "");
          const dates = [
            ...new Set(
              events.filter((e) => e.local_date.startsWith(prefix)).map((e) => e.local_date)
            ),
          ].sort();
          return { results: dates.map((local_date) => ({ local_date })) as T[] };
        }

        if (query.includes("FROM face_events") && !query.includes("GROUP BY")) {
          const dateStr = boundArgs[0] as string;
          let results = events.filter((e) => e.local_date === dateStr);
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

    function makeBound(query: string, args: unknown[]): BoundStmt {
      return {
        all: <T>() => executeAll<T>(query, args),
        async run() {
          if (query.includes("DELETE FROM presence_sessions")) {
            const localDate = args[0] as string;
            sessions = sessions.filter((s) => s.local_date !== localDate);
          }
          if (query.includes("INSERT INTO presence_sessions")) {
            sessions.push({
              id: args[0] as string,
              local_date: args[1] as string,
              person_key: args[2] as string,
              person_name: args[3] as string,
              started_at_ms: args[4] as number,
              ended_at_ms: args[5] as number,
              duration_seconds: args[6] as number,
              rounded_duration_minutes: args[7] as number,
              sighting_count: args[8] as number,
              first_event_id: args[9] as string,
              last_event_id: args[10] as string,
              first_camera_id: args[11] as string,
              last_camera_id: args[12] as string,
              is_open: args[13] as number,
              generated_at_ms: args[14] as number,
            });
          }
          if (query.includes("INSERT OR REPLACE INTO daily_person_reports")) {
            const report: DailyReport = {
              local_date: args[0] as string,
              person_key: args[1] as string,
              person_name: args[2] as string,
              first_seen_ms: args[3] as number,
              last_seen_ms: args[4] as number,
              raw_span_seconds: args[5] as number,
              rounded_span_minutes: args[6] as number,
              rounded_span_hours: args[7] as number,
              first_event_id: args[8] as string,
              last_event_id: args[9] as string,
              first_camera_id: args[10] as string,
              last_camera_id: args[11] as string,
              seen_count: args[12] as number,
              generated_at_ms: args[13] as number,
              observed_span_seconds: args[14] as number,
              observed_rounded_minutes: args[15] as number,
              observed_rounded_hours: args[16] as number,
              session_count: args[17] as number,
            };
            const idx = reports.findIndex(
              (r) => r.local_date === report.local_date && r.person_key === report.person_key
            );
            if (idx >= 0) reports[idx] = report;
            else reports.push(report);
          }
          return { success: true };
        },
      };
    }

    const db = {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            return makeBound(query, args);
          },
          all: <T>() => executeAll<T>(query, []),
          async run() {
            return { success: true };
          },
        };
      },
      async batch(stmts: BoundStmt[]) {
        for (const stmt of stmts) {
          await stmt.run();
        }
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    };

    return {
      env: { DB: db as unknown as D1Database, KV: {} as KVNamespace },
      reports,
      get sessions() {
        return sessions;
      },
    };
  }

  it("backfills daily reports with observed session fields", async () => {
    const { env, reports } = createMutableEnv(faceEvents);
    expect(reports).toHaveLength(0);

    await ensureReportsForMonth(env, "2025-07");

    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.local_date).sort()).toEqual(["2025-07-01", "2025-07-02"]);

    const alice = reports.find((r) => r.person_name === "Alice");
    expect(alice?.seen_count).toBe(2);
    expect(alice?.first_seen_ms).toBe(1_000);
    expect(alice?.last_seen_ms).toBe(2_000);
    expect(alice?.session_count).toBe(1);
    expect(alice?.observed_span_seconds).toBe(1);

    const bob = reports.find((r) => r.person_name === "Bob");
    expect(bob?.seen_count).toBe(1);
    expect(bob?.session_count).toBe(1);
  });

  it("is a no-op when the month has no face_events", async () => {
    const { env, reports } = createMutableEnv(faceEvents);
    await ensureReportsForMonth(env, "2025-06");
    expect(reports).toHaveLength(0);
  });
});
