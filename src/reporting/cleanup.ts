import { Env } from "../types.js";

export const RAW_RETENTION_DAYS = 30;
export const NORMALIZED_RETENTION_DAYS = 365;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Safe empty JSON for NOT NULL raw payload / trigger columns after scrubbing. */
export const SCRUBBED_JSON = "{}";

export interface RetentionCleanupSummary {
  scrubbedNotifications: number;
  scrubbedFaceEvents: number;
  scrubbedVehicleEvents: number;
  deletedNotifications: number;
  deletedFaceEvents: number;
  deletedVehicleEvents: number;
  deletedReports: number;
  deletedSessions: number;
}

export function retentionCutoffs(nowMs: number = Date.now()): {
  rawCutoffMs: number;
  normalizedCutoffMs: number;
} {
  return {
    rawCutoffMs: nowMs - RAW_RETENTION_DAYS * DAY_MS,
    normalizedCutoffMs: nowMs - NORMALIZED_RETENTION_DAYS * DAY_MS,
  };
}

/**
 * Retention policy:
 * 1. Scrub raw/biometric blobs older than ~30 days (keep required NOT NULL columns as {}).
 * 2. Delete normalized rows older than ~365 days.
 * 3. Delete expired webhook notification metadata (children keep rows via ON DELETE SET NULL).
 *
 * Ordering is intentional so FK integrity holds throughout.
 */
export async function runRetentionCleanup(
  env: Env,
  nowMs: number = Date.now()
): Promise<RetentionCleanupSummary> {
  const { rawCutoffMs, normalizedCutoffMs } = retentionCutoffs(nowMs);

  const scrubNotifications = await env.DB.prepare(
    `
    UPDATE webhook_notifications
    SET payload_json = ?,
        image_base64 = NULL
    WHERE received_at_ms < ?
      AND (payload_json != ? OR image_base64 IS NOT NULL)
  `
  )
    .bind(SCRUBBED_JSON, rawCutoffMs, SCRUBBED_JSON)
    .run();

  const scrubFaces = await env.DB.prepare(
    `
    UPDATE face_events
    SET raw_trigger_json = ?,
        image_base64 = NULL
    WHERE seen_at_ms < ?
      AND (raw_trigger_json != ? OR image_base64 IS NOT NULL)
  `
  )
    .bind(SCRUBBED_JSON, rawCutoffMs, SCRUBBED_JSON)
    .run();

  const scrubVehicles = await env.DB.prepare(
    `
    UPDATE vehicle_events
    SET raw_trigger_json = ?,
        image_base64 = NULL
    WHERE seen_at_ms < ?
      AND (raw_trigger_json != ? OR image_base64 IS NOT NULL)
  `
  )
    .bind(SCRUBBED_JSON, rawCutoffMs, SCRUBBED_JSON)
    .run();

  const deleteFaces = await env.DB.prepare(
    `
    DELETE FROM face_events
    WHERE seen_at_ms < ?
  `
  )
    .bind(normalizedCutoffMs)
    .run();

  const deleteVehicles = await env.DB.prepare(
    `
    DELETE FROM vehicle_events
    WHERE seen_at_ms < ?
  `
  )
    .bind(normalizedCutoffMs)
    .run();

  const deleteReports = await env.DB.prepare(
    `
    DELETE FROM daily_person_reports
    WHERE first_seen_ms < ?
  `
  )
    .bind(normalizedCutoffMs)
    .run();

  const deleteSessions = await env.DB.prepare(
    `
    DELETE FROM presence_sessions
    WHERE started_at_ms < ?
  `
  )
    .bind(normalizedCutoffMs)
    .run();

  await env.DB.prepare(
    `
    DELETE FROM materialization_state
    WHERE local_date NOT IN (SELECT DISTINCT local_date FROM face_events)
  `
  )
    .run()
    .catch(() => undefined);

  const deleteNotifications = await env.DB.prepare(
    `
    DELETE FROM webhook_notifications
    WHERE received_at_ms < ?
  `
  )
    .bind(rawCutoffMs)
    .run();

  return {
    scrubbedNotifications: scrubNotifications.meta?.changes ?? 0,
    scrubbedFaceEvents: scrubFaces.meta?.changes ?? 0,
    scrubbedVehicleEvents: scrubVehicles.meta?.changes ?? 0,
    deletedNotifications: deleteNotifications.meta?.changes ?? 0,
    deletedFaceEvents: deleteFaces.meta?.changes ?? 0,
    deletedVehicleEvents: deleteVehicles.meta?.changes ?? 0,
    deletedReports: deleteReports.meta?.changes ?? 0,
    deletedSessions: deleteSessions.meta?.changes ?? 0,
  };
}
