import { describe, it, expect } from "vitest";
import {
  retentionCutoffs,
  RAW_RETENTION_DAYS,
  NORMALIZED_RETENTION_DAYS,
  DAY_MS,
} from "../src/reporting/cleanup.js";

describe("Retention Calculations", () => {
  it("should calculate cutoff dates correctly relative to now", () => {
    const now = Date.now();
    const { rawCutoffMs, normalizedCutoffMs } = retentionCutoffs(now);
    expect(now - rawCutoffMs).toBe(RAW_RETENTION_DAYS * DAY_MS);
    expect(now - normalizedCutoffMs).toBe(NORMALIZED_RETENTION_DAYS * DAY_MS);
  });
});
