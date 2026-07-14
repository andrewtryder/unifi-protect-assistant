/**
 * Rounds milliseconds up to the nearest 15-minute interval.
 */
export function roundToNearest15Mins(ms: number): {
  roundedMinutes: number;
  roundedHours: number;
} {
  const seconds = ms / 1000;
  const minutes = seconds / 60;

  const roundedMinutes = Math.ceil(minutes / 15) * 15;
  const roundedHours = Number((roundedMinutes / 60).toFixed(2));

  return { roundedMinutes, roundedHours };
}
