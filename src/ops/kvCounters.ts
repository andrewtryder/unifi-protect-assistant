import type { Env } from "../types.js";
import { getLocalDate } from "../webhook/parser.js";
import { OPS_KEYS } from "./constants.js";

export type OpsCounterField =
  | "rejected_auth"
  | "rejected_json"
  | "rejected_body"
  | "ingested_webhooks"
  | "events_attempted"
  | "events_inserted"
  | "duplicates"
  | "vehicles_attempted"
  | "vehicles_inserted"
  | "vehicle_duplicates"
  | "zero_face_webhooks"
  | "d1_failures";

export interface DailyOpsCounters {
  rejected_auth: number;
  rejected_json: number;
  rejected_body: number;
  ingested_webhooks: number;
  events_attempted: number;
  events_inserted: number;
  duplicates: number;
  vehicles_attempted: number;
  vehicles_inserted: number;
  vehicle_duplicates: number;
  zero_face_webhooks: number;
  d1_failures: number;
}

export function emptyCounters(): DailyOpsCounters {
  return {
    rejected_auth: 0,
    rejected_json: 0,
    rejected_body: 0,
    ingested_webhooks: 0,
    events_attempted: 0,
    events_inserted: 0,
    duplicates: 0,
    vehicles_attempted: 0,
    vehicles_inserted: 0,
    vehicle_duplicates: 0,
    zero_face_webhooks: 0,
    d1_failures: 0,
  };
}

/** Pure merge for tests */
export function mergeCounters(
  base: DailyOpsCounters,
  field: OpsCounterField,
  n: number = 1
): DailyOpsCounters {
  return { ...base, [field]: (base[field] || 0) + n };
}

export function parseCountersJson(raw: string | null): DailyOpsCounters {
  if (!raw) return emptyCounters();
  try {
    const parsed = JSON.parse(raw) as Partial<DailyOpsCounters>;
    return { ...emptyCounters(), ...parsed };
  } catch {
    return emptyCounters();
  }
}

function counterDay(env: Env, nowMs: number = Date.now()): string {
  return getLocalDate(nowMs, env.TIMEZONE || "America/New_York");
}

/**
 * Atomic counter increment via D1 UPSERT.
 * Falls back to no-op logging if the ops table is missing (pre-migration).
 */
export async function incrementCounter(
  env: Env,
  field: OpsCounterField,
  n: number = 1,
  nowMs: number = Date.now()
): Promise<void> {
  const date = counterDay(env, nowMs);
  await env.DB.prepare(
    `
    INSERT INTO ops_daily_counters (local_date, field, value)
    VALUES (?, ?, ?)
    ON CONFLICT(local_date, field)
    DO UPDATE SET value = value + excluded.value
  `
  )
    .bind(date, field, n)
    .run();
}

export async function getCountersForDate(env: Env, localDate: string): Promise<DailyOpsCounters> {
  const { results } = await env.DB.prepare(
    `SELECT field, value FROM ops_daily_counters WHERE local_date = ?`
  )
    .bind(localDate)
    .all<{ field: string; value: number }>();

  const counters = emptyCounters();
  for (const row of results || []) {
    if (row.field in counters) {
      (counters as unknown as Record<string, number>)[row.field] = row.value;
    }
  }
  return counters;
}

export async function getTodayCounters(env: Env, nowMs?: number): Promise<DailyOpsCounters> {
  return getCountersForDate(env, counterDay(env, nowMs));
}

export async function setCronReportOk(
  env: Env,
  reportDate: string,
  atMs: number = Date.now()
): Promise<void> {
  await env.KV.put(OPS_KEYS.lastCronReportAt, String(atMs));
  await env.KV.put(OPS_KEYS.lastCronReportDate, reportDate);
  await env.KV.delete(OPS_KEYS.lastCronError);
}

export async function setCleanupOk(
  env: Env,
  summary: Record<string, number>,
  atMs: number = Date.now()
): Promise<void> {
  await env.KV.put(OPS_KEYS.lastCleanupAt, String(atMs));
  await env.KV.put(OPS_KEYS.lastCleanupSummary, JSON.stringify(summary));
}

export async function setFkCheckOk(env: Env, atMs: number = Date.now()): Promise<void> {
  await env.KV.put(OPS_KEYS.lastFkCheckAt, String(atMs));
  await env.KV.put(OPS_KEYS.lastFkCheckOk, "1");
}

export async function setD1Error(
  env: Env,
  code: string,
  operation: string,
  atMs: number = Date.now()
): Promise<void> {
  const safeCode = code.slice(0, 64);
  const safeOp = operation.slice(0, 64);
  await env.KV.put(OPS_KEYS.lastD1ErrorAt, String(atMs));
  await env.KV.put(
    OPS_KEYS.lastD1Error,
    JSON.stringify({ code: safeCode, operation: safeOp, at_ms: atMs })
  );
}

export async function setCronError(
  env: Env,
  code: string,
  operation: string,
  atMs: number = Date.now()
): Promise<void> {
  await env.KV.put(
    OPS_KEYS.lastCronError,
    JSON.stringify({ at_ms: atMs, code: code.slice(0, 64), operation: operation.slice(0, 64) })
  );
}

export type StoredErrorMarker = {
  at_ms: number;
  code: string;
  operation: string;
  /** Redacted legacy message field — never raw SQL */
  message?: string;
};

function parseErrorMarker(raw: string | null): StoredErrorMarker | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredErrorMarker> & { message?: string };
    if (typeof parsed === "object" && parsed) {
      return {
        at_ms: typeof parsed.at_ms === "number" ? parsed.at_ms : Date.now(),
        code: typeof parsed.code === "string" ? parsed.code : "UNKNOWN",
        operation: typeof parsed.operation === "string" ? parsed.operation : "unknown",
        message: typeof parsed.message === "string" ? "[redacted]" : undefined,
      };
    }
  } catch {
    // Legacy plain-string markers
    return { at_ms: Date.now(), code: "LEGACY", operation: "unknown", message: "[redacted]" };
  }
  return null;
}

export async function readOpsMarkers(env: Env): Promise<{
  last_cron_report_at_ms: number | null;
  last_cron_report_date: string | null;
  last_cleanup_at_ms: number | null;
  last_cleanup_summary: Record<string, number> | null;
  last_fk_check_at_ms: number | null;
  last_fk_check_ok: boolean | null;
  last_d1_error_at_ms: number | null;
  last_d1_error: StoredErrorMarker | null;
  last_cron_error: StoredErrorMarker | null;
}> {
  const [reportAt, reportDate, cleanupAt, cleanupSummary, fkAt, fkOk, d1At, d1Err, cronErr] =
    await Promise.all([
      env.KV.get(OPS_KEYS.lastCronReportAt),
      env.KV.get(OPS_KEYS.lastCronReportDate),
      env.KV.get(OPS_KEYS.lastCleanupAt),
      env.KV.get(OPS_KEYS.lastCleanupSummary),
      env.KV.get(OPS_KEYS.lastFkCheckAt),
      env.KV.get(OPS_KEYS.lastFkCheckOk),
      env.KV.get(OPS_KEYS.lastD1ErrorAt),
      env.KV.get(OPS_KEYS.lastD1Error),
      env.KV.get(OPS_KEYS.lastCronError),
    ]);

  let last_cleanup_summary: Record<string, number> | null = null;
  if (cleanupSummary) {
    try {
      last_cleanup_summary = JSON.parse(cleanupSummary) as Record<string, number>;
    } catch {
      last_cleanup_summary = null;
    }
  }

  const d1Marker = parseErrorMarker(d1Err);
  const cronMarker = parseErrorMarker(cronErr);

  return {
    last_cron_report_at_ms: reportAt ? Number(reportAt) : null,
    last_cron_report_date: reportDate,
    last_cleanup_at_ms: cleanupAt ? Number(cleanupAt) : null,
    last_cleanup_summary,
    last_fk_check_at_ms: fkAt ? Number(fkAt) : null,
    last_fk_check_ok: fkOk == null ? null : fkOk === "1",
    last_d1_error_at_ms: d1At ? Number(d1At) : (d1Marker?.at_ms ?? null),
    last_d1_error: d1Marker,
    last_cron_error: cronMarker,
  };
}

/** Classify DB errors into stable codes without leaking SQL text. */
export function classifyDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/i.test(msg)) return "D1_FK_CONSTRAINT";
  if (/UNIQUE|SQLITE_CONSTRAINT_UNIQUE/i.test(msg)) return "D1_UNIQUE_CONSTRAINT";
  if (/NOT NULL|SQLITE_CONSTRAINT_NOTNULL/i.test(msg)) return "D1_NOTNULL_CONSTRAINT";
  if (/CHECK|SQLITE_CONSTRAINT_CHECK/i.test(msg)) return "D1_CHECK_CONSTRAINT";
  if (/SQLITE_CONSTRAINT/i.test(msg)) return "D1_CONSTRAINT";
  if (/D1_ERROR/i.test(msg)) return "D1_ERROR";
  return "D1_FAILURE";
}
