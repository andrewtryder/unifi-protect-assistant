import type { Env } from "../types.js";
import { getLocalDate } from "../webhook/parser.js";
import { OPS_COUNTER_TTL_SECONDS, OPS_KEYS, countersKeyForDate } from "./constants.js";

export type OpsCounterField =
  | "rejected_auth"
  | "rejected_json"
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

/** Pure merge for tests and counter updates */
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

export async function getCountersForDate(
  env: Env,
  localDate: string
): Promise<DailyOpsCounters> {
  const raw = await env.KV.get(countersKeyForDate(localDate));
  return parseCountersJson(raw);
}

export async function getTodayCounters(env: Env, nowMs?: number): Promise<DailyOpsCounters> {
  return getCountersForDate(env, counterDay(env, nowMs));
}

export async function incrementCounter(
  env: Env,
  field: OpsCounterField,
  n: number = 1,
  nowMs: number = Date.now()
): Promise<DailyOpsCounters> {
  const date = counterDay(env, nowMs);
  const key = countersKeyForDate(date);
  const current = parseCountersJson(await env.KV.get(key));
  const next = mergeCounters(current, field, n);
  await env.KV.put(key, JSON.stringify(next), {
    expirationTtl: OPS_COUNTER_TTL_SECONDS,
  });
  return next;
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

export async function setD1Error(env: Env, message: string, atMs: number = Date.now()): Promise<void> {
  await env.KV.put(OPS_KEYS.lastD1ErrorAt, String(atMs));
  await env.KV.put(OPS_KEYS.lastD1Error, message.slice(0, 500));
}

export async function setCronError(env: Env, message: string, atMs: number = Date.now()): Promise<void> {
  await env.KV.put(OPS_KEYS.lastCronError, JSON.stringify({ at_ms: atMs, message: message.slice(0, 500) }));
}

export async function readOpsMarkers(env: Env): Promise<{
  last_cron_report_at_ms: number | null;
  last_cron_report_date: string | null;
  last_cleanup_at_ms: number | null;
  last_cleanup_summary: Record<string, number> | null;
  last_d1_error_at_ms: number | null;
  last_d1_error: string | null;
  last_cron_error: { at_ms: number; message: string } | null;
}> {
  const [
    reportAt,
    reportDate,
    cleanupAt,
    cleanupSummary,
    d1At,
    d1Err,
    cronErr,
  ] = await Promise.all([
    env.KV.get(OPS_KEYS.lastCronReportAt),
    env.KV.get(OPS_KEYS.lastCronReportDate),
    env.KV.get(OPS_KEYS.lastCleanupAt),
    env.KV.get(OPS_KEYS.lastCleanupSummary),
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

  let last_cron_error: { at_ms: number; message: string } | null = null;
  if (cronErr) {
    try {
      last_cron_error = JSON.parse(cronErr) as { at_ms: number; message: string };
    } catch {
      last_cron_error = null;
    }
  }

  return {
    last_cron_report_at_ms: reportAt ? Number(reportAt) : null,
    last_cron_report_date: reportDate,
    last_cleanup_at_ms: cleanupAt ? Number(cleanupAt) : null,
    last_cleanup_summary,
    last_d1_error_at_ms: d1At ? Number(d1At) : null,
    last_d1_error: d1Err,
    last_cron_error,
  };
}
