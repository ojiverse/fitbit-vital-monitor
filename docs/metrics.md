# Prometheus Metrics 設計

本書は Fitbit Vitals Wrapper & Exporter プロジェクトにおける Prometheus メトリクスの設計と、現実的な監視頻度の指針をまとめる。前提として `fitbit-api.md` の調査結果と `DESIGN.md` のアーキテクチャに依拠する。

---

## 1. 設計の出発点: 「現実的な更新頻度」の上限

Fitbit データの新鮮度は **watch → phone → Fitbit cloud の同期** がボトルネックであり、こちらからは制御できない。一般に同期は約 **15 分間隔** で発生する。これより細かく polling しても新しいデータポイントは取得できないため、**15 分粒度を事実上の上限**として設計する。

| データ | Fitbit 側での実質更新頻度 | 取得経路 |
| :--- | :--- | :--- |
| 心拍数 (intraday) | ~15 分 (watch sync 依存) | High-frequency cron (15 分) |
| 歩数 / 距離 / カロリー / 階数 / AZM | ~15 分 (watch sync 依存) | `activities` webhook (一次) + daily fallback |
| 呼吸数 / SpO2 (intraday) | 睡眠中ポイント、起床後にまとめて確定 | `sleep` webhook (起床トリガー) + daily fallback |
| HRV | 睡眠中、起床後に 1 回 | `sleep` webhook (起床トリガー) + daily fallback |
| 睡眠ログ・ステージ | 起床後に 1 回 | `sleep` webhook (一次) + daily fallback |
| 皮膚温 | 睡眠中の集計、起床後に 1 回 | `sleep` webhook (起床トリガー) + daily fallback |
| 体重 / 体脂肪 / BMI | スケール使用時のイベント駆動 | `body` webhook (一次) + daily fallback |
| カーディオスコア (VO2 Max) | 運動後にまれに更新 | `sleep` webhook (起床トリガー) + daily fallback |
| デバイス情報 (バッテリー等) | 同期ごと | Hourly cron (Subscription 通知なし) |

`sleep` webhook が「起床後にクラウドが各種データを finalize したシグナル」として機能するため、Subscription 非対応の wake-up confirmed メトリクス (HRV / 皮膚温 / カーディオスコア / 呼吸数 / SpO2) も `sleep` 通知をトリガーに同時取得する (詳細は `DESIGN.md` §4.4 のディスパッチ表参照)。

---

## 2. メトリクス カタログ

命名は Prometheus 規約 (snake_case、base unit 接尾辞) に準拠する。プレフィックスは `fitbit_` で統一する。

### 2.1. バイタル

| Metric | Type | Unit | Labels | 取得元 |
| :--- | :--- | :--- | :--- | :--- |
| `fitbit_heart_rate_bpm` | gauge | bpm | — | HR intraday (最新値) |
| `fitbit_heart_rate_resting_bpm` | gauge | bpm | — | HR daily summary |
| `fitbit_hrv_rmssd_milliseconds` | gauge | ms | — | HRV intraday (sleep) |
| `fitbit_hrv_deep_rmssd_milliseconds` | gauge | ms | — | HRV (深睡眠中) |
| `fitbit_breathing_rate_per_minute` | gauge | breaths/min | — | Breathing Rate |
| `fitbit_spo2_percent` | gauge | % | — | SpO2 daily/intraday |
| `fitbit_skin_temperature_relative_celsius` | gauge | °C (baseline からの差分) | — | Skin Temp |
| `fitbit_cardio_score` | gauge | (0-100) | — | Cardio Fitness |

### 2.2. アクティビティ (本日累計値)

| Metric | Type | Unit | Labels |
| :--- | :--- | :--- | :--- |
| `fitbit_steps_today` | gauge | steps | — |
| `fitbit_distance_today_meters` | gauge | m | — |
| `fitbit_calories_today` | gauge | kcal | — |
| `fitbit_floors_today` | gauge | floors | — |
| `fitbit_active_zone_minutes_today` | gauge | min | `zone="fat_burn\|cardio\|peak\|total"` |

**gauge にする理由**: Fitbit のカウントは日付 0:00 にリセットされる。Counter にすると reset を `rate()` が誤検知する。日付ラベルは付けず「今日の累計」として扱う方が運用が素直。

### 2.3. 睡眠 (前夜の睡眠)

| Metric | Type | Unit | Labels |
| :--- | :--- | :--- | :--- |
| `fitbit_sleep_duration_seconds` | gauge | s | — |
| `fitbit_sleep_efficiency_percent` | gauge | % | — |
| `fitbit_sleep_score` | gauge | (0-100) | — |
| `fitbit_sleep_stage_seconds` | gauge | s | `stage="rem\|light\|deep\|wake"` |
| `fitbit_sleep_start_timestamp_seconds` | gauge | unixtime | — |
| `fitbit_sleep_end_timestamp_seconds` | gauge | unixtime | — |

### 2.4. 身体組成

| Metric | Type | Unit | Labels |
| :--- | :--- | :--- | :--- |
| `fitbit_weight_kilograms` | gauge | kg | — |
| `fitbit_body_fat_percent` | gauge | % | — |
| `fitbit_bmi` | gauge | — | — |

### 2.5. デバイス

| Metric | Type | Unit | Labels |
| :--- | :--- | :--- | :--- |
| `fitbit_device_battery_percent` | gauge | % | `device_id`, `device_type` |
| `fitbit_device_last_sync_timestamp_seconds` | gauge | unixtime | `device_id`, `device_type` |

**カーディナリティ**: 1 デプロイ = 1 ユーザーなのでデバイスは多くて 1〜3 個。ラベル展開しても問題ない。

### 2.6. 運用メトリクス (Wrapper 自身の健全性)

| Metric | Type | 用途 |
| :--- | :--- | :--- |
| `fitbit_api_rate_limit_remaining` | gauge | レスポンスヘッダ `Fitbit-Rate-Limit-Remaining` から |
| `fitbit_api_rate_limit_total` | gauge | クォータ総数 (通常 150) |
| `fitbit_api_rate_limit_reset_seconds` | gauge | リセットまでの秒数 |
| `fitbit_api_requests_total` | counter | `endpoint`, `status_class` (2xx/4xx/5xx) でラベル |
| `fitbit_api_request_duration_seconds` | histogram | エンドポイントごとのレイテンシ |
| `fitbit_token_expires_at_timestamp_seconds` | gauge | Access Token 失効時刻 |
| `fitbit_token_refresh_total` | counter | `result="success\|failure"` |
| `fitbit_cron_last_run_timestamp_seconds` | gauge | `job` ラベル |
| `fitbit_cron_last_success_timestamp_seconds` | gauge | `job` ラベル |
| `fitbit_cron_run_duration_seconds` | gauge | `job` ラベル |
| `fitbit_data_freshness_seconds` | gauge | `metric` ラベル。データが何秒前のものか |

**`fitbit_data_freshness_seconds` が最重要**: 「メトリクスは出ているが値が古い」状態 (例: watch がバッテリー切れ、phone が圏外、Fitbit クラウド障害) を検知するために必須。

---

## 3. 取得スケジュール (レートリミット 150 req/h の予算配分)

一次取得経路は **Webhook (Subscription)**。Cron は webhook 化できない箇所と、取りこぼしフォールバックに限定する (詳細は `DESIGN.md` §4.4 / §5)。

### 3.1. Webhook (一次経路)

| 通知コレクション | 起動 fetch | エンドポイント数 | 平均コスト (req/day) |
| :--- | :--- | ---: | ---: |
| `sleep` | sleep + HRV + 皮膚温 + cardio score + 呼吸数 + SpO2 | 6 | 6 / 日 (起床 1 回) |
| `activities` | activity summary + AZM | 2 | ~30–50 / 日 (watch sync 頻度依存) |
| `body` | weight log | 1 | 1–3 / 日 (スケール使用時のみ) |

### 3.2. Cron (フォールバック + webhook 化不能領域)

| Job | 頻度 | 取得対象 | 役割 | コスト (req/h) |
| :--- | :--- | :--- | :--- | ---: |
| High-frequency | 15 分 | 心拍 (intraday) | 一次取得 (webhook 化不能) | 4 |
| Hourly | 1 時間 | デバイス情報 | 一次取得 (Subscription 通知なし) | 1 |
| Daily fallback (8:00 JST) | 1 日 | sleep / activities / body / wake-up confirmed 系 | webhook 取りこぼし検知のみ。差分 0 ならリクエストも 0 | ~0.5 (平均) |
| Token refresh | 必要時 (~7h ごと) | OAuth refresh | — | ~0.15 |
| **小計** | | | | **~6 req/h** |

**150 req/h のクォータに対して使用率 ~4%** (webhook 起因のリクエストを 1 時間に均しても合計 ~10% 未満)。429 リトライや UI からの ad-hoc リクエスト、新しいメトリクス追加にも十分余裕がある。

---

## 4. データ保持戦略

`/metrics` のレスポンスには **最新値のみ** を出す。Prometheus が時刻軸を持つので、Wrapper 側で時系列を保持する責務は Prometheus と重複する必要はない。ただし GUI および履歴可視化のために D1 内に以下を保持する。

| データ種別 | D1 での保持 | 理由 |
| :--- | :--- | :--- |
| 最新値 (各メトリクス) | 永続 | `/metrics` および GUI の即応性のため |
| 日次サマリ | 永続 (長期) | トレンド表示・低コスト |
| Intraday 生データ (1 分粒度) | **7 日間** で削除 | ストレージ・クエリ性能の制約 |

---

## 5. Prometheus スクレイプ間隔

- `/metrics` は D1 から最新値を読むだけなので超軽量
- **30s 〜 60s 間隔のスクレイプを推奨**
- スクレイプ頻度と Fitbit pull 頻度は独立。スクレイプを細かくしても underlying データの新鮮度は変わらない。新鮮度自体は `fitbit_data_freshness_seconds` で可視化されるべき指標である

---

## 6. 監視価値のトリアージ

### 6.1. 監視価値が高い (推奨)

- 心拍数 (現在値・安静時): ダッシュボードの主役
- 歩数 / AZM: 行動可視化、目標との差分
- 睡眠スコア / 睡眠時間 / ステージ: 健康トレンドの主要指標
- HRV / 安静時心拍: 体調・自律神経のトレンド指標として最重要級
- SpO2: 異常検知 (低値アラート等)
- 運用メトリクス全般: Wrapper の健全性

### 6.2. 取得はするが頻度は低くてよい

- 体重 / 体脂肪 / BMI: 本来イベント駆動が理想 (将来 Webhook で改善)
- 皮膚温・呼吸数: 1 日 1 回で十分、トレンド分析向き
- カーディオスコア: 週次で十分

### 6.3. あえて Prometheus に出さない

| データ | 理由 |
| :--- | :--- |
| 食事ログ / 栄養 | 時系列メトリクスではなくレコード。GUI 側で D1 から直読 |
| GPS / Location | プライバシーリスクが高く、Prometheus メトリクスとして残すメリットが薄い |
| Sleep stage の分単位 timeline | 高カーディナリティで時系列 DB の用途として不適切。GUI 側で D1 直読 |

---

## 7. アラート設計の例

| アラート | 条件 | 重要度 |
| :--- | :--- | :--- |
| データ取得停止 | `fitbit_data_freshness_seconds{metric="heart_rate"} > 3600` | High |
| Cron 失敗 | `time() - fitbit_cron_last_success_timestamp_seconds > 1800` | High |
| Token 失効間近 | `fitbit_token_expires_at_timestamp_seconds - time() < 1800` | Medium |
| レートリミット枯渇 | `fitbit_api_rate_limit_remaining < 20` | Medium |
| デバイスバッテリー低下 | `fitbit_device_battery_percent < 20` | Low |
| SpO2 異常 | `fitbit_spo2_percent < 90` | High (個人判断) |
| 安静時心拍の急変 | `abs(deriv(fitbit_heart_rate_resting_bpm[7d])) > 5` | Low |

