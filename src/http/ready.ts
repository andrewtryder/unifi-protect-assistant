import type { Env } from "../types.js";
import { jsonResponse, textResponse } from "./responses.js";

const REQUIRED_TABLES = [
  "webhook_notifications",
  "face_events",
  "vehicle_events",
  "daily_person_reports",
  "presence_sessions",
  "materialization_state",
  "ops_daily_counters",
] as const;

/**
 * Public readiness probe: verifies D1 connectivity and required schema.
 * Does not expose row counts, configuration, or PII.
 */
export async function handleReady(env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    )
      .bind("face_events")
      .first<{ name: string }>();

    if (!row?.name) {
      return jsonResponse({ status: "not_ready", reason: "schema" }, { status: 503 });
    }

    // Touch a few required tables without selecting user data
    for (const table of REQUIRED_TABLES) {
      await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 0`).run();
    }

    return jsonResponse({ status: "ready" }, { status: 200, noStore: true });
  } catch {
    return jsonResponse({ status: "not_ready", reason: "database" }, { status: 503 });
  }
}

export function handleReadyMethodNotAllowed(): Response {
  return textResponse("Method Not Allowed", {
    status: 405,
    extra: { Allow: "GET" },
  });
}
