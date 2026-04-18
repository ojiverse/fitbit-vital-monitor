import { describe, expect, it } from "vitest";
import { selectRateLimit, upsertRateLimit } from "../src/db/rate-limit";
import { createFakeD1 } from "./helpers/fake-d1";

describe("db/rate-limit", () => {
  it("returns null before any write", async () => {
    const db = createFakeD1();
    expect(await selectRateLimit(db)).toBeNull();
  });

  it("upserts and reads back the snapshot with matching numeric and date fields", async () => {
    const db = createFakeD1();
    const snap = {
      limitTotal: 150,
      remaining: 120,
      resetAt: new Date("2024-06-15T13:00:00.000Z"),
    };
    await upsertRateLimit(db, snap);
    const got = await selectRateLimit(db);
    expect(got).toEqual(snap);
  });

  it("stays at a single row across multiple upserts", async () => {
    const db = createFakeD1();
    for (let i = 0; i < 5; i++) {
      await upsertRateLimit(db, {
        limitTotal: 150,
        remaining: 150 - i,
        resetAt: new Date("2024-06-15T13:00:00.000Z"),
      });
    }
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM rate_limit_state")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect((await selectRateLimit(db))?.remaining).toBe(146);
  });
});
