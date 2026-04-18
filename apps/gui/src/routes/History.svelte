<script lang="ts">
  import { fetchDaily, fetchIntraday } from "../lib/api";
  import { addDays, todayIso } from "../lib/format";
  import { METRIC_CATALOG } from "../lib/metric-catalog";
  import Chart from "../components/Chart.svelte";

  type Mode = "daily" | "intraday";
  const DAILY_METRICS = METRIC_CATALOG.filter((m) => m.source === "daily");
  const INTRADAY_METRICS = METRIC_CATALOG.filter((m) => m.source === "intraday");

  let mode = $state<Mode>("daily");
  let metric = $state<string>(DAILY_METRICS[0]?.id ?? "steps");
  let rangeDays = $state<number>(30);
  let date = $state<string>(todayIso());
  let timestamps = $state<number[]>([]);
  let values = $state<number[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);

  const metricOptions = $derived(mode === "daily" ? DAILY_METRICS : INTRADAY_METRICS);

  $effect(() => {
    const validIds = new Set(metricOptions.map((m) => m.id));
    if (!validIds.has(metric)) {
      metric = metricOptions[0]?.id ?? metric;
    }
  });

  async function load() {
    loading = true;
    error = null;
    try {
      if (mode === "daily") {
        const to = todayIso();
        const from = addDays(to, -(rangeDays - 1));
        const points = await fetchDaily(metric, from, to);
        timestamps = points.map((p) => Date.parse(`${p.date}T12:00:00Z`) / 1000);
        values = points.map((p) => p.value);
      } else {
        const points = await fetchIntraday(metric, date);
        timestamps = points.map((p) => Date.parse(p.timestamp) / 1000);
        values = points.map((p) => p.value);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      timestamps = [];
      values = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Reload whenever query parameters change.
    mode;
    metric;
    rangeDays;
    date;
    void load();
  });
</script>

<section class="section">
  <div class="controls">
    <label>
      Mode
      <select bind:value={mode}>
        <option value="daily">Daily trend</option>
        <option value="intraday">Intraday (1 day)</option>
      </select>
    </label>
    <label>
      Metric
      <select bind:value={metric}>
        {#each metricOptions as m (m.id)}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    </label>
    {#if mode === "daily"}
      <label>
        Range
        <select bind:value={rangeDays}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
        </select>
      </label>
    {:else}
      <label>
        Date
        <input type="date" bind:value={date} max={todayIso()} />
      </label>
    {/if}
    <span class="meta">{values.length} point(s)</span>
  </div>

  {#if error}
    <div class="empty bad">{error}</div>
  {:else if loading && values.length === 0}
    <div class="empty">Loading…</div>
  {:else if values.length === 0}
    <div class="empty">No data for this selection.</div>
  {:else}
    <Chart {timestamps} {values} label={metric} />
  {/if}
</section>
