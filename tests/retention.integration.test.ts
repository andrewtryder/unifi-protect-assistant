import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  applyMigrations,
  assertForeignKeysOk,
  createMigratedDb,
  createPreMigrationDb,
  createTestEnv,
  foreignKeyViolations,
  MIGRATIONS_DIR,
  wrapD1,
  type SqliteDb,
} from "./helpers/sqliteHarness.js";
import {
  DAY_MS,
  RAW_RETENTION_DAYS,
  NORMALIZED_RETENTION_DAYS,
  SCRUBBED_JSON,
  runRetentionCleanup,
} from "../src/reporting/cleanup.js";
import { getLocalDate } from "../src/webhook/parser.js";

const TZ = "America/New_York";
const NOW_MS = Date.UTC(2026, 7, 3, 18, 0, 0); // fixed: 2026-08-03 ~18:00 UTC

function daysAgo(days: number): number {
  return NOW_MS - days * DAY_MS;
}

function localDateFor(ms: number): string {
  return getLocalDate(ms, TZ);
}

function insertNotification(
  db: SqliteDb,
  opts: {
    id: string;
    receivedAtMs: number;
    eventId?: string;
    payload?: string;
    image?: string | null;
    deliveryKey?: string;
  }
): void {
  const hasDelivery = db
    .prepare(
      `SELECT 1 AS ok FROM pragma_table_info('webhook_notifications') WHERE name = 'delivery_key'`
    )
    .get() as { ok: number } | undefined;

  if (hasDelivery) {
    db.prepare(
      `
      INSERT INTO webhook_notifications (
        id, received_at_ms, source_ip, event_id, alarm_name, payload_json, image_base64, delivery_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      opts.id,
      opts.receivedAtMs,
      "127.0.0.1",
      opts.eventId ?? `evt-${opts.id}`,
      "Test Alarm",
      opts.payload ?? JSON.stringify({ alarm: "raw" }),
      opts.image ?? "img-bytes",
      opts.deliveryKey ?? opts.id
    );
  } else {
    db.prepare(
      `
      INSERT INTO webhook_notifications (
        id, received_at_ms, source_ip, event_id, alarm_name, payload_json, image_base64
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      opts.id,
      opts.receivedAtMs,
      "127.0.0.1",
      opts.eventId ?? `evt-${opts.id}`,
      "Test Alarm",
      opts.payload ?? JSON.stringify({ alarm: "raw" }),
      opts.image ?? "img-bytes"
    );
  }
}

function insertFace(
  db: SqliteDb,
  opts: {
    id: string;
    notificationId: string | null;
    eventId: string;
    seenAtMs: number;
    personKey?: string;
    personName?: string;
    raw?: string;
    image?: string | null;
  }
): void {
  db.prepare(
    `
    INSERT INTO face_events (
      id, notification_id, event_id, seen_at_ms, local_date,
      person_key, person_name, person_id, trigger_key, camera_id,
      alarm_name, raw_trigger_json, image_base64
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    opts.id,
    opts.notificationId,
    opts.eventId,
    opts.seenAtMs,
    localDateFor(opts.seenAtMs),
    opts.personKey ?? "id:alice",
    opts.personName ?? "Alice",
    "alice",
    "face_known",
    "cam-1",
    "Face Alarm",
    opts.raw ?? JSON.stringify({ trigger: "face" }),
    opts.image === undefined ? "face-img" : opts.image
  );
}

function insertVehicle(
  db: SqliteDb,
  opts: {
    id: string;
    notificationId: string | null;
    eventId: string;
    seenAtMs: number;
    plateKey?: string;
    raw?: string;
    image?: string | null;
  }
): void {
  db.prepare(
    `
    INSERT INTO vehicle_events (
      id, notification_id, event_id, seen_at_ms, local_date,
      plate_key, plate_text, trigger_key, camera_id,
      alarm_name, raw_trigger_json, image_base64
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    opts.id,
    opts.notificationId,
    opts.eventId,
    opts.seenAtMs,
    localDateFor(opts.seenAtMs),
    opts.plateKey ?? "plate:ABC123",
    "ABC123",
    "license_plate_known",
    "cam-2",
    "Plate Alarm",
    opts.raw ?? JSON.stringify({ trigger: "plate" }),
    opts.image === undefined ? "vehicle-img" : opts.image
  );
}

function insertReport(db: SqliteDb, firstSeenMs: number, personKey: string): void {
  const localDate = localDateFor(firstSeenMs);
  db.prepare(
    `
    INSERT INTO daily_person_reports (
      local_date, person_key, person_name, first_seen_ms, last_seen_ms,
      raw_span_seconds, rounded_span_minutes, rounded_span_hours,
      first_event_id, last_event_id, first_camera_id, last_camera_id,
      seen_count, generated_at_ms
    ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 'cam-1', 'cam-1', 1, ?)
  `
  ).run(
    localDate,
    personKey,
    personKey,
    firstSeenMs,
    firstSeenMs,
    `fe-${personKey}`,
    `fe-${personKey}`,
    NOW_MS
  );
}

function insertSession(db: SqliteDb, startedAtMs: number, personKey: string): void {
  const localDate = localDateFor(startedAtMs);
  db.prepare(
    `
    INSERT INTO presence_sessions (
      id, local_date, person_key, person_name,
      started_at_ms, ended_at_ms, duration_seconds, rounded_duration_minutes,
      sighting_count, first_event_id, last_event_id,
      first_camera_id, last_camera_id, is_open, generated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, 60, 15, 1, ?, ?, 'cam-1', 'cam-1', 0, ?)
  `
  ).run(
    `sess-${personKey}-${startedAtMs}`,
    localDate,
    personKey,
    personKey,
    startedAtMs,
    startedAtMs + 60_000,
    `fe-${personKey}`,
    `fe-${personKey}`,
    NOW_MS
  );
}

function count(db: SqliteDb, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return row.c;
}

function fkEnabled(db: SqliteDb): boolean {
  const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  return row.foreign_keys === 1;
}

describe("SQLite retention integration", () => {
  it("enables FK enforcement and applies every migration in order", () => {
    const db = createMigratedDb();
    expect(fkEnabled(db)).toBe(true);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN (
          'webhook_notifications','face_events','vehicle_events',
          'daily_person_reports','presence_sessions','materialization_state','ops_daily_counters'
        )`
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(
      [
        "daily_person_reports",
        "face_events",
        "materialization_state",
        "ops_daily_counters",
        "presence_sessions",
        "vehicle_events",
        "webhook_notifications",
      ].sort()
    );
    assertForeignKeysOk(db);
  });

  it("upgrades pre-0008 schema preserving rows and ON DELETE SET NULL", () => {
    const db = createPreMigrationDb();
    expect(fkEnabled(db)).toBe(true);

    insertNotification(db, { id: "n-legacy", receivedAtMs: daysAgo(10) });
    insertFace(db, {
      id: "f-legacy",
      notificationId: "n-legacy",
      eventId: "face-legacy",
      seenAtMs: daysAgo(10),
    });
    insertVehicle(db, {
      id: "v-legacy",
      notificationId: "n-legacy",
      eventId: "veh-legacy",
      seenAtMs: daysAgo(10),
    });

    const beforeFaces = count(db, "face_events");
    const beforeVehicles = count(db, "vehicle_events");
    const beforeNotifs = count(db, "webhook_notifications");

    const migration0008 = readFileSync(join(MIGRATIONS_DIR, "0008_retention_fk_ops.sql"), "utf8");
    db.exec(migration0008);
    db.exec("PRAGMA foreign_keys = ON");

    expect(count(db, "face_events")).toBe(beforeFaces);
    expect(count(db, "vehicle_events")).toBe(beforeVehicles);
    expect(count(db, "webhook_notifications")).toBe(beforeNotifs);
    assertForeignKeysOk(db);

    db.prepare(`DELETE FROM webhook_notifications WHERE id = ?`).run("n-legacy");
    const face = db
      .prepare(`SELECT notification_id FROM face_events WHERE id = ?`)
      .get("f-legacy") as {
      notification_id: string | null;
    };
    const vehicle = db
      .prepare(`SELECT notification_id FROM vehicle_events WHERE id = ?`)
      .get("v-legacy") as { notification_id: string | null };
    expect(face.notification_id).toBeNull();
    expect(vehicle.notification_id).toBeNull();
    assertForeignKeysOk(db);
  });

  it("runs retention cleanup with scrub, SET NULL, and age-based deletes", async () => {
    const db = createMigratedDb();
    expect(fkEnabled(db)).toBe(true);

    // Shared parent with both children (31d) — scrub + delete parent, children remain
    insertNotification(db, {
      id: "n-31",
      receivedAtMs: daysAgo(31),
      payload: JSON.stringify({ keep: "raw-31" }),
      image: "notif-31-img",
    });
    insertFace(db, {
      id: "f-31",
      notificationId: "n-31",
      eventId: "face-31",
      seenAtMs: daysAgo(31),
      personKey: "id:scrub-31",
      raw: JSON.stringify({ face: 31 }),
      image: "face-31-img",
    });
    insertVehicle(db, {
      id: "v-31",
      notificationId: "n-31",
      eventId: "veh-31",
      seenAtMs: daysAgo(31),
      plateKey: "plate:SCRUB31",
      raw: JSON.stringify({ veh: 31 }),
      image: "veh-31-img",
    });

    // 29d — within raw retention; payloads and FKs stay
    insertNotification(db, {
      id: "n-29",
      receivedAtMs: daysAgo(29),
      payload: JSON.stringify({ keep: "raw-29" }),
      image: "notif-29-img",
    });
    insertFace(db, {
      id: "f-29",
      notificationId: "n-29",
      eventId: "face-29",
      seenAtMs: daysAgo(29),
      personKey: "id:keep-29",
      raw: JSON.stringify({ face: 29 }),
      image: "face-29-img",
    });
    insertVehicle(db, {
      id: "v-29",
      notificationId: "n-29",
      eventId: "veh-29",
      seenAtMs: daysAgo(29),
      plateKey: "plate:KEEP29",
      raw: JSON.stringify({ veh: 29 }),
      image: "veh-29-img",
    });

    // 364d — normalized retained, raw scrubbed, parent gone → notification_id NULL
    insertNotification(db, { id: "n-364", receivedAtMs: daysAgo(364) });
    insertFace(db, {
      id: "f-364",
      notificationId: "n-364",
      eventId: "face-364",
      seenAtMs: daysAgo(364),
      personKey: "id:keep-364",
      raw: JSON.stringify({ face: 364 }),
      image: "face-364-img",
    });
    insertVehicle(db, {
      id: "v-364",
      notificationId: "n-364",
      eventId: "veh-364",
      seenAtMs: daysAgo(364),
      plateKey: "plate:KEEP364",
      raw: JSON.stringify({ veh: 364 }),
      image: "veh-364-img",
    });

    // 366d — normalized deleted
    insertNotification(db, { id: "n-366", receivedAtMs: daysAgo(366) });
    insertFace(db, {
      id: "f-366",
      notificationId: "n-366",
      eventId: "face-366",
      seenAtMs: daysAgo(366),
      personKey: "id:drop-366",
    });
    insertVehicle(db, {
      id: "v-366",
      notificationId: "n-366",
      eventId: "veh-366",
      seenAtMs: daysAgo(366),
      plateKey: "plate:DROP366",
    });

    // Expired derived rows
    insertReport(db, daysAgo(366), "id:expired-report");
    insertSession(db, daysAgo(366), "id:expired-session");
    // Fresh derived rows should survive
    insertReport(db, daysAgo(10), "id:fresh-report");
    insertSession(db, daysAgo(10), "id:fresh-session");

    const env = createTestEnv(db);
    const summary = await runRetentionCleanup(env, NOW_MS);

    expect(summary.deletedFaceEvents).toBeGreaterThanOrEqual(1);
    expect(summary.deletedVehicleEvents).toBeGreaterThanOrEqual(1);
    expect(summary.deletedNotifications).toBeGreaterThanOrEqual(1);
    expect(summary.deletedReports).toBeGreaterThanOrEqual(1);
    expect(summary.deletedSessions).toBeGreaterThanOrEqual(1);

    // 29d intact
    const face29 = db.prepare(`SELECT * FROM face_events WHERE id = ?`).get("f-29") as {
      notification_id: string;
      raw_trigger_json: string;
      image_base64: string | null;
    };
    expect(face29.notification_id).toBe("n-29");
    expect(face29.raw_trigger_json).toContain("29");
    expect(face29.image_base64).toBe("face-29-img");
    expect(
      (
        db.prepare(`SELECT id FROM webhook_notifications WHERE id = ?`).get("n-29") as {
          id: string;
        } | null
      )?.id
    ).toBe("n-29");

    // 31d scrubbed + parent removed + SET NULL
    const face31 = db.prepare(`SELECT * FROM face_events WHERE id = ?`).get("f-31") as {
      notification_id: string | null;
      raw_trigger_json: string;
      image_base64: string | null;
    };
    const veh31 = db.prepare(`SELECT * FROM vehicle_events WHERE id = ?`).get("v-31") as {
      notification_id: string | null;
      raw_trigger_json: string;
      image_base64: string | null;
    };
    expect(face31).toBeTruthy();
    expect(veh31).toBeTruthy();
    expect(face31.raw_trigger_json).toBe(SCRUBBED_JSON);
    expect(face31.image_base64).toBeNull();
    expect(veh31.raw_trigger_json).toBe(SCRUBBED_JSON);
    expect(veh31.image_base64).toBeNull();
    expect(face31.notification_id).toBeNull();
    expect(veh31.notification_id).toBeNull();
    expect(
      db.prepare(`SELECT id FROM webhook_notifications WHERE id = ?`).get("n-31")
    ).toBeUndefined();

    // 364d retained + scrubbed + null FK
    const face364 = db.prepare(`SELECT * FROM face_events WHERE id = ?`).get("f-364") as {
      notification_id: string | null;
      raw_trigger_json: string;
      image_base64: string | null;
    };
    expect(face364).toBeTruthy();
    expect(face364.notification_id).toBeNull();
    expect(face364.raw_trigger_json).toBe(SCRUBBED_JSON);
    expect(face364.image_base64).toBeNull();
    expect(db.prepare(`SELECT id FROM vehicle_events WHERE id = ?`).get("v-364")).toBeTruthy();

    // 366d gone
    expect(db.prepare(`SELECT id FROM face_events WHERE id = ?`).get("f-366")).toBeUndefined();
    expect(db.prepare(`SELECT id FROM vehicle_events WHERE id = ?`).get("v-366")).toBeUndefined();

    // Expired reports/sessions gone; fresh remain
    expect(
      db
        .prepare(`SELECT person_key FROM daily_person_reports WHERE person_key = ?`)
        .get("id:expired-report")
    ).toBeUndefined();
    expect(
      db
        .prepare(`SELECT person_key FROM presence_sessions WHERE person_key = ?`)
        .get("id:expired-session")
    ).toBeUndefined();
    expect(
      db
        .prepare(`SELECT person_key FROM daily_person_reports WHERE person_key = ?`)
        .get("id:fresh-report")
    ).toBeTruthy();
    expect(
      db
        .prepare(`SELECT person_key FROM presence_sessions WHERE person_key = ?`)
        .get("id:fresh-session")
    ).toBeTruthy();

    expect(foreignKeyViolations(db)).toEqual([]);
    assertForeignKeysOk(db);

    // Idempotent second pass
    const summary2 = await runRetentionCleanup(env, NOW_MS);
    expect(summary2.scrubbedNotifications).toBe(0);
    expect(summary2.scrubbedFaceEvents).toBe(0);
    expect(summary2.scrubbedVehicleEvents).toBe(0);
    expect(summary2.deletedNotifications).toBe(0);
    expect(summary2.deletedFaceEvents).toBe(0);
    expect(summary2.deletedVehicleEvents).toBe(0);
    expect(summary2.deletedReports).toBe(0);
    expect(summary2.deletedSessions).toBe(0);
    expect(foreignKeyViolations(db)).toEqual([]);
  });

  it("migration integrity: full migrate FK check empty; upgrade preserves counts", () => {
    const full = createMigratedDb();
    expect(foreignKeyViolations(full)).toEqual([]);

    const pre = createPreMigrationDb();
    insertNotification(pre, { id: "n-up", receivedAtMs: daysAgo(5) });
    insertFace(pre, {
      id: "f-up",
      notificationId: "n-up",
      eventId: "face-up",
      seenAtMs: daysAgo(5),
    });
    insertVehicle(pre, {
      id: "v-up",
      notificationId: "n-up",
      eventId: "veh-up",
      seenAtMs: daysAgo(5),
    });
    const counts = {
      n: count(pre, "webhook_notifications"),
      f: count(pre, "face_events"),
      v: count(pre, "vehicle_events"),
    };

    applyMigrations(pre, MIGRATIONS_DIR, (name) => name.startsWith("0008_"));
    expect(count(pre, "webhook_notifications")).toBe(counts.n);
    expect(count(pre, "face_events")).toBe(counts.f);
    expect(count(pre, "vehicle_events")).toBe(counts.v);
    expect(foreignKeyViolations(pre)).toEqual([]);
    expect(fkEnabled(pre)).toBe(true);

    // Adapter still usable post-upgrade
    const env = createTestEnv(pre);
    expect(env.DB).toBeTruthy();
    expect(wrapD1(pre)).toBeTruthy();
  });

  it("documents that ON CONFLICT(delivery_key) works with UNIQUE INDEX in node:sqlite", () => {
    const db = createMigratedDb();
    insertNotification(db, {
      id: "n-dk-1",
      receivedAtMs: NOW_MS,
      deliveryKey: "delivery-abc",
    });
    // UNIQUE INDEX (not a table UNIQUE constraint) is a valid conflict target in node:sqlite —
    // same behavior as D1, so ingest upserts on delivery_key do not need a separate table constraint.
    db.prepare(
      `
      INSERT INTO webhook_notifications (
        id, received_at_ms, source_ip, event_id, alarm_name, payload_json, delivery_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(delivery_key) DO UPDATE SET
        id = excluded.id,
        received_at_ms = excluded.received_at_ms,
        payload_json = excluded.payload_json
    `
    ).run("n-dk-2", NOW_MS + 1, "127.0.0.1", "e2", "Alarm", SCRUBBED_JSON, "delivery-abc");

    const rows = db
      .prepare(
        `SELECT id, delivery_key, received_at_ms FROM webhook_notifications WHERE delivery_key = ?`
      )
      .all("delivery-abc") as Array<{ id: string; delivery_key: string; received_at_ms: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("n-dk-2");
    expect(rows[0].received_at_ms).toBe(NOW_MS + 1);
  });
});

describe("retention cutoffs sanity", () => {
  it("uses 30 / 365 day windows", () => {
    expect(RAW_RETENTION_DAYS).toBe(30);
    expect(NORMALIZED_RETENTION_DAYS).toBe(365);
    expect(SCRUBBED_JSON).toBe("{}");
  });
});
