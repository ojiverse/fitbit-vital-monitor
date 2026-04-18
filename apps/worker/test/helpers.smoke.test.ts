import { describe, expect, it } from "vitest";
import { createFakeD1 } from "./helpers/fake-d1";
import { createFakeR2 } from "./helpers/fake-r2";

describe("fake helpers smoke", () => {
  it("fake D1 applies migrations and round-trips a row", async () => {
    const db = createFakeD1();
    await db
      .prepare("INSERT INTO vitals (timestamp, metric_type, value) VALUES (?, ?, ?)")
      .bind("2024-06-15T00:00:00.000Z", "heart_rate", 72)
      .run();
    const row = await db
      .prepare("SELECT metric_type, value FROM vitals WHERE timestamp = ?")
      .bind("2024-06-15T00:00:00.000Z")
      .first<{ metric_type: string; value: number }>();
    expect(row).toEqual({ metric_type: "heart_rate", value: 72 });
  });

  it("fake R2 stores and retrieves objects", async () => {
    const r2 = createFakeR2();
    await r2.put("key", "hello");
    const got = await r2.get("key");
    expect(await got?.text()).toBe("hello");
  });
});
