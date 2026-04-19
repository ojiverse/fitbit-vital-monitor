<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Dashboard from "./routes/Dashboard.svelte";
  import { appState } from "./lib/app-state.svelte";
  import { formatAge } from "./lib/format";

  let tick = $state(0);
  let ticker: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    ticker = setInterval(() => {
      tick += 1;
    }, 10_000);
  });
  onDestroy(() => {
    if (ticker) clearInterval(ticker);
  });

  const lastRefreshLabel = $derived.by(() => {
    tick; // keep reactive against wall clock
    const d = appState.lastRefreshedAt;
    return d ? formatAge(d.toISOString()) : null;
  });
</script>

<div class="app-shell">
  <header class="app-header">
    <div class="app-header__brand">
      <h1>fitbit-vital-monitor</h1>
      {#if lastRefreshLabel}
        <span class="app-header__updated" title={appState.lastRefreshedAt?.toLocaleString() ?? ""}>
          最終更新 {lastRefreshLabel}
        </span>
      {/if}
    </div>
  </header>

  <Dashboard />
</div>
