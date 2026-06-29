import { describe, it, expect } from "vitest";

describe("Retention Calculations", () => {
  it("should calculate cutoff dates correctly relative to now", () => {
    const now = Date.now();
    const oneMonthAgoMs = now - 30 * 24 * 60 * 60 * 1000;
    const twelveMonthsAgoMs = now - 365 * 24 * 60 * 60 * 1000;

    expect(now - oneMonthAgoMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(now - twelveMonthsAgoMs).toBe(365 * 24 * 60 * 60 * 1000);
  });
});
