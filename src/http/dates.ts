/** Calendar date validation beyond regex shape (rejects 2024-02-31 etc.). */
export function isValidMonthString(month: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const [y, m] = month.split("-").map(Number);
  return m >= 1 && m <= 12 && y >= 2000 && y <= 2100;
}

export function isValidLocalDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Safe path segment decode — returns null on malformed percent-encoding. */
export function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
