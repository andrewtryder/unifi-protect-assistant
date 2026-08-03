import { describe, it, expect } from "vitest";
import { getLocalDate } from "../src/webhook/parser.js";
import { roundToNearest15Mins } from "../src/reporting/generator.js";
import {
  retentionCutoffs,
  RAW_RETENTION_DAYS,
  NORMALIZED_RETENTION_DAYS,
  DAY_MS,
} from "../src/reporting/cleanup.js";

describe("Reporting Utils Tests", () => {
  it("should calculate local date correctly in America/New_York", () => {
    const ms = 1719655200000;
    const localDate = getLocalDate(ms, "America/New_York");
    expect(localDate).toBe("2024-06-29");
  });

  it("should round elapsed time up to the nearest 15 minutes", () => {
    expect(roundToNearest15Mins(0)).toEqual({ roundedMinutes: 0, roundedHours: 0 });
    expect(roundToNearest15Mins(60 * 1000).roundedMinutes).toBe(15);
    expect(roundToNearest15Mins(14 * 60 * 1000).roundedMinutes).toBe(15);
    expect(roundToNearest15Mins(16 * 60 * 1000).roundedMinutes).toBe(30);
    expect(roundToNearest15Mins(225 * 60 * 1000).roundedHours).toBe(3.75);
    expect(roundToNearest15Mins(221 * 60 * 1000).roundedMinutes).toBe(225);
  });
});

describe("Retention cutoffs", () => {
  it("computes 30-day raw and 365-day normalized cutoffs", () => {
    const now = 1_700_000_000_000;
    const { rawCutoffMs, normalizedCutoffMs } = retentionCutoffs(now);
    expect(now - rawCutoffMs).toBe(RAW_RETENTION_DAYS * DAY_MS);
    expect(now - normalizedCutoffMs).toBe(NORMALIZED_RETENTION_DAYS * DAY_MS);
  });
});
