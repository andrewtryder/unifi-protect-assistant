import { describe, it, expect } from "vitest";
import {
  assertForeignKeysOk,
  createMigratedDb,
  createTestEnv,
  type SqliteDb,
} from "./helpers/sqliteHarness.js";
import { generateDailyReport, ensureReportsForMonth } from "../src/reporting/generator.js";
import {
  replaceDerivedForDate,
  getReportsForMonth,
  getSessionsForDate,
} from "../src/db/queries.js";
import { MATERIALIZER_VERSION } from "../src/ops/constants.js";
import type { DailyReport, PresenceSession } from "../src/types.js";

const LOCAL_DATE = "2026-07-15";
const MONTH = "2026-07";

function seedNotification(db: SqliteDb, id: string): void {
  db.prepare(
    `
    INSERT INTO webhook_notifications (
      id, received_at_ms, source_ip, event_id, alarm_name, payload_json, delivery_key
    ) VALUES (?, ?, '127.0.0.1', ?, 'Alarm', '{}', ?)
  `
  ).run(id, Date.parse(`${LOCAL_DATE}T12:00:00Z`), `evt-${id}`, id);
}

function seedFace(
  db: SqliteDb,
  opts: {
    id: string;
    notificationId: string;
    eventId: string;
    seenAtMs: number;
    personKey: string;
    personName: string;
    localDate?: string;
  }
): void {
  db.prepare(
    `
    INSERT INTO face_events (
      id, notification_id, event_id, seen_at_ms, local_date,
      person_key, person_name, person_id, trigger_key, camera_id,
      alarm_name, raw_trigger_json, image_base64
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'face_known', 'cam-1', 'Face', '{}', NULL)
  `
  ).run(
    opts.id,
    opts.notificationId,
    opts.eventId,
    opts.seenAtMs,
    opts.localDate ?? LOCAL_DATE,
    opts.personKey,
    opts.personName,
    opts.personKey.replace(/^id:/, "")
  );
}

function sampleSession(personKey: string, personName: string): PresenceSession {
  return {
    id: `sess-${personKey}`,
    local_date: LOCAL_DATE,
    person_key: personKey,
    person_name: personName,
    started_at_ms: Date.parse(`${LOCAL_DATE}T14:00:00Z`),
    ended_at_ms: Date.parse(`${LOCAL_DATE}T14:10:00Z`),
    duration_seconds: 600,
    rounded_duration_minutes: 15,
    sighting_count: 1,
    first_event_id: `e-${personKey}`,
    last_event_id: `e-${personKey}`,
    first_camera_id: "cam-1",
    last_camera_id: "cam-1",
    is_open: 0,
    generated_at_ms: 1,
  };
}

function sampleReport(personKey: string, personName: string): DailyReport {
  const t = Date.parse(`${LOCAL_DATE}T14:00:00Z`);
  return {
    local_date: LOCAL_DATE,
    person_key: personKey,
    person_name: personName,
    first_seen_ms: t,
    last_seen_ms: t,
    raw_span_seconds: 0,
    rounded_span_minutes: 0,
    rounded_span_hours: 0,
    first_event_id: `e-${personKey}`,
    last_event_id: `e-${personKey}`,
    first_camera_id: "cam-1",
    last_camera_id: "cam-1",
    seen_count: 1,
    generated_at_ms: 1,
    observed_span_seconds: 600,
    observed_rounded_minutes: 15,
    observed_rounded_hours: 0.25,
    session_count: 1,
  };
}

describe("SQLite materialization integration", () => {
  it("deletes stale reports when events disappear", async () => {
    const db = createMigratedDb();
    seedNotification(db, "n1");
    seedFace(db, {
      id: "f1",
      notificationId: "n1",
      eventId: "event-1",
      seenAtMs: Date.parse(`${LOCAL_DATE}T14:00:00Z`),
      personKey: "id:alice",
      personName: "Alice",
    });

    const env = createTestEnv(db);
    expect((await generateDailyReport(env, LOCAL_DATE)).regenerated).toBe(true);
    expect((await getReportsForMonth(env, MONTH)).length).toBe(1);

    db.prepare(`DELETE FROM face_events WHERE local_date = ?`).run(LOCAL_DATE);
    expect((await generateDailyReport(env, LOCAL_DATE)).regenerated).toBe(true);

    expect(await getReportsForMonth(env, MONTH)).toEqual([]);
    expect(await getSessionsForDate(env, LOCAL_DATE)).toEqual([]);
    assertForeignKeysOk(db);
  });

  it("deletes a stale person while retaining another", async () => {
    const db = createMigratedDb();
    seedNotification(db, "n-a");
    seedNotification(db, "n-b");
    seedFace(db, {
      id: "f-a",
      notificationId: "n-a",
      eventId: "event-a",
      seenAtMs: Date.parse(`${LOCAL_DATE}T14:00:00Z`),
      personKey: "id:alice",
      personName: "Alice",
    });
    seedFace(db, {
      id: "f-b",
      notificationId: "n-b",
      eventId: "event-b",
      seenAtMs: Date.parse(`${LOCAL_DATE}T15:00:00Z`),
      personKey: "id:bob",
      personName: "Bob",
    });

    const env = createTestEnv(db);
    await generateDailyReport(env, LOCAL_DATE, { force: true });
    expect((await getReportsForMonth(env, MONTH)).map((r) => r.person_key).sort()).toEqual([
      "id:alice",
      "id:bob",
    ]);

    db.prepare(`DELETE FROM face_events WHERE person_key = ?`).run("id:bob");
    await generateDailyReport(env, LOCAL_DATE, { force: true });

    const reports = await getReportsForMonth(env, MONTH);
    expect(reports.map((r) => r.person_key)).toEqual(["id:alice"]);
    expect(reports[0].person_name).toBe("Alice");
    assertForeignKeysOk(db);
  });

  it("clears derived state when replaceDerivedForDate gets empty arrays", async () => {
    const db = createMigratedDb();
    const env = createTestEnv(db);

    await replaceDerivedForDate(
      env,
      LOCAL_DATE,
      [sampleSession("id:alice", "Alice"), sampleSession("id:bob", "Bob")],
      [sampleReport("id:alice", "Alice"), sampleReport("id:bob", "Bob")],
      {
        source_event_count: 2,
        max_seen_at_ms: Date.parse(`${LOCAL_DATE}T15:00:00Z`),
        materializer_version: MATERIALIZER_VERSION,
        generated_at_ms: 100,
      }
    );

    expect((await getReportsForMonth(env, MONTH)).length).toBe(2);
    expect((await getSessionsForDate(env, LOCAL_DATE)).length).toBe(2);

    await replaceDerivedForDate(env, LOCAL_DATE, [], [], {
      source_event_count: 0,
      max_seen_at_ms: 0,
      materializer_version: MATERIALIZER_VERSION,
      generated_at_ms: 200,
    });

    expect(await getReportsForMonth(env, MONTH)).toEqual([]);
    expect(await getSessionsForDate(env, LOCAL_DATE)).toEqual([]);

    const state = db
      .prepare(
        `SELECT source_event_count, generated_at_ms FROM materialization_state WHERE local_date = ?`
      )
      .get(LOCAL_DATE) as { source_event_count: number; generated_at_ms: number };
    expect(state.source_event_count).toBe(0);
    expect(state.generated_at_ms).toBe(200);
    assertForeignKeysOk(db);
  });

  it("repeated materialization produces the same derived result", async () => {
    const db = createMigratedDb();
    seedNotification(db, "n1");
    seedFace(db, {
      id: "f1",
      notificationId: "n1",
      eventId: "event-1",
      seenAtMs: Date.parse(`${LOCAL_DATE}T14:00:00Z`),
      personKey: "id:alice",
      personName: "Alice",
    });
    seedFace(db, {
      id: "f2",
      notificationId: "n1",
      eventId: "event-2",
      seenAtMs: Date.parse(`${LOCAL_DATE}T14:05:00Z`),
      personKey: "id:alice",
      personName: "Alice",
    });

    const env = createTestEnv(db);
    await generateDailyReport(env, LOCAL_DATE, { force: true });
    const firstReports = await getReportsForMonth(env, MONTH);
    const firstSessions = await getSessionsForDate(env, LOCAL_DATE);

    await generateDailyReport(env, LOCAL_DATE, { force: true });
    const secondReports = await getReportsForMonth(env, MONTH);
    const secondSessions = await getSessionsForDate(env, LOCAL_DATE);

    expect(secondReports.map(({ generated_at_ms: _g, ...rest }) => rest)).toEqual(
      firstReports.map(({ generated_at_ms: _g, ...rest }) => rest)
    );
    expect(secondSessions.map(({ id: _id, generated_at_ms: _g, ...rest }) => rest)).toEqual(
      firstSessions.map(({ id: _id, generated_at_ms: _g, ...rest }) => rest)
    );
  });

  it("skips rewrite when materialization is already fresh", async () => {
    const db = createMigratedDb();
    seedNotification(db, "n1");
    seedFace(db, {
      id: "f1",
      notificationId: "n1",
      eventId: "event-1",
      seenAtMs: Date.parse(`${LOCAL_DATE}T14:00:00Z`),
      personKey: "id:alice",
      personName: "Alice",
    });

    const env = createTestEnv(db);
    expect((await generateDailyReport(env, LOCAL_DATE)).regenerated).toBe(true);
    const stateBefore = db
      .prepare(`SELECT generated_at_ms FROM materialization_state WHERE local_date = ?`)
      .get(LOCAL_DATE) as { generated_at_ms: number };

    expect((await generateDailyReport(env, LOCAL_DATE)).regenerated).toBe(false);
    const stateAfter = db
      .prepare(`SELECT generated_at_ms FROM materialization_state WHERE local_date = ?`)
      .get(LOCAL_DATE) as { generated_at_ms: number };
    expect(stateAfter.generated_at_ms).toBe(stateBefore.generated_at_ms);

    const month = await ensureReportsForMonth(env, MONTH);
    expect(month.checked).toBe(1);
    expect(month.regenerated).toBe(0);
    assertForeignKeysOk(db);
  });
});
