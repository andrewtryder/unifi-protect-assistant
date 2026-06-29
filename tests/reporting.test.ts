import { describe, it, expect } from "vitest";
import { getLocalDate } from "../src/webhook/parser.js";
import { roundToNearest15Mins } from "../src/reporting/generator.js";

describe("Reporting Utils Tests", () => {
  it("should calculate local date correctly in America/New_York", () => {
    // 1719655200000 = Saturday, June 29, 2024 10:00:00 AM UTC
    // America/New_York (UTC-4) = Saturday, June 29, 2024 6:00:00 AM
    const ms = 1719655200000;
    const localDate = getLocalDate(ms, "America/New_York");
    expect(localDate).toBe("2024-06-29");
  });

  it("should round elapsed time up to the nearest 15 minutes", () => {
    // 0 milliseconds
    const r0 = roundToNearest15Mins(0);
    expect(r0.roundedMinutes).toBe(0);
    expect(r0.roundedHours).toBe(0.00);

    // 1 minute (60000 ms) -> rounds up to 15 mins
    const r1 = roundToNearest15Mins(60 * 1000);
    expect(r1.roundedMinutes).toBe(15);
    expect(r1.roundedHours).toBe(0.25);

    // 14 minutes -> rounds up to 15 mins
    const r14 = roundToNearest15Mins(14 * 60 * 1000);
    expect(r14.roundedMinutes).toBe(15);
    expect(r14.roundedHours).toBe(0.25);

    // 16 minutes -> rounds up to 30 mins
    const r16 = roundToNearest15Mins(16 * 60 * 1000);
    expect(r16.roundedMinutes).toBe(30);
    expect(r16.roundedHours).toBe(0.50);

    // 3 hours and 45 minutes exactly
    const r225 = roundToNearest15Mins(225 * 60 * 1000);
    expect(r225.roundedMinutes).toBe(225);
    expect(r225.roundedHours).toBe(3.75);

    // 3 hours and 41 minutes -> rounds up to 3h 45m
    const r221 = roundToNearest15Mins(221 * 60 * 1000);
    expect(r221.roundedMinutes).toBe(225);
    expect(r221.roundedHours).toBe(3.75);
  });
});
