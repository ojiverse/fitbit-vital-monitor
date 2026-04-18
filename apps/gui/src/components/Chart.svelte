<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import uPlot, { type AlignedData, type Options } from "uplot";

  type Props = {
    timestamps: ReadonlyArray<number>;
    values: ReadonlyArray<number>;
    label: string;
    height?: number;
  };
  const { timestamps, values, label, height = 260 }: Props = $props();

  let container: HTMLDivElement;
  let chart: uPlot | null = null;

  function build(width: number) {
    if (!container) return;
    if (chart) {
      chart.destroy();
      chart = null;
    }
    const data: AlignedData = [
      Array.from(timestamps),
      Array.from(values),
    ];
    const opts: Options = {
      width,
      height,
      scales: { x: { time: true } },
      series: [
        { label: "time" },
        {
          label,
          stroke: "#5ea8ff",
          width: 2,
          points: { show: values.length < 40 },
        },
      ],
      axes: [
        { stroke: "#9aa0a6", grid: { stroke: "#2a2e38", width: 1 } },
        { stroke: "#9aa0a6", grid: { stroke: "#2a2e38", width: 1 } },
      ],
      legend: { show: true },
    };
    chart = new uPlot(opts, data, container);
  }

  function redraw() {
    const width = container?.getBoundingClientRect().width ?? 600;
    build(width);
  }

  onMount(() => {
    redraw();
    const ro = new ResizeObserver(() => {
      if (!chart || !container) return;
      const w = container.getBoundingClientRect().width;
      chart.setSize({ width: w, height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    chart?.destroy();
    chart = null;
  });

  $effect(() => {
    // Rebuild whenever data changes.
    timestamps;
    values;
    label;
    untrack(() => redraw());
  });
</script>

<div class="chart-wrap" bind:this={container}></div>
