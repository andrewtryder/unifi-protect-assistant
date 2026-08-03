/** Consider webhook ingestion stale if nothing received for this long */
export const WEBHOOK_STALE_MS = 6 * 60 * 60 * 1000;

/** Cleanup is expected at least once per ~36h (daily cron + slack) */
export const CLEANUP_STALE_MS = 36 * 60 * 60 * 1000;

/** Materializer version — bump when derived report semantics change */
export const MATERIALIZER_VERSION = 2;

export const OPS_KEYS = {
  lastCronReportAt: "ops:last_cron_report_at_ms",
  lastCronReportDate: "ops:last_cron_report_date",
  lastCleanupAt: "ops:last_cleanup_at_ms",
  lastCleanupSummary: "ops:last_cleanup_summary",
  lastFkCheckAt: "ops:last_fk_check_at_ms",
  lastFkCheckOk: "ops:last_fk_check_ok",
  lastD1ErrorAt: "ops:last_d1_error_at_ms",
  lastD1Error: "ops:last_d1_error",
  lastCronError: "ops:last_cron_error",
} as const;
