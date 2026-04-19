<script lang="ts">
  import { formatDuration } from "../lib/format";

  type Props = {
    meta: string | null | undefined;
  };
  const { meta }: Props = $props();

  type StageKey = "deep" | "rem" | "light" | "wake";
  type StageMeta = {
    readonly key: StageKey;
    readonly label: string;
    readonly color: string;
    readonly lane: number; // 0 = bottom (deep), 3 = top (wake) — mirrors sleep-chart convention
  };

  const STAGE_META: Readonly<Record<StageKey, StageMeta>> = {
    deep: { key: "deep", label: "深睡眠", color: "#5b4fc2", lane: 0 },
    light: { key: "light", label: "浅睡眠", color: "#8ab4ff", lane: 1 },
    rem: { key: "rem", label: "REM", color: "#a78bfa", lane: 2 },
    wake: { key: "wake", label: "覚醒", color: "#f2b45c", lane: 3 },
  };

  type Segment = {
    readonly startMs: number;
    readonly endMs: number;
    readonly seconds: number;
    readonly key: StageKey;
  };

  const parsed = $derived.by(() => {
    if (!meta) return null;
    try {
      return JSON.parse(meta) as {
        startIso?: string;
        endIso?: string;
        stages?: Partial<Record<StageKey, number>>;
        segments?: ReadonlyArray<{ startIso: string; seconds: number; level: string }>;
      };
    } catch {
      return null;
    }
  });

  const segments = $derived.by<Segment[]>(() => {
    const raw = parsed?.segments ?? [];
    const out: Segment[] = [];
    for (const s of raw) {
      const key = s.level as StageKey;
      if (!(key in STAGE_META)) continue;
      const startMs = Date.parse(s.startIso);
      if (!Number.isFinite(startMs)) continue;
      out.push({
        startMs,
        endMs: startMs + s.seconds * 1000,
        seconds: s.seconds,
        key,
      });
    }
    return out;
  });

  const range = $derived.by(() => {
    if (segments.length === 0 && !parsed?.startIso) return null;
    const startMs =
      segments[0]?.startMs ?? (parsed?.startIso ? Date.parse(parsed.startIso) : Number.NaN);
    const endMs =
      segments[segments.length - 1]?.endMs ??
      (parsed?.endIso ? Date.parse(parsed.endIso) : Number.NaN);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return { startMs, endMs, durationMs: endMs - startMs };
  });

  type TimeTick = { readonly ms: number; readonly label: string };
  const ticks = $derived.by<TimeTick[]>(() => {
    if (!range) return [];
    const arr: TimeTick[] = [];
    const HOUR = 3600 * 1000;
    // Start from the first hour boundary after startMs
    const firstHour = Math.ceil(range.startMs / HOUR) * HOUR;
    for (let t = firstHour; t <= range.endMs; t += HOUR) {
      const d = new Date(t);
      arr.push({
        ms: t,
        label: `${d.getHours().toString().padStart(2, "0")}:00`,
      });
    }
    return arr;
  });

  const totals = $derived.by(() => {
    const computed = new Map<StageKey, number>([
      ["deep", 0],
      ["light", 0],
      ["rem", 0],
      ["wake", 0],
    ]);
    if (segments.length > 0) {
      for (const s of segments) {
        computed.set(s.key, (computed.get(s.key) ?? 0) + s.seconds);
      }
    } else if (parsed?.stages) {
      for (const key of ["deep", "light", "rem", "wake"] as StageKey[]) {
        computed.set(key, parsed.stages[key] ?? 0);
      }
    }
    const total = Array.from(computed.values()).reduce((acc, v) => acc + v, 0);
    return { by: computed, total };
  });

  function pct(ms: number): number {
    if (!range) return 0;
    return ((ms - range.startMs) / range.durationMs) * 100;
  }

  function formatHHMM(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }

  const hasTimeline = $derived(segments.length > 0 && range !== null);
  const hasAnyTotals = $derived(totals.total > 0);
</script>

{#if hasTimeline || hasAnyTotals}
  <article class="metric-card sleep-stages" style="--accent: #a78bfa">
    <header class="metric-card__head">
      <span class="metric-card__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z" />
        </svg>
      </span>
      <div class="metric-card__title">
        <h3>睡眠タイムライン</h3>
        {#if range}
          <span class="metric-card__subtitle">
            {formatHHMM(range.startMs)} – {formatHHMM(range.endMs)} ({formatDuration(
              Math.round(range.durationMs / 1000),
            )})
          </span>
        {:else}
          <span class="metric-card__subtitle">前夜の各フェーズの合計時間</span>
        {/if}
      </div>
    </header>

    {#if hasTimeline && range}
      <div class="timeline" role="img" aria-label="sleep stages timeline">
        <div class="timeline__lanes">
          {#each ["wake", "rem", "light", "deep"] as laneKey (laneKey)}
            <div class="timeline__lane">
              <span class="timeline__lane-label">{STAGE_META[laneKey as StageKey].label}</span>
              <div class="timeline__lane-track">
                {#each segments.filter((s) => s.key === laneKey) as seg, i (i)}
                  <span
                    class="timeline__seg"
                    style="left: {pct(seg.startMs)}%; width: {pct(seg.endMs) -
                      pct(seg.startMs)}%; background: {STAGE_META[seg.key].color}"
                    title="{STAGE_META[seg.key].label} {formatHHMM(seg.startMs)}–{formatHHMM(
                      seg.endMs,
                    )} ({formatDuration(seg.seconds)})"
                  ></span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <div class="timeline__axis">
          {#each ticks as t (t.ms)}
            <span class="timeline__tick" style="left: {pct(t.ms)}%">
              <span class="timeline__tick-line"></span>
              <span class="timeline__tick-label">{t.label}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}

    <ul class="stages-legend">
      {#each ["deep", "rem", "light", "wake"] as k (k)}
        {@const key = k as StageKey}
        {@const sec = totals.by.get(key) ?? 0}
        {@const pctVal = totals.total > 0 ? (sec / totals.total) * 100 : 0}
        <li>
          <span class="stages-legend__swatch" style="background: {STAGE_META[key].color}"></span>
          <span class="stages-legend__label">{STAGE_META[key].label}</span>
          <span class="stages-legend__value">
            {formatDuration(sec)}
            <span class="stages-legend__pct">{pctVal.toFixed(0)}%</span>
          </span>
        </li>
      {/each}
    </ul>

    {#if !hasTimeline}
      <p class="metric-card__desc">
        タイムライン用のステージ遷移データが届いていません (合計時間のみ表示)。
      </p>
    {/if}
  </article>
{/if}

<style>
  .sleep-stages {
    grid-column: span 2;
  }
  .timeline {
    margin-top: 0.2rem;
  }
  .timeline__lanes {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .timeline__lane {
    display: grid;
    grid-template-columns: 56px 1fr;
    align-items: center;
    gap: 0.5rem;
    min-height: 14px;
  }
  .timeline__lane-label {
    font-size: 0.7rem;
    color: var(--fg-dim);
    text-align: right;
    letter-spacing: 0.04em;
  }
  .timeline__lane-track {
    position: relative;
    height: 14px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 4px;
    overflow: hidden;
  }
  .timeline__seg {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 1px;
  }
  .timeline__axis {
    position: relative;
    margin: 0.4rem 0 0.25rem 56px;
    height: 14px;
    border-top: 1px solid var(--border);
  }
  .timeline__tick {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 0.68rem;
    color: var(--fg-mute);
  }
  .timeline__tick-line {
    display: block;
    width: 1px;
    height: 4px;
    background: var(--border);
  }
  .stages-legend {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    gap: 0.4rem 0.8rem;
  }
  .stages-legend li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
  }
  .stages-legend__swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .stages-legend__label {
    color: var(--fg);
  }
  .stages-legend__value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    display: inline-flex;
    gap: 0.3rem;
    align-items: baseline;
  }
  .stages-legend__pct {
    color: var(--fg-mute);
    font-size: 0.72rem;
    font-weight: 500;
  }
  @media (max-width: 720px) {
    .sleep-stages {
      grid-column: span 1;
    }
    .timeline__lane {
      grid-template-columns: 48px 1fr;
    }
    .timeline__axis {
      margin-left: 48px;
    }
  }
</style>
