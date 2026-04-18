export function todayInTimezone(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function localToUtcIso(date: string, time: string, tz: string): string {
  const baselineMs = Date.parse(`${date}T${time}Z`);
  if (Number.isNaN(baselineMs)) {
    throw new Error(`Invalid date/time: ${date} ${time}`);
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(baselineMs));
  const map = new Map<string, string>();
  for (const p of parts) map.set(p.type, p.value);
  const hour = map.get("hour") === "24" ? "00" : (map.get("hour") ?? "00");
  const wallInTzAsUtcMs = Date.UTC(
    Number(map.get("year") ?? 1970),
    Number(map.get("month") ?? 1) - 1,
    Number(map.get("day") ?? 1),
    Number(hour),
    Number(map.get("minute") ?? 0),
    Number(map.get("second") ?? 0),
  );
  const offsetMs = wallInTzAsUtcMs - baselineMs;
  return new Date(baselineMs - offsetMs).toISOString();
}
