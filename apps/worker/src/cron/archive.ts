import { deleteIntradayOlderThan, selectIntradayOlderThan } from "../db/vitals";
import type { Env } from "../types";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function runArchive(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const cutoffIso = cutoff.toISOString();
  const rows = await selectIntradayOlderThan(env.DB, cutoffIso);
  if (rows.length === 0) return;

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const day = row.timestamp.slice(0, 10);
    const lines = grouped.get(day) ?? [];
    lines.push(JSON.stringify(row));
    grouped.set(day, lines);
  }

  for (const [day, lines] of grouped) {
    const key = `archive/${day}.jsonl`;
    const existing = await env.ARCHIVE.get(key);
    const existingText = existing ? await existing.text() : "";
    const body =
      existingText.length > 0 ? `${existingText}${lines.join("\n")}\n` : `${lines.join("\n")}\n`;
    await env.ARCHIVE.put(key, body, {
      httpMetadata: { contentType: "application/jsonl" },
    });
  }

  await deleteIntradayOlderThan(env.DB, cutoffIso);
}
