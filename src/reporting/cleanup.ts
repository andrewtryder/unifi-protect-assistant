import { Env } from "../types.js";

/**
 * Purges old data according to retention policy:
 * - raw webhook payloads older than 1 month
 * - normalized face events older than 12 months
 * - daily reports older than 12 months
 * - presence sessions older than 12 months
 */
export async function runRetentionCleanup(env: Env): Promise<{
  purgedNotifications: number;
  purgedEvents: number;
  purgedReports: number;
  purgedSessions: number;
}> {
  const now = Date.now();
  const oneMonthAgoMs = now - 30 * 24 * 60 * 60 * 1000;
  const twelveMonthsAgoMs = now - 365 * 24 * 60 * 60 * 1000;

  const deleteNotificationsStmt = env.DB.prepare(`
    DELETE FROM webhook_notifications
    WHERE received_at_ms < ?
  `).bind(oneMonthAgoMs);

  const deleteEventsStmt = env.DB.prepare(`
    DELETE FROM face_events
    WHERE seen_at_ms < ?
  `).bind(twelveMonthsAgoMs);

  const deleteReportsStmt = env.DB.prepare(`
    DELETE FROM daily_person_reports
    WHERE first_seen_ms < ?
  `).bind(twelveMonthsAgoMs);

  const deleteSessionsStmt = env.DB.prepare(`
    DELETE FROM presence_sessions
    WHERE started_at_ms < ?
  `).bind(twelveMonthsAgoMs);

  const results = await env.DB.batch([
    deleteNotificationsStmt,
    deleteEventsStmt,
    deleteReportsStmt,
    deleteSessionsStmt,
  ]);

  return {
    purgedNotifications: results[0].meta.changes || 0,
    purgedEvents: results[1].meta.changes || 0,
    purgedReports: results[2].meta.changes || 0,
    purgedSessions: results[3].meta.changes || 0,
  };
}
