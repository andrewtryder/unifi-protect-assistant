import type { Env, HealthSnapshot } from "../types.js";
import { getLocalDate } from "../webhook/parser.js";
import { getHealthDbFacts } from "../db/queries.js";
import { getTodayCounters, readOpsMarkers } from "./kvCounters.js";
import { getConfigWarnings } from "./configWarnings.js";
import { WEBHOOK_STALE_MS } from "./constants.js";

export async function buildHealthSnapshot(
  env: Env,
  nowMs: number = Date.now()
): Promise<HealthSnapshot> {
  const timezone = env.TIMEZONE || "America/New_York";
  const localDate = getLocalDate(nowMs, timezone);

  const [facts, today_counters, markers, config_warnings] = await Promise.all([
    getHealthDbFacts(env, nowMs),
    getTodayCounters(env, nowMs),
    readOpsMarkers(env),
    Promise.resolve(getConfigWarnings(env)),
  ]);

  const webhook_healthy =
    facts.last_webhook_at_ms != null && nowMs - facts.last_webhook_at_ms <= WEBHOOK_STALE_MS;

  return {
    generated_at_ms: nowMs,
    local_date: localDate,
    last_webhook_at_ms: facts.last_webhook_at_ms,
    last_event_at_ms: facts.last_event_at_ms,
    webhook_healthy,
    events_last_hour: facts.events_last_hour,
    events_last_day: facts.events_last_day,
    webhooks_last_hour: facts.webhooks_last_hour,
    webhooks_last_day: facts.webhooks_last_day,
    today_counters,
    last_cron_report_at_ms: markers.last_cron_report_at_ms,
    last_cron_report_date: markers.last_cron_report_date,
    last_cleanup_at_ms: markers.last_cleanup_at_ms,
    last_cleanup_summary: markers.last_cleanup_summary,
    last_d1_error_at_ms: markers.last_d1_error_at_ms,
    last_d1_error: markers.last_d1_error,
    last_cron_error: markers.last_cron_error,
    db_usage: facts.db_usage,
    config_warnings,
  };
}
