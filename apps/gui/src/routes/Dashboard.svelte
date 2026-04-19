<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fetchLatest, type LatestResponse, type LatestSample } from "../lib/api";
  import { appState } from "../lib/app-state.svelte";
  import { classifyFreshness, formatAbsoluteTime, formatAge } from "../lib/format";
  import {
    CATEGORIES,
    METRIC_BY_ID,
    METRIC_CATALOG,
    type MetricCategory,
  } from "../lib/metric-catalog";
  import HeartRateTodayCard from "../components/HeartRateTodayCard.svelte";
  import MetricCard from "../components/MetricCard.svelte";
  import SleepStagesCard from "../components/SleepStagesCard.svelte";

  type Sample = LatestSample & { readonly source: "intraday" | "daily" };

  let data = $state<LatestResponse | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      data = await fetchLatest();
      error = null;
      appState.lastRefreshedAt = new Date();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    timer = setInterval(refresh, 30_000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  const allSamples = $derived<ReadonlyArray<Sample>>([
    ...(data?.intraday ?? []).map((s) => ({ ...s, source: "intraday" as const })),
    ...(data?.daily ?? []).map((s) => ({ ...s, source: "daily" as const })),
  ]);

  const catalogOrder = new Map(METRIC_CATALOG.map((m, i) => [m.id, i]));
  const samplesByCategory = $derived<Readonly<Record<MetricCategory, ReadonlyArray<Sample>>>>(
    Object.fromEntries(
      CATEGORIES.map((cat) => [
        cat.id,
        allSamples
          .filter((s) => METRIC_BY_ID[s.metricType]?.category === cat.id)
          .slice()
          .sort(
            (a, b) =>
              (catalogOrder.get(a.metricType) ?? Number.MAX_SAFE_INTEGER) -
              (catalogOrder.get(b.metricType) ?? Number.MAX_SAFE_INTEGER),
          ),
      ]),
    ) as unknown as Record<MetricCategory, ReadonlyArray<Sample>>,
  );

  const unknownSamples = $derived(allSamples.filter((s) => !METRIC_BY_ID[s.metricType]));

  const devices = $derived(data?.devices ?? []);

  const FEATURED_IDS = ["heart_rate", "sleep_duration", "steps", "distance"] as const;
  const featuredSamples = $derived<ReadonlyArray<Sample>>(
    FEATURED_IDS.map((id) => allSamples.find((s) => s.metricType === id)).filter(
      (s): s is Sample => s !== undefined,
    ),
  );
</script>

<section class="freshness-legend" aria-label="バッジの凡例">
  <div class="freshness-legend__group">
    <span class="freshness-legend__heading">取得頻度</span>
    <span class="freshness-legend__item">
      <span class="cadence cadence--intraday">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
        高頻度
      </span>
      <span class="freshness-legend__desc">~15 分ごとに更新</span>
    </span>
    <span class="freshness-legend__item">
      <span class="cadence cadence--daily">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
        日次
      </span>
      <span class="freshness-legend__desc">1 日 1 回 (post-wake など)</span>
    </span>
  </div>
  <div class="freshness-legend__group">
    <span class="freshness-legend__heading">鮮度</span>
    <span class="freshness-legend__item">
      <span class="freshness freshness--live"><span class="freshness__dot"></span>Live</span>
      <span class="freshness-legend__desc">高頻度 30 分以内 / 日次 当日</span>
    </span>
    <span class="freshness-legend__item">
      <span class="freshness freshness--fresh"><span class="freshness__dot"></span>Fresh</span>
      <span class="freshness-legend__desc">高頻度 2 時間以内 / 日次 昨日</span>
    </span>
    <span class="freshness-legend__item">
      <span class="freshness freshness--stale"><span class="freshness__dot"></span>Stale</span>
      <span class="freshness-legend__desc">それ以上経過</span>
    </span>
  </div>
</section>

{#if loading && !data}
  <div class="empty">最新のバイタルを取得中…</div>
{:else if error}
  <div class="empty bad">取得に失敗しました: {error}</div>
{:else if data}
  {#if featuredSamples.length > 0}
    <section class="featured-section">
      <header class="featured-section__head">
        <h2>今日のハイライト</h2>
      </header>
      <div class="featured-grid">
        {#each featuredSamples as s (s.metricType)}
          <MetricCard
            metric={s.metricType}
            value={s.value}
            timestamp={s.timestamp}
            source={s.source}
            featured
          />
        {/each}
      </div>
    </section>
  {/if}

  {#each CATEGORIES as cat (cat.id)}
    {@const samples = samplesByCategory[cat.id]}
    <section class="cat-section" style="--accent: {cat.accent}">
      <header class="cat-section__head">
        <span class="cat-section__bar"></span>
        <h2>{cat.label}</h2>
      </header>

      {#if samples.length === 0}
        <div class="empty empty--soft">このカテゴリのデータはまだ届いていません。</div>
      {:else}
        <div class="cards">
          {#each samples as s (s.metricType)}
            <MetricCard
              metric={s.metricType}
              value={s.value}
              timestamp={s.timestamp}
              source={s.source}
            />
          {/each}
          {#if cat.id === "heart"}
            <HeartRateTodayCard />
          {/if}
          {#if cat.id === "sleep"}
            {@const sleepDuration = samples.find((s) => s.metricType === "sleep_duration")}
            {#if sleepDuration?.meta}
              <SleepStagesCard meta={sleepDuration.meta} />
            {/if}
          {/if}
        </div>
      {/if}
    </section>
  {/each}

  {#if unknownSamples.length > 0}
    <section class="cat-section" style="--accent: #9aa0a6">
      <header class="cat-section__head">
        <span class="cat-section__bar"></span>
        <h2>その他</h2>
      </header>
      <div class="cards">
        {#each unknownSamples as s (s.metricType)}
          <MetricCard
            metric={s.metricType}
            value={s.value}
            timestamp={s.timestamp}
            source={s.source}
          />
        {/each}
      </div>
    </section>
  {/if}

  <section class="cat-section" style="--accent: #5ea8ff">
    <header class="cat-section__head">
      <span class="cat-section__bar"></span>
      <h2>デバイス</h2>
    </header>
    {#if devices.length === 0}
      <div class="empty empty--soft">デバイス情報はまだ届いていません。</div>
    {:else}
      <div class="cards">
        {#each devices as dev (dev.id)}
          {@const battery = dev.batteryLevel}
          {@const syncFresh = classifyFreshness(dev.lastSyncAt, "intraday")}
          <article class="metric-card" style="--accent: #5ea8ff">
            <header class="metric-card__head">
              <span class="metric-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                  stroke-linejoin="round">
                  <rect x="6" y="2" width="12" height="20" rx="2" />
                  <path d="M10 6h4" />
                </svg>
              </span>
              <div class="metric-card__title">
                <h3>{dev.type}</h3>
                <span class="metric-card__subtitle">ID: {dev.id}</span>
              </div>
              <span class="freshness freshness--{syncFresh.level}"
                title={formatAbsoluteTime(dev.lastSyncAt)}>
                <span class="freshness__dot"></span>
                {syncFresh.level === "live"
                  ? "同期中"
                  : syncFresh.level === "fresh"
                    ? "同期済"
                    : "遅延"}
              </span>
            </header>
            <div class="metric-card__value">
              <span class="metric-card__num">{battery !== null ? battery : "—"}</span>
              <span class="metric-card__unit">%</span>
            </div>
            <p class="metric-card__desc">バッテリー残量 (20% 未満で充電推奨)</p>
            <footer class="metric-card__foot">
              <span class="cadence cadence--intraday" title="~15 分ごとに更新される高頻度データ">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                </svg>
                高頻度
              </span>
              <span class="chip chip--time" title={formatAbsoluteTime(dev.lastSyncAt)}>
                前回同期: {formatAge(dev.lastSyncAt)}
              </span>
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </section>
{/if}
