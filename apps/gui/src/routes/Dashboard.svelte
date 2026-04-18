<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fetchLatest, type LatestResponse } from "../lib/api";
  import { formatAge } from "../lib/format";
  import MetricCard from "../components/MetricCard.svelte";

  let data = $state<LatestResponse | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      data = await fetchLatest();
      error = null;
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

  const intradayEntries = $derived(data?.intraday ?? []);
  const dailyEntries = $derived(data?.daily ?? []);
  const devices = $derived(data?.devices ?? []);
</script>

{#if loading && !data}
  <div class="empty">Loading latest vitals…</div>
{:else if error}
  <div class="empty bad">Failed to load: {error}</div>
{:else if data}
  <section class="section">
    <h2>Current (intraday)</h2>
    {#if intradayEntries.length === 0}
      <div class="empty">No intraday data yet. The next cron tick will populate this.</div>
    {:else}
      <div class="cards">
        {#each intradayEntries as sample (sample.metricType)}
          <MetricCard
            metric={sample.metricType}
            value={sample.value}
            timestamp={sample.timestamp}
          />
        {/each}
      </div>
    {/if}
  </section>

  <section class="section">
    <h2>Daily summaries</h2>
    {#if dailyEntries.length === 0}
      <div class="empty">No daily summaries yet.</div>
    {:else}
      <div class="cards">
        {#each dailyEntries as sample (sample.metricType)}
          <MetricCard
            metric={sample.metricType}
            value={sample.value}
            timestamp={`${sample.timestamp}T12:00:00.000Z`}
          />
        {/each}
      </div>
    {/if}
  </section>

  <section class="section">
    <h2>Devices</h2>
    {#if devices.length === 0}
      <div class="empty">No devices reported yet.</div>
    {:else}
      <div class="cards">
        {#each devices as dev (dev.id)}
          <div class="card">
            <span class="label">{dev.type} · {dev.id}</span>
            <span class="value small">
              {dev.batteryLevel !== null ? `${dev.batteryLevel}%` : "—"}
              <span class="unit">battery</span>
            </span>
            <span class="meta">Last sync {formatAge(dev.lastSyncAt)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}
