import { describe, it, expect } from "vitest";
import { getLocalDate } from "../src/webhook/parser.js";
import { ensureReportsForMonth, roundToNearest15Mins } from "../src/reporting/generator.js";
import { Env, FaceEvent, DailyReport } from "../src/types.js";

describe("Reporting Utils Tests", () => {
  it("should calculate local date correctly in America/New_York", () => {
    // 1719655200000 = Saturday, June 29, 2024 10:00:00 AM UTC
    // America/New_York (UTC-4) = Saturday, June 29, 2024 6:00:00 AM
    const ms = 1719655200000;
    const localDate = getLocalDate(ms, "America/New_York");
    expect(localDate).toBe("2024-06-29");
  });

  it("should round elapsed time up to the nearest 15 minutes", () => {
    // 0 milliseconds
    const r0 = roundToNearest15Mins(0);
    expect(r0.roundedMinutes).toBe(0);
    expect(r0.roundedHours).toBe(0.00);

    // 1 minute (60000 ms) -> rounds up to 15 mins
    const r1 = roundToNearest15Mins(60 * 1000);
    expect(r1.roundedMinutes).toBe(15);
    expect(r1.roundedHours).toBe(0.25);

    // 14 minutes -> rounds up to 15 mins
    const r14 = roundToNearest15Mins(14 * 60 * 1000);
    expect(r14.roundedMinutes).toBe(15);
    expect(r14.roundedHours).toBe(0.25);

    // 16 minutes -> rounds up to 30 mins
    const r16 = roundToNearest15Mins(16 * 60 * 1000);
    expect(r16.roundedMinutes).toBe(30);
    expect(r16.roundedHours).toBe(0.50);

    // 3 hours and 45 minutes exactly
    const r225 = roundToNearest15Mins(225 * 60 * 1000);
    expect(r225.roundedMinutes).toBe(225);
    expect(r225.roundedHours).toBe(3.75);

    // 3 hours and 41 minutes -> rounds up to 3h 45m
    const r221 = roundToNearest15Mins(221 * 60 * 1000);
    expect(r221.roundedMinutes).toBe(225);
    expect(r221.roundedHours).toBe(3.75);
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

  function createMutableEnv(events: FaceEvent[]): { env: Env; reports: DailyReport[] } {
    const reports: DailyReport[] = [];

    function executeAll<T>(query: string, boundArgs: unknown[]): Promise<{ results: T[] }> {
      return Promise.resolve().then(() => {
        if (query.includes("SELECT DISTINCT local_date")) {
          const prefix = String(boundArgs[0]).replace("%", "");
          const dates = [
            ...new Set(
              events
                .filter(e => e.local_date.startsWith(prefix))
                .map(e => e.local_date)
            ),
          ].sort();
          return { results: dates.map(local_date => ({ local_date })) as T[] };
        }

        if (query.includes("FROM face_events") && !query.includes("GROUP BY")) {
          const dateStr = boundArgs[0] as string;
          let results = events.filter(e => e.local_date === dateStr);
          if (query.includes("LOWER(person_name)") && boundArgs[1]) {
            const personName = (boundArgs[1] as string).toLowerCase();
            results = results.filter(e => e.person_name.toLowerCase() === personName);
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
                  };
                  const idx = reports.findIndex(
                    r => r.local_date === report.local_date && r.person_key === report.person_key
                  );
                  if (idx >= 0) reports[idx] = report;
                  else reports.push(report);
                }
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

    return {
      env: { DB: db as unknown as D1Database, KV: {} as KVNamespace },
      reports,
    };
  }

  it("backfills daily reports from face_events for every date in the month", async () => {
    const { env, reports } = createMutableEnv(faceEvents);
    expect(reports).toHaveLength(0);

    await ensureReportsForMonth(env, "2025-07");

    expect(reports).toHaveLength(2);
    expect(reports.map(r => r.local_date).sort()).toEqual(["2025-07-01", "2025-07-02"]);

    const alice = reports.find(r => r.person_name === "Alice");
    expect(alice?.seen_count).toBe(2);
    expect(alice?.first_seen_ms).toBe(1_000);
    expect(alice?.last_seen_ms).toBe(2_000);

    const bob = reports.find(r => r.person_name === "Bob");
    expect(bob?.seen_count).toBe(1);
  });

  it("is a no-op when the month has no face_events", async () => {
    const { env, reports } = createMutableEnv(faceEvents);
    await ensureReportsForMonth(env, "2025-06");
    expect(reports).toHaveLength(0);
  });
});
