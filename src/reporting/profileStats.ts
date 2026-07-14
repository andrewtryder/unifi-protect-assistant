/**
 * Pure helpers for person profile stats (typical times, medians).
 */

export function median(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Minutes from local midnight in the given IANA timezone.
 */
export function minutesFromMidnight(ms: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

export function formatMinutesAsTime(minutes: number | null): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const total = Math.round(minutes) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * For each local_date, take the day's arrival (first start) and departure (last end),
 * convert to minutes-from-midnight, then return medians.
 */
export function typicalArrivalDeparture(
  dayWindows: Array<{ started_at_ms: number; ended_at_ms: number }>,
  timezone: string
): { arrivalMinutes: number | null; departureMinutes: number | null } {
  const arrivals = dayWindows.map((w) => minutesFromMidnight(w.started_at_ms, timezone));
  const departures = dayWindows.map((w) => minutesFromMidnight(w.ended_at_ms, timezone));
  return {
    arrivalMinutes: median(arrivals),
    departureMinutes: median(departures),
  };
}

export function localDateDaysAgo(fromDateStr: string, daysAgo: number): string {
  // Treat YYYY-MM-DD as UTC noon to avoid DST edge when shifting calendar days
  const [y, m, d] = fromDateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - daysAgo);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
