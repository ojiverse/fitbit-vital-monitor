import { describe, expect, it } from "vitest";
import { addDays, localToUtcIso, todayInTimezone } from "../src/util/time";

describe("util/time", () => {
  it("todayInTimezone returns the local wall date for Asia/Tokyo", () => {
    // 2024-06-15T20:00:00Z is already 2024-06-16 05:00 JST
    const now = new Date("2024-06-15T20:00:00Z");
    expect(todayInTimezone("Asia/Tokyo", now)).toBe("2024-06-16");
  });

  it("addDays handles month rollover", () => {
    expect(addDays("2024-01-30", 3)).toBe("2024-02-02");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("localToUtcIso converts Tokyo wall clock to UTC", () => {
    // 2024-06-15 09:00 JST = 2024-06-15 00:00 UTC
    expect(localToUtcIso("2024-06-15", "09:00:00", "Asia/Tokyo")).toBe("2024-06-15T00:00:00.000Z");
  });

  it("localToUtcIso respects DST for Europe/Berlin", () => {
    // 2024-07-15 is CEST (UTC+2): 09:00 local = 07:00 UTC
    expect(localToUtcIso("2024-07-15", "09:00:00", "Europe/Berlin")).toBe(
      "2024-07-15T07:00:00.000Z",
    );
    // 2024-01-15 is CET (UTC+1): 09:00 local = 08:00 UTC
    expect(localToUtcIso("2024-01-15", "09:00:00", "Europe/Berlin")).toBe(
      "2024-01-15T08:00:00.000Z",
    );
  });
});
