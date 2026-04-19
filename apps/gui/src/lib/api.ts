export type LatestSample = {
  readonly metricType: string;
  readonly timestamp: string;
  readonly value: number;
  readonly meta?: string | null;
};

export type DeviceInfo = {
  readonly id: string;
  readonly type: string;
  readonly batteryLevel: number | null;
  readonly lastSyncAt: string;
};

export type LatestResponse = {
  readonly intraday: ReadonlyArray<LatestSample>;
  readonly daily: ReadonlyArray<LatestSample>;
  readonly devices: ReadonlyArray<DeviceInfo>;
};

export type IntradayPoint = {
  readonly timestamp: string;
  readonly value: number;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

export function fetchLatest(): Promise<LatestResponse> {
  return getJson<LatestResponse>("/api/vitals/latest");
}

export async function fetchIntraday(
  metric: string,
  date: string,
): Promise<ReadonlyArray<IntradayPoint>> {
  const res = await getJson<{ points: ReadonlyArray<IntradayPoint> }>(
    `/api/vitals/intraday?metric=${encodeURIComponent(metric)}&date=${date}`,
  );
  return res.points;
}
