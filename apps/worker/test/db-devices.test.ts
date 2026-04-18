import { describe, expect, it } from "vitest";
import { selectDevices, upsertDevice } from "../src/db/devices";
import { createFakeD1 } from "./helpers/fake-d1";

describe("db/devices", () => {
  it("returns an empty list initially", async () => {
    const db = createFakeD1();
    expect(await selectDevices(db)).toEqual([]);
  });

  it("upserts and updates by device id", async () => {
    const db = createFakeD1();
    await upsertDevice(db, {
      id: "dev1",
      type: "TRACKER",
      batteryLevel: 80,
      lastSyncAt: "2024-06-15T10:00:00.000Z",
    });
    await upsertDevice(db, {
      id: "dev1",
      type: "TRACKER",
      batteryLevel: 75,
      lastSyncAt: "2024-06-15T12:00:00.000Z",
    });
    await upsertDevice(db, {
      id: "dev2",
      type: "SCALE",
      batteryLevel: null,
      lastSyncAt: "2024-06-10T09:00:00.000Z",
    });
    const devices = await selectDevices(db);
    const byId = Object.fromEntries(devices.map((d) => [d.id, d]));
    expect(byId.dev1?.batteryLevel).toBe(75);
    expect(byId.dev1?.lastSyncAt).toBe("2024-06-15T12:00:00.000Z");
    expect(byId.dev2?.batteryLevel).toBeNull();
    expect(byId.dev2?.type).toBe("SCALE");
  });
});
