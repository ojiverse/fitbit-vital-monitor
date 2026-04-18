export type DeviceRow = {
  readonly id: string;
  readonly type: string;
  readonly batteryLevel: number | null;
  readonly lastSyncAt: string;
  readonly updatedAt: string;
};

export async function upsertDevice(
  db: D1Database,
  device: {
    readonly id: string;
    readonly type: string;
    readonly batteryLevel: number | null;
    readonly lastSyncAt: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO devices (id, type, battery_level, last_sync_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         battery_level = excluded.battery_level,
         last_sync_at = excluded.last_sync_at,
         updated_at = excluded.updated_at`,
    )
    .bind(device.id, device.type, device.batteryLevel, device.lastSyncAt, now)
    .run();
}

export async function selectDevices(db: D1Database): Promise<ReadonlyArray<DeviceRow>> {
  const rows = await db
    .prepare("SELECT id, type, battery_level, last_sync_at, updated_at FROM devices")
    .all<{
      id: string;
      type: string;
      battery_level: number | null;
      last_sync_at: string;
      updated_at: string;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    type: r.type,
    batteryLevel: r.battery_level,
    lastSyncAt: r.last_sync_at,
    updatedAt: r.updated_at,
  }));
}
