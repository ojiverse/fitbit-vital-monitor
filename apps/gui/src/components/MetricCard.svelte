<script lang="ts">
  import { METRIC_BY_ID, CATEGORY_BY_ID } from "../lib/metric-catalog";
  import {
    classifyFreshness,
    formatAbsoluteTime,
    formatAge,
    formatDailyAge,
    formatNumber,
  } from "../lib/format";

  type Props = {
    metric: string;
    value: number;
    timestamp: string;
    source: "intraday" | "daily";
    featured?: boolean;
  };
  const { metric, value, timestamp, source, featured = false }: Props = $props();

  const entry = $derived(METRIC_BY_ID[metric]);
  const accent = $derived(entry ? CATEGORY_BY_ID[entry.category].accent : "#9aa0a6");
  const displayValue = $derived(
    entry?.formatter
      ? entry.formatter(value)
      : formatNumber(value, entry?.precision ?? 1),
  );
  const label = $derived(entry?.label ?? metric);
  const unit = $derived(entry?.unit ?? "");
  const description = $derived(entry?.description ?? "");
  const freshness = $derived(classifyFreshness(timestamp, source));
  const freshnessLabel = $derived(
    freshness.level === "live"
      ? "Live"
      : freshness.level === "fresh"
        ? "Fresh"
        : freshness.level === "stale"
          ? "Stale"
          : "—",
  );
  const ageText = $derived(source === "daily" ? formatDailyAge(timestamp) : formatAge(timestamp));
  const absoluteText = $derived(
    source === "daily" ? timestamp.slice(0, 10) : formatAbsoluteTime(timestamp),
  );
</script>

<article
  class="metric-card metric-card--{source} {featured ? 'metric-card--featured' : ''}"
  style="--accent: {accent}"
>
  <header class="metric-card__head">
    <span class="metric-card__icon" aria-hidden="true">
      {#if entry}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d={entry.icon} />
        </svg>
      {/if}
    </span>
    <div class="metric-card__title">
      <h3>{label}</h3>
      {#if unit}
        <span class="metric-card__subtitle">単位: {unit}</span>
      {/if}
    </div>
    <span class="freshness freshness--{freshness.level}" title={absoluteText}>
      <span class="freshness__dot"></span>
      {freshnessLabel}
    </span>
  </header>

  <div class="metric-card__value">
    <span class="metric-card__num">{displayValue}</span>
    {#if unit}<span class="metric-card__unit">{unit}</span>{/if}
  </div>

  {#if description}
    <p class="metric-card__desc">{description}</p>
  {/if}

  <footer class="metric-card__foot">
    <span class="cadence cadence--{source}"
      title={source === "intraday"
        ? "~15 分ごとに更新される高頻度データ"
        : "1 日 1 回 (post-wake など) 更新される日次データ"}
    >
      {#if source === "intraday"}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
        高頻度
      {:else}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
        日次
      {/if}
    </span>
    <span class="chip chip--time" title={absoluteText}>{ageText}</span>
  </footer>
</article>
