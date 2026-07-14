import { describe, it, expect } from "vitest";
import {
  median,
  formatMinutesAsTime,
  localDateDaysAgo,
  typicalArrivalDeparture,
  minutesFromMidnight,
} from "../src/reporting/profileStats.js";

describe("median", () => {
  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });

  it("returns middle value for odd length", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages middle pair for even length", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("formatMinutesAsTime", () => {
  it("formats HH:MM", () => {
    expect(formatMinutesAsTime(0)).toBe("00:00");
    expect(formatMinutesAsTime(9 * 60 + 5)).toBe("09:05");
    expect(formatMinutesAsTime(17 * 60 + 30)).toBe("17:30");
  });

  it("returns null for nullish", () => {
    expect(formatMinutesAsTime(null)).toBeNull();
  });
});

describe("localDateDaysAgo", () => {
  it("subtracts calendar days", () => {
    expect(localDateDaysAgo("2025-07-14", 0)).toBe("2025-07-14");
    expect(localDateDaysAgo("2025-07-14", 90)).toBe("2025-04-15");
  });
});

describe("typicalArrivalDeparture", () => {
  it("computes medians of daily first/last in America/New_York", () => {
    // Use timestamps that are unambiguous local mornings/evenings in ET
    const day1Arrive = Date.parse("2025-07-14T13:00:00Z"); // 09:00 ET (EDT)
    const day1Leave = Date.parse("2025-07-14T21:00:00Z"); // 17:00 ET
    const day2Arrive = Date.parse("2025-07-15T13:10:00Z"); // 09:10 ET
    const day2Leave = Date.parse("2025-07-15T21:20:00Z"); // 17:20 ET
    const day3Arrive = Date.parse("2025-07-16T12:50:00Z"); // 08:50 ET
    const day3Leave = Date.parse("2025-07-16T20:40:00Z"); // 16:40 ET

    const result = typicalArrivalDeparture(
      [
        { started_at_ms: day1Arrive, ended_at_ms: day1Leave },
        { started_at_ms: day2Arrive, ended_at_ms: day2Leave },
        { started_at_ms: day3Arrive, ended_at_ms: day3Leave },
      ],
      "America/New_York"
    );

    expect(result.arrivalMinutes).toBe(9 * 60); // median of 8:50, 9:00, 9:10
    expect(result.departureMinutes).toBe(17 * 60); // median of 16:40, 17:00, 17:20
    expect(formatMinutesAsTime(result.arrivalMinutes)).toBe("09:00");
    expect(formatMinutesAsTime(result.departureMinutes)).toBe("17:00");
  });

  it("returns nulls when empty", () => {
    expect(typicalArrivalDeparture([], "America/New_York")).toEqual({
      arrivalMinutes: null,
      departureMinutes: null,
    });
  });
});

describe("minutesFromMidnight", () => {
  it("maps UTC noon-ish to ET morning on a known day", () => {
    // 2025-07-14 13:00 UTC = 09:00 America/New_York (EDT)
    expect(minutesFromMidnight(Date.parse("2025-07-14T13:00:00Z"), "America/New_York")).toBe(
      9 * 60
    );
  });
});
