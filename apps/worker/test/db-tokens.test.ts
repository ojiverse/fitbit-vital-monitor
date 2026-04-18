import { describe, expect, it } from "vitest";
import { getToken, upsertToken } from "../src/db/tokens";
import { createFakeD1 } from "./helpers/fake-d1";

describe("db/tokens", () => {
  it("returns null before any write", async () => {
    const db = createFakeD1();
    expect(await getToken(db)).toBeNull();
  });

  it("upserts the id=1 row and round-trips all fields", async () => {
    const db = createFakeD1();
    const stored = {
      accessToken: "A",
      refreshToken: "R",
      expiresAt: new Date("2024-06-15T20:00:00.000Z"),
      scope: "activity heartrate",
      fitbitUserId: "U",
      updatedAt: new Date("2024-06-15T12:00:00.000Z"),
    };
    await upsertToken(db, stored);
    const loaded = await getToken(db);
    expect(loaded).toEqual(stored);
  });

  it("overwrites the same row on subsequent upserts (single-row invariant)", async () => {
    const db = createFakeD1();
    await upsertToken(db, {
      accessToken: "A1",
      refreshToken: "R1",
      expiresAt: new Date("2024-06-15T20:00:00.000Z"),
      scope: "",
      fitbitUserId: "U",
      updatedAt: new Date("2024-06-15T12:00:00.000Z"),
    });
    await upsertToken(db, {
      accessToken: "A2",
      refreshToken: "R2",
      expiresAt: new Date("2024-06-16T04:00:00.000Z"),
      scope: "sleep",
      fitbitUserId: "U",
      updatedAt: new Date("2024-06-15T20:00:00.000Z"),
    });
    const count = await db.prepare("SELECT COUNT(*) AS n FROM auth_tokens").first<{ n: number }>();
    expect(count?.n).toBe(1);
    const loaded = await getToken(db);
    expect(loaded?.accessToken).toBe("A2");
    expect(loaded?.refreshToken).toBe("R2");
    expect(loaded?.scope).toBe("sleep");
  });
});
