<script lang="ts">
  import Dashboard from "./routes/Dashboard.svelte";
  import History from "./routes/History.svelte";

  type Tab = "dashboard" | "history";
  let tab = $state<Tab>("dashboard");

  function hashToTab(h: string): Tab {
    return h === "#history" ? "history" : "dashboard";
  }
  if (typeof window !== "undefined") {
    tab = hashToTab(window.location.hash);
    window.addEventListener("hashchange", () => {
      tab = hashToTab(window.location.hash);
    });
  }

  function pick(next: Tab) {
    tab = next;
    if (typeof window !== "undefined") {
      window.location.hash = next === "dashboard" ? "" : `#${next}`;
    }
  }
</script>

<div class="app-shell">
  <header class="app-header">
    <h1>fitbit-vital-monitor</h1>
    <nav class="nav-tabs">
      <button class:active={tab === "dashboard"} onclick={() => pick("dashboard")}>
        Dashboard
      </button>
      <button class:active={tab === "history"} onclick={() => pick("history")}>
        History
      </button>
    </nav>
  </header>

  {#if tab === "dashboard"}
    <Dashboard />
  {:else}
    <History />
  {/if}
</div>
