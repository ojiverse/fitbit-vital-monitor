export type MetricCatalogEntry = {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly formatter?: (v: number) => string;
  readonly source: "intraday" | "daily";
};

export const METRIC_CATALOG: ReadonlyArray<MetricCatalogEntry> = [
  { id: "heart_rate", label: "Heart rate", unit: "bpm", source: "intraday" },
  { id: "heart_rate_resting", label: "Resting HR", unit: "bpm", source: "daily" },
  { id: "hrv_rmssd", label: "HRV (RMSSD)", unit: "ms", source: "daily" },
  { id: "hrv_deep_rmssd", label: "Deep-sleep HRV", unit: "ms", source: "daily" },
  { id: "breathing_rate", label: "Breathing rate", unit: "/min", source: "daily" },
  { id: "spo2", label: "SpO₂", unit: "%", source: "daily" },
  {
    id: "skin_temperature_relative",
    label: "Skin temp Δ",
    unit: "°C",
    source: "daily",
  },
  { id: "cardio_score", label: "Cardio score", unit: "", source: "daily" },
  { id: "steps", label: "Steps (today)", unit: "", source: "daily" },
  {
    id: "distance",
    label: "Distance (today)",
    unit: "km",
    formatter: (v) => (v / 1000).toFixed(2),
    source: "daily",
  },
  { id: "calories", label: "Calories (today)", unit: "kcal", source: "daily" },
  { id: "floors", label: "Floors (today)", unit: "", source: "daily" },
  {
    id: "azm_total",
    label: "Active Zone Min. (today)",
    unit: "min",
    source: "daily",
  },
  {
    id: "sleep_duration",
    label: "Sleep",
    unit: "h",
    formatter: (v) => (v / 3600).toFixed(1),
    source: "daily",
  },
  { id: "sleep_efficiency", label: "Sleep efficiency", unit: "%", source: "daily" },
  { id: "weight", label: "Weight", unit: "kg", source: "daily" },
  { id: "body_fat", label: "Body fat", unit: "%", source: "daily" },
  { id: "bmi", label: "BMI", unit: "", source: "daily" },
];

export const METRIC_BY_ID: Readonly<Record<string, MetricCatalogEntry>> = Object.fromEntries(
  METRIC_CATALOG.map((m) => [m.id, m]),
);
