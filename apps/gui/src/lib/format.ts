export function formatNumber(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toFixed(digits);
}

export function formatAge(iso: string, now: Date = new Date()): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diff = Math.max(0, Math.round((now.getTime() - ts) / 1000));
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.round(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.round(diff / 3600)} 時間前`;
  return `${Math.round(diff / 86400)} 日前`;
}

// For daily samples, the timestamp is a calendar date without a time-of-day.
// Treating it as an instant produces misleading "0 秒前" strings in the morning,
// so compare by local calendar day instead.
export function formatDailyAge(iso: string, now: Date = new Date()): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diffDays <= 0) return "今日";
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${diffDays} 日前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 週間前`;
  return `${Math.floor(diffDays / 30)} ヶ月前`;
}

export function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export type FreshnessLevel = "live" | "fresh" | "stale" | "unknown";

// Classify how fresh a datapoint is, tuned per source:
// - intraday: updated every ~15min → "live" ≤30m / "fresh" ≤2h / "stale" >2h by clock time.
// - daily:    date-granular; today = live, yesterday = fresh, older = stale.
export function classifyFreshness(
  iso: string,
  source: "intraday" | "daily",
  now: Date = new Date(),
): { level: FreshnessLevel; ageSeconds: number } {
  if (source === "intraday") {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return { level: "unknown", ageSeconds: Number.POSITIVE_INFINITY };
    const diff = Math.max(0, Math.round((now.getTime() - ts) / 1000));
    if (diff <= 1800) return { level: "live", ageSeconds: diff };
    if (diff <= 7200) return { level: "fresh", ageSeconds: diff };
    return { level: "stale", ageSeconds: diff };
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { level: "unknown", ageSeconds: Number.POSITIVE_INFINITY };
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  const ageSeconds = Math.max(0, diffDays) * 86400;
  if (diffDays <= 0) return { level: "live", ageSeconds };
  if (diffDays === 1) return { level: "fresh", ageSeconds };
  return { level: "stale", ageSeconds };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds - h * 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function todayIso(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

export function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
