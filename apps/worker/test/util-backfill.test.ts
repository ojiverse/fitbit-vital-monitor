import { describe, expect, it } from "vitest";
import { upsertDaily } from "../src/db/vitals";
import { findOldestMissingDay } from "../src/util/backfill";
import { createFakeD1 } from "./helpers/fake-d1";

describe("findOldestMissingDay", () => {
  it("returns the oldest day in the lookback window when the table is empty", async () => {
    const db = createFakeD1();
    const missing = await findOldestMissingDay(db, "sleep_duration", 7, "2024-06-15");
    expect(missing).toBe("2024-06-08");
  });

  it("ignores the current day and only considers [today-N, today-1]", async () => {
    const db = createFakeD1();
    // Fill every past day except today itself
    for (let i = 1; i <= 7; i++) {
      const d = new Date("2024-06-15T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      await upsertDaily(db, d.toISOString().slice(0, 10), "sleep_duration", 3600);
    }
    const missing = await findOldestMissingDay(db, "sleep_duration", 7, "2024-06-15");
    expect(missing).toBeNull();
  });

  it("returns the oldest missing day when some past days are present", async () => {
    const db = createFakeD1();
    // Have data for 2024-06-12 and 2024-06-13 only
    await upsertDaily(db, "2024-06-12", "sleep_duration", 3600);
    await upsertDaily(db, "2024-06-13", "sleep_duration", 3600);
    const missing = await findOldestMissingDay(db, "sleep_duration", 7, "2024-06-15");
    // Oldest missing within [2024-06-08, 2024-06-14] is 2024-06-08
    expect(missing).toBe("2024-06-08");
  });

  it("only considers the specified metric_type", async () => {
    const db = createFakeD1();
    // Fill all past 7 days for a different metric
    for (let i = 1; i <= 7; i++) {
      const d = new Date("2024-06-15T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      await upsertDaily(db, d.toISOString().slice(0, 10), "steps", 1000);
    }
    const missing = await findOldestMissingDay(db, "sleep_duration", 7, "2024-06-15");
    expect(missing).toBe("2024-06-08");
  });
});
