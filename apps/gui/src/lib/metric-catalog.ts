export type MetricCategory =
  | "heart"
  | "respiratory"
  | "temperature"
  | "fitness"
  | "activity"
  | "sleep";

export type MetricCatalogEntry = {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly formatter?: (v: number) => string;
  readonly source: "intraday" | "daily";
  readonly category: MetricCategory;
  readonly icon: string;
  readonly description: string;
  readonly healthyRange?: string;
  readonly precision?: number;
};

export type CategoryMeta = {
  readonly id: MetricCategory;
  readonly label: string;
  readonly tagline: string;
  readonly accent: string;
};

export const CATEGORIES: ReadonlyArray<CategoryMeta> = [
  {
    id: "heart",
    label: "心臓・自律神経",
    tagline: "心拍と HRV から心血管・自律神経の状態を読み取る指標",
    accent: "#f47174",
  },
  {
    id: "respiratory",
    label: "呼吸・血中酸素",
    tagline: "睡眠中に計測される呼吸数と SpO₂",
    accent: "#5ea8ff",
  },
  {
    id: "sleep",
    label: "睡眠",
    tagline: "前夜の睡眠の長さと質",
    accent: "#a78bfa",
  },
  {
    id: "activity",
    label: "今日のアクティビティ",
    tagline: "今日 00:00 からの累計 (深夜 0 時にリセットされます)",
    accent: "#5fd1a7",
  },
  {
    id: "fitness",
    label: "フィットネス",
    tagline: "有酸素能力の推定値 (VO₂ Max ベース)",
    accent: "#f2b45c",
  },
  {
    id: "temperature",
    label: "皮膚温",
    tagline: "睡眠中に計測される皮膚温のベースラインからのズレ",
    accent: "#f9c846",
  },
];

export const CATEGORY_BY_ID: Readonly<Record<MetricCategory, CategoryMeta>> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Readonly<Record<MetricCategory, CategoryMeta>>;

// Single-path SVG icons (24x24 viewBox). Keep simple so they render consistently.
const ICON = {
  heart:
    "M12 21s-7-4.35-9.5-9.28C.92 8.4 2.9 5 6.3 5c1.7 0 3.3.8 4.3 2.1C11.6 5.8 13.2 5 14.9 5c3.4 0 5.4 3.4 3.8 6.72C19 16.65 12 21 12 21z",
  pulse: "M2 12h4l2-6 4 12 3-9 2 6 2-3h3",
  lungs:
    "M8 3v8c0 3-2 4-4 4s-3 1-3 4v4h6v-4c0-2 2-3 2-6V3zm8 0v10c0 3 2 4 2 6v4h6v-4c0-3-1-4-3-4s-4-1-4-4V3z",
  droplet: "M12 2s-6 7-6 12a6 6 0 0 0 12 0C18 9 12 2 12 2z",
  moon: "M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z",
  steps: "M5 20h4l1-5H6zm9-8h4l1-5h-4zm-4-2h4l1-5h-4z",
  distance: "M12 2 5 20h4l3-8 3 8h4z",
  flame: "M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 1-2 1-2s-1 3 1 5a3 3 0 0 0 6 0c0-3-4-7-4-11z",
  floors: "M4 20h4v-4H4zm0-6h8v-4H4zm0-6h12V4H4z",
  zone: "M12 2 3 9l9 13 9-13zM6 9l6-4 6 4-6 9z",
  temperature: "M14 14V4a2 2 0 1 0-4 0v10a4 4 0 1 0 4 0z",
  fitness: "M20 12h-2l-2 5-4-13-4 10-2-2H2",
} as const;

function formatUnixTimeHHMM(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  const d = new Date(v * 1000);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export const METRIC_CATALOG: ReadonlyArray<MetricCatalogEntry> = [
  {
    id: "heart_rate",
    label: "心拍数 (現在)",
    unit: "bpm",
    source: "intraday",
    category: "heart",
    icon: ICON.pulse,
    description: "watch から直近に記録された 1 分粒度の心拍。",
    healthyRange: "安静時 60–100",
  },
  {
    id: "heart_rate_resting",
    label: "安静時心拍数",
    unit: "bpm",
    source: "daily",
    category: "heart",
    icon: ICON.heart,
    description: "Fitbit が 1 日の睡眠と静止時間から推定した安静時心拍数。",
    healthyRange: "60–80",
  },
  {
    id: "hrv_rmssd",
    label: "HRV (RMSSD)",
    unit: "ms",
    source: "daily",
    category: "heart",
    icon: ICON.pulse,
    description: "睡眠中の心拍間隔のばらつき。副交感神経の活動度合いの目安。",
    healthyRange: "成人 20–80",
  },
  {
    id: "hrv_deep_rmssd",
    label: "深睡眠中 HRV",
    unit: "ms",
    source: "daily",
    category: "heart",
    icon: ICON.pulse,
    description: "深睡眠フェーズのみで算出した HRV。回復の指標として安定しやすい。",
    healthyRange: "成人 20–80",
  },
  {
    id: "breathing_rate",
    label: "呼吸数",
    unit: "回/分",
    source: "daily",
    category: "respiratory",
    icon: ICON.lungs,
    description: "睡眠中の 1 分あたり呼吸回数の平均。",
    healthyRange: "12–20 回/分",
  },
  {
    id: "spo2",
    label: "血中酸素飽和度 (SpO₂)",
    unit: "%",
    source: "daily",
    category: "respiratory",
    icon: ICON.droplet,
    description: "睡眠中の平均 SpO₂。呼吸の質や睡眠時無呼吸の傾向を示す。",
    healthyRange: "95% 以上",
  },
  {
    id: "skin_temperature_relative",
    label: "皮膚温の変化",
    unit: "°C",
    source: "daily",
    category: "temperature",
    icon: ICON.temperature,
    description: "自身のベースライン皮膚温からの差 (Fitbit 基準値との差分)。",
    healthyRange: "±1.0 °C 以内",
    precision: 2,
  },
  {
    id: "cardio_score",
    label: "カーディオスコア",
    unit: "",
    source: "daily",
    category: "fitness",
    icon: ICON.fitness,
    description: "VO₂ Max ベースの有酸素能力スコア。運動時のみ更新。",
    healthyRange: "男性 ≥42 / 女性 ≥35",
  },
  {
    id: "steps",
    label: "歩数",
    unit: "歩",
    source: "daily",
    category: "activity",
    icon: ICON.steps,
    description: "今日 00:00 から現在までの累計歩数。",
    healthyRange: "目標 7,000–10,000",
  },
  {
    id: "distance",
    label: "移動距離",
    unit: "km",
    formatter: (v) => (v / 1000).toFixed(2),
    source: "daily",
    category: "activity",
    icon: ICON.distance,
    description: "今日歩いた / 走った距離の累計 (GPS・歩数推定)。",
  },
  {
    id: "calories",
    label: "消費カロリー",
    unit: "kcal",
    source: "daily",
    category: "activity",
    icon: ICON.flame,
    description: "基礎代謝 + 活動による今日の推定消費カロリー。",
  },
  {
    id: "floors",
    label: "上った階数",
    unit: "階",
    source: "daily",
    category: "activity",
    icon: ICON.floors,
    description: "高度センサーが検出した今日の上昇階数 (約 3m で 1 階)。",
  },
  {
    id: "azm_total",
    label: "アクティブゾーン時間 (合計)",
    unit: "分",
    source: "daily",
    category: "activity",
    icon: ICON.zone,
    description:
      "Fat Burn / Cardio / Peak ゾーンに入った合計時間 (Cardio/Peak は 2 倍加算、WHO 基準連動)。",
    healthyRange: "週 150 分目安",
  },
  {
    id: "azm_fat_burn",
    label: "AZM: Fat Burn",
    unit: "分",
    source: "daily",
    category: "activity",
    icon: ICON.zone,
    description: "心拍予備能 50–69% の軽〜中強度ゾーンにいた分数 (1 分 = 1 pt)。",
  },
  {
    id: "azm_cardio",
    label: "AZM: Cardio",
    unit: "分",
    source: "daily",
    category: "activity",
    icon: ICON.zone,
    description: "心拍予備能 70–84% の中〜高強度ゾーンにいた分数 (合計には 2 倍換算)。",
  },
  {
    id: "azm_peak",
    label: "AZM: Peak",
    unit: "分",
    source: "daily",
    category: "activity",
    icon: ICON.zone,
    description: "心拍予備能 85% 以上の高強度ゾーンにいた分数 (合計には 2 倍換算)。",
  },
  {
    id: "sleep_duration",
    label: "睡眠時間",
    unit: "時間",
    formatter: (v) => (v / 3600).toFixed(1),
    source: "daily",
    category: "sleep",
    icon: ICON.moon,
    description: "前夜の総睡眠時間 (覚醒時間を除く)。",
    healthyRange: "7–9 時間",
  },
  {
    id: "sleep_efficiency",
    label: "睡眠効率",
    unit: "%",
    source: "daily",
    category: "sleep",
    icon: ICON.moon,
    description: "就寝から起床までのうち実際に眠っていた割合。",
    healthyRange: "85% 以上",
  },
  {
    id: "sleep_start",
    label: "就寝時刻",
    unit: "",
    source: "daily",
    category: "sleep",
    icon: ICON.moon,
    description: "前夜にベッドに入った時刻 (端末ローカルタイムゾーン)。",
    formatter: formatUnixTimeHHMM,
  },
  {
    id: "sleep_end",
    label: "起床時刻",
    unit: "",
    source: "daily",
    category: "sleep",
    icon: ICON.moon,
    description: "今朝目覚めてベッドを出た時刻 (端末ローカルタイムゾーン)。",
    formatter: formatUnixTimeHHMM,
  },
];

export const METRIC_BY_ID: Readonly<Record<string, MetricCatalogEntry>> = Object.fromEntries(
  METRIC_CATALOG.map((m) => [m.id, m]),
);

export function metricsInCategory(category: MetricCategory): ReadonlyArray<MetricCatalogEntry> {
  return METRIC_CATALOG.filter((m) => m.category === category);
}
