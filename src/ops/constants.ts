/** Consider webhook ingestion stale if nothing received for this long */
export const WEBHOOK_STALE_MS = 6 * 60 * 60 * 1000;

/** Keep daily ops counter keys roughly in line with webhook retention */
export const OPS_COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60;

export const OPS_KEYS = {
  lastCronReportAt: "ops:last_cron_report_at_ms",
  lastCronReportDate: "ops:last_cron_report_date",
  lastCleanupAt: "ops:last_cleanup_at_ms",
  lastCleanupSummary: "ops:last_cleanup_summary",
  lastD1ErrorAt: "ops:last_d1_error_at_ms",
  lastD1Error: "ops:last_d1_error",
  lastCronError: "ops:last_cron_error",
} as const;

export function countersKeyForDate(localDate: string): string {
  return `ops:counters:${localDate}`;
}
