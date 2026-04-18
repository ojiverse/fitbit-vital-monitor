<script lang="ts">
  import { METRIC_BY_ID } from "../lib/metric-catalog";
  import { formatAge, formatNumber } from "../lib/format";

  type Props = {
    metric: string;
    value: number;
    timestamp: string;
  };
  const { metric, value, timestamp }: Props = $props();

  const entry = $derived(METRIC_BY_ID[metric]);
  const displayValue = $derived(
    entry?.formatter ? entry.formatter(value) : formatNumber(value),
  );
  const label = $derived(entry?.label ?? metric);
  const unit = $derived(entry?.unit ?? "");
</script>

<div class="card">
  <span class="label">{label}</span>
  <span class="value">
    {displayValue}
    {#if unit}<span class="unit">{unit}</span>{/if}
  </span>
  <span class="meta">{formatAge(timestamp)}</span>
</div>
