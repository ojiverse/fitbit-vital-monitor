<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import uPlot, { type AlignedData, type Options } from "uplot";
  import { fetchIntraday, type IntradayPoint } from "../lib/api";
  import { addDays, formatAge } from "../lib/format";

  const ACCENT = "#f47174";

  let points = $state<ReadonlyArray<IntradayPoint>>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let lastLoadedAt = $state<Date | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  let container = $state<HTMLDivElement | undefined>(undefined);
  let chart: uPlot | null = null;

  function utcDateIso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  async function load() {
    try {
      // Query today's AND yesterday's UTC-partitioned samples so that no matter where
      // the user's local midnight lands relative to UTC midnight, the last 24 hours
      // are fully covered. We then filter to the rolling 24h window below.
      const now = new Date();
      const todayUtc = utcDateIso(now);
      const yesterdayUtc = addDays(todayUtc, -1);
      const [yesterdaySamples, todaySamples] = await Promise.all([
        fetchIntraday("heart_rate", yesterdayUtc),
        fetchIntraday("heart_rate", todayUtc),
      ]);
      const cutoff = now.getTime() - 24 * 3600 * 1000;
      const combined = [...yesterdaySamples, ...todaySamples].filter((p) => {
        const t = Date.parse(p.timestamp);
        return Number.isFinite(t) && t >= cutoff;
      });
      points = combined;
      error = null;
      lastLoadedAt = new Date();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    timer = setInterval(load, 60_000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
    chart?.destroy();
    chart = null;
  });

  const data = $derived<AlignedData>([
    points.map((p) => Date.parse(p.timestamp) / 1000),
    points.map((p) => p.value),
  ]);

  // Pin the x-axis to a rolling 24-hour window ending at "now", so the chart always
  // shows a full day regardless of how far into the day the user has progressed.
  const dayRange = $derived.by(() => {
    const now = lastLoadedAt ?? new Date();
    const max = now.getTime() / 1000;
    const min = max - 24 * 3600;
    return { min, max };
  });

  const stats = $derived.by(() => {
    if (points.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (const p of points) {
      if (!Number.isFinite(p.value)) continue;
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
      sum += p.value;
    }
    return {
      min: Math.round(min),
      max: Math.round(max),
      avg: Math.round(sum / points.length),
      latest: Math.round(points[points.length - 1]?.value ?? 0),
      count: points.length,
    };
  });

  function isDark() {
    return (
      typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    );
  }

  function build() {
    if (!container) return;
    chart?.destroy();
    chart = null;
    if (points.length === 0) return;
    const gridStroke = isDark() ? "#2a2e38" : "#e3e6ec";
    const axisStroke = isDark() ? "#9aa0a6" : "#6f7685";
    const width = container.getBoundingClientRect().width;
    const opts: Options = {
      width,
      height: 260,
      scales: {
        x: {
          time: true,
          range: () => [dayRange.min, dayRange.max],
        },
      },
      series: [
        { label: "時刻" },
        {
          label: "心拍数",
          stroke: ACCENT,
          fill: `${ACCENT}22`,
          width: 1.5,
          points: { show: false },
          value: (_u, v) => (v == null ? "—" : `${v.toFixed(0)} bpm`),
        },
      ],
      axes: [
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          size: 52,
          values: (_u, splits) => splits.map((v) => `${v.toFixed(0)}`),
        },
      ],
      legend: { show: false },
      cursor: { x: true, y: false },
    };
    chart = new uPlot(opts, data, container);
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!chart || !container) return;
      chart.setSize({ width: container.getBoundingClientRect().width, height: 260 });
    });
    if (container) ro.observe(container);
    return () => ro.disconnect();
  });

  $effect(() => {
    data;
    untrack(() => build());
  });
</script>

<article class="metric-card heart-rate-chart" style="--accent: {ACCENT}">
  <header class="metric-card__head">
    <span class="metric-card__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12h4l2-6 4 12 3-9 2 6 2-3h3" />
      </svg>
    </span>
    <div class="metric-card__title">
      <h3>直近 24 時間の心拍推移</h3>
      <span class="metric-card__subtitle">
        {#if stats}
          1 分粒度の intraday サンプル · {stats.count} 点
        {:else}
          1 分粒度の intraday サンプル
        {/if}
      </span>
    </div>
  </header>

  {#if stats}
    <div class="hr-stats">
      <div><span class="hr-stats__label">最小</span><span class="hr-stats__value">{stats.min}<span>bpm</span></span></div>
      <div><span class="hr-stats__label">平均</span><span class="hr-stats__value">{stats.avg}<span>bpm</span></span></div>
      <div><span class="hr-stats__label">最大</span><span class="hr-stats__value">{stats.max}<span>bpm</span></span></div>
      <div><span class="hr-stats__label">最新</span><span class="hr-stats__value">{stats.latest}<span>bpm</span></span></div>
    </div>
  {/if}

  {#if error}
    <div class="empty empty--soft bad">読み込みに失敗: {error}</div>
  {:else if loading && points.length === 0}
    <div class="empty empty--soft">読み込み中…</div>
  {:else if points.length === 0}
    <div class="empty empty--soft">今日の intraday データはまだありません。</div>
  {:else}
    <div class="hr-chart" bind:this={container}></div>
  {/if}

  <footer class="metric-card__foot">
    <span class="chip chip--time">
      {lastLoadedAt ? formatAge(lastLoadedAt.toISOString()) : "—"}
    </span>
  </footer>
</article>

<style>
  .heart-rate-chart {
    grid-column: 1 / -1;
  }
  .hr-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    margin-top: 0.1rem;
  }
  .hr-stats > div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.65rem;
    background: color-mix(in srgb, var(--accent) 9%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 8px;
  }
  .hr-stats__label {
    font-size: 0.68rem;
    color: var(--fg-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .hr-stats__value {
    font-size: 1.05rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
  }
  .hr-stats__value > span {
    font-size: 0.68rem;
    color: var(--fg-dim);
    font-weight: 500;
  }
  .hr-chart {
    margin-top: 0.2rem;
  }
  @media (max-width: 720px) {
    .heart-rate-chart {
      grid-column: span 1;
    }
    .hr-stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
