import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyMigrations,
  assertForeignKeysOk,
  createPreMigrationDb,
  foreignKeyViolations,
  MIGRATIONS_DIR,
  type SqliteDb,
} from "./helpers/sqliteHarness.js";

function seedBetterAuth(db: SqliteDb): void {
  const now = "2026-08-01T00:00:00.000Z";
  db.prepare(
    `
    INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run("user-1", "Test User", "test@example.com", 1, null, now, now);

  db.prepare(
    `
    INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run("sess-1", now, "token-1", now, now, "127.0.0.1", "vitest", "user-1");

  db.prepare(
    `
    INSERT INTO account (
      id, accountId, providerId, userId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    "acct-1",
    "google-sub",
    "google",
    "user-1",
    "access",
    "refresh",
    "id-token",
    now,
    now,
    "openid email",
    null,
    now,
    now
  );

  db.prepare(
    `
    INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run("ver-1", "test@example.com", "otp-value", now, now, now);
}

function seedApplicationRows(db: SqliteDb): void {
  db.prepare(
    `
    INSERT INTO webhook_notifications (
      id, received_at_ms, source_ip, event_id, alarm_name, payload_json, image_base64, delivery_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    "notif-1",
    Date.UTC(2026, 7, 1, 12, 0, 0),
    "127.0.0.1",
    "evt-parent",
    "Face Alarm",
    JSON.stringify({ alarm: "seed" }),
    "img",
    "notif-1"
  );

  db.prepare(
    `
    INSERT INTO face_events (
      id, notification_id, event_id, seen_at_ms, local_date,
      person_key, person_name, person_id, trigger_key, camera_id,
      alarm_name, raw_trigger_json, image_base64
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    "face-1",
    "notif-1",
    "evt-face-1",
    Date.UTC(2026, 7, 1, 12, 0, 1),
    "2026-08-01",
    "id:alice",
    "Alice",
    "alice",
    "face_known",
    "cam-1",
    "Face Alarm",
    JSON.stringify({ trigger: "face" }),
    "face-img"
  );
}

function tableNames(db: SqliteDb): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

describe("Better Auth removal migration (0009)", () => {
  it("drops Better Auth tables while preserving application data", () => {
    // 0001–0007 via harness, then 0008 so schema matches pre-drop production shape.
    const db = createPreMigrationDb();
    applyMigrations(db, MIGRATIONS_DIR, (name) => name.startsWith("0008"));

    const before = tableNames(db);
    expect(before.has("user")).toBe(true);
    expect(before.has("session")).toBe(true);
    expect(before.has("account")).toBe(true);
    expect(before.has("verification")).toBe(true);
    expect(before.has("face_events")).toBe(true);
    expect(before.has("webhook_notifications")).toBe(true);

    seedBetterAuth(db);
    seedApplicationRows(db);
    assertForeignKeysOk(db);

    const userCount = (db.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number }).c;
    expect(userCount).toBe(1);

    const dropSql = readFileSync(join(MIGRATIONS_DIR, "0009_drop_better_auth.sql"), "utf8");
    expect(dropSql).toMatch(/DROP TABLE IF EXISTS user/i);

    const applied9 = applyMigrations(db, MIGRATIONS_DIR, (name) => name.startsWith("0009"));
    expect(applied9).toEqual(["0009_drop_better_auth.sql"]);

    const after = tableNames(db);
    expect(after.has("user")).toBe(false);
    expect(after.has("session")).toBe(false);
    expect(after.has("account")).toBe(false);
    expect(after.has("verification")).toBe(false);
    expect(after.has("face_events")).toBe(true);
    expect(after.has("webhook_notifications")).toBe(true);

    expect(foreignKeyViolations(db)).toEqual([]);
    assertForeignKeysOk(db);

    const face = db
      .prepare("SELECT id, person_name, event_id FROM face_events WHERE id = ?")
      .get("face-1") as { id: string; person_name: string; event_id: string };
    expect(face).toEqual({
      id: "face-1",
      person_name: "Alice",
      event_id: "evt-face-1",
    });

    const notif = db
      .prepare("SELECT id, event_id FROM webhook_notifications WHERE id = ?")
      .get("notif-1") as { id: string; event_id: string };
    expect(notif).toEqual({ id: "notif-1", event_id: "evt-parent" });
  });
});
