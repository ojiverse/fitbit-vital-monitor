# Design Document: fitbit-vital-monitor

- **プロジェクト名**: `fitbit-vital-monitor`
- **ライセンス**: MIT
- **公開先**: GitHub (Public)

## 1. 概要 (Overview)
本システムは、**Fitbit アカウントを持つユーザーが自身でデプロイして利用する**、セルフホスト型のバイタルデータ管理・監視ツールである。1 ユーザーにつき 1 デプロイを前提とし、マルチテナント機能（ユーザー分離・認可）は持たない。

提供する主な価値は以下の3点:

1. **Fitbit API Wrapper**: OAuth 2.0 認証、トークンの自動更新、レートリミット管理といった煩雑な処理を肩代わりし、扱いやすい統一 API として再公開する。
2. **Metrics Exporter**: 取得したバイタルを Prometheus 互換の `/metrics` エンドポイントとして提供し、自身の監視基盤（Grafana, Prometheus 等）に取り込めるようにする。
3. **Graphical UI**: ブラウザ上でバイタルの可視化・履歴閲覧を行える読み取り専用のウェブ UI を提供する。Fitbit アカウントの連携はデプロイ前にローカルで完結させる (§4.1 参照)。

サーバーレスアーキテクチャ（Cloudflare Workers + D1）を採用することで、セキュアな認証情報の管理、API レートリミットの回避、およびランニングコストの最小化（無料枠内での運用）を実現する。デプロイの容易さ（ワンクリック / `wrangler deploy` 一発）を重視する。

関連ドキュメント:
- Fitbit Web API の仕様詳細: `fitbit-api.md`
- Prometheus メトリクス設計: `metrics.md`

## 2. 前提条件 (Prerequisites)
本システムは以下を前提とする。

- **Fitbit Personal アプリ登録**: Fitbit Developer ポータルでアプリ種別を **Personal** として登録する。これにより自身のデータへの Intraday API アクセスが申請なしで利用可能となる (`fitbit-api.md` §5 参照)。
- **Cloudflare アカウント**: Workers + D1 が利用可能なアカウント。無料プランで運用可能。
- **対応デバイス**: HRV, SpO2, 皮膚温, 呼吸数などの高度な指標は新しいデバイス (Sense, Charge 5 以降, Pixel Watch シリーズ等) でのみ計測される。

## 3. システムアーキテクチャ (Architecture)
システムは主に以下の3つのコンポーネントで構成される。

1. **Fitbit Web API**: データソース。OAuth 2.0 (Authorization Code Grant + PKCE) を用いて認可する。
2. **Cloudflare Workers**: バックエンドロジック。
   - **Cron Triggers**: 複数の頻度で Fitbit API からデータを取得し DB に保存するバッチ処理 (詳細は §5)。
   - **HTTP Fetch**: クライアント (ブラウザ、Prometheus) からのリクエストを処理する API サーバー。公開・読み取り専用エンドポイントと、Fitbit からの Subscription 通知を受ける webhook エンドポイント (§7.4) を含む。
3. **ローカル Bootstrap スクリプト**: デプロイ前にユーザーのローカル環境で OAuth フローを完走し、初回の `refresh_token` を取得するための CLI ツール。デプロイ済み Worker からは独立。
4. **Cloudflare D1**: メインデータベース。バイタルデータの時系列および OAuth トークン情報を保存する。

## 4. データフロー (Data Flow)

### 4.1. 初回セットアップフロー (Pre-deployment Bootstrap)
本システムは公開エンドポイントに OAuth フローを持たず、デプロイ前にローカルでトークンを取得して Secrets として注入する方式を採る。これにより認証保護が必要なエンドポイントが不要になる。

1. ユーザーがリポジトリの bootstrap スクリプトをローカルで実行する (`pnpm bootstrap` 等)。
2. スクリプトはローカルにポートを開き、Fitbit 認可ページをブラウザで開く (Authorization Code Grant + PKCE)。
3. ユーザーが Fitbit 上で同意すると、ローカル待ち受けポートに認可コードが返る。
4. スクリプトが認可コードを Fitbit のトークンエンドポイントへ送信し、初回の `access_token` / `refresh_token` / `fitbit_user_id` / `scope` を取得して標準出力に表示する。
5. ユーザーが `wrangler secret put FITBIT_REFRESH_TOKEN_SEED` 等で Secrets に投入する。
6. `wrangler deploy` でデプロイする。
7. 初回の Cron 起動時、Worker は `TokenStore` Durable Object のローカルストレージが空であれば Secret の seed を用いて refresh を実行し、得られたトークンを DO ストレージに保存する (副次的に D1 `auth_tokens` にもミラーする)。

#### トークン保存レイヤー
- **正本 (authoritative)**: `TokenStore` Durable Object のローカルストレージ (`singleton` 名で 1 インスタンス)。強整合で、D1 ネットワーク書き込みの失敗が rotation 損失に直結しない。
- **ミラー**: D1 `auth_tokens` テーブル。`wrangler d1 execute ... SELECT` で中の状態を観測する用途、および旧デプロイからの初回読み取り互換のために保持する。ミラー書き込み失敗は致命ではなく、次回 refresh 時に自己修復される。
- **フォールバック順**: (1) DO ストレージ → (2) D1 ミラー (移行用に 1 度だけ) → (3) Secret seed

#### 自動リカバリ (seed fallback)
保存済みの refresh_token が Fitbit に `401` / `403` で拒否された場合、Worker は自動的に `FITBIT_REFRESH_TOKEN_SEED` で 1 回だけリトライする。これにより「Fitbit 側で rotation 済み、こちら側は旧 token のまま」というデッドロック状態から運用オペレーションなしで復帰できる。seed と保存 token が同一の場合はループを避けるためにリトライしない。

#### 再ブートストラップが必要なケース
- Fitbit 側で連携を revoke された
- seed も保存 token も共に失効した (長期停止後など)

これらの場合はローカルで bootstrap スクリプトを再実行し、新しい seed を `wrangler secret put FITBIT_REFRESH_TOKEN_SEED` で上書きする。DO ストレージと D1 ミラーの双方を明示的にクリアする必要がある場合は、D1 行の `DELETE FROM auth_tokens WHERE id = 1` を実行した上で `TokenStore` の `delete` (DO への管理 API を別途用意するか、DO を再作成する) を行う。

### 4.2. 共通取得ルーチン (Shared Ingestion Routine)
Cron (§5) と Webhook (§4.4) のいずれから呼び出された場合も、最終的なデータ取り込みは以下の共通ルーチンを通る。実装上は `apps/worker/src/ingest/` 配下に取得関数群を集約し、cron ハンドラと webhook ハンドラはどちらもこの関数を呼ぶ薄いディスパッチャになる。

1. `auth_tokens` から現在のトークンを取得。`expires_at` と現在時刻を比較し、失効間近 (例: 残り 30 分未満) であれば `refresh_token` を用いて更新する。
2. 取得したトークンで Fitbit API の対象エンドポイント群を呼び出す。日付パラメータは `USER_TIMEZONE` (`wrangler.toml` の var、デフォルト `Asia/Tokyo`) で確定したローカル日付を用いる。
3. 取得データを D1 に保存する:
   - 生の intraday データは `vitals` テーブルに `INSERT`
   - 日次集計は `vitals_daily` テーブルに `UPSERT`
4. レスポンスヘッダ `Fitbit-Rate-Limit-*` の値を `rate_limit_state` テーブルに記録する。
5. トークンを Refresh した場合は `auth_tokens` を `UPDATE` する (refresh_token もローテーションされるため必ず上書き)。

呼び出し側 (cron / webhook) は「どの fetch 群を、どの日付で起動するか」のみを決定する。

### 4.2.1. 初回 Backfill
初回 cron 起動時 (= D1 の `vitals_daily` が空の場合)、過去のデータを一括取得して履歴を初期化する。

- **対象期間**: intraday は過去 7 日、daily 系は過去 30 日
- **実行方法**: 通常の cron ジョブ群が「空 DB を検知 → backfill モードに切り替え」る
- **レートリミット配慮**: 1 回の cron で全 backfill を行うとクォータを瞬間的に消費するため、3〜4 回に分割して実行する

### 4.3. データ提供フロー (Serving - HTTP Fetch)
GUI / Prometheus 向けの公開エンドポイントは認証なしの読み取り専用。バイタルデータは公開を許容する設計判断である (§8 参照)。

- **GUI / ポートフォリオからのアクセス**: Workers が D1 から最新値および日次サマリを取得し、JSON 形式で返す。CORS は `*` を許可する。
- **Prometheus からのアクセス**: `/metrics` へのアクセスに対し、D1 の最新値を Prometheus exposition フォーマット (text/plain) に変換して返す。

### 4.4. イベント駆動取得フロー (Ingestion - Webhook)
Fitbit Subscription API の push 通知を **一次取得経路** として用いる。`fitbit-api.md` §2 の通り通知本体にはデータ実体が含まれないため、「どのコレクションが更新されたか」をトリガーにして Worker 側が Fitbit から GET し直す方式となる。

#### フロー
1. Fitbit から `POST /webhook/fitbit` に通知が届く (ボディは更新コレクション + ユーザー ID の配列のみ)。
2. Worker は `X-Fitbit-Signature` ヘッダを検証する (`HMAC-SHA1(body, CLIENT_SECRET)` の Base64)。失敗時は `401` を返して処理を打ち切る。
3. 検証成功時は即座に `204 No Content` を返し (Fitbit の 3 秒タイムアウト対策)、実データの GET は `ctx.waitUntil` でバックグラウンド実行する。
4. バックグラウンド処理は §4.2 と同じ取得ルーチン (トークン取得 → Fitbit GET → D1 upsert → rate limit 記録) を再利用する。cron と webhook で取得コードを 1 本に統合する。
5. Subscription の登録は Fitbit の `POST /1/user/-/{collection}/apiSubscriptions/{subscriptionId}.json` を bootstrap スクリプトから呼ぶ。`subscriberId` は Fitbit Developer ポータルで事前に登録する。
6. Subscriber 登録時に Fitbit は `GET /webhook/fitbit?verify=<token>` で verification challenge を送る。`verify` 値が Secret `FITBIT_SUBSCRIBER_VERIFY` と一致すれば `204`、不一致なら `404` を返す (Fitbit 仕様)。

#### コレクション → Fetch 群のディスパッチ表

通知 1 件あたり、対応する fetch 群をまとめて起動する。**`sleep` 通知は「起床後にクラウドが各種データを finalize したシグナル」と解釈し、Subscription 非対応の wake-up confirmed 系メトリクス (HRV / 皮膚温 / カーディオスコア / 呼吸数 / SpO2) も同じトリガーで取得する。** これにより post-wake cron を webhook 駆動に置き換えられる。

| 受信コレクション | 起動する fetch | 取得メトリクス | 対象日付 |
| :--- | :--- | :--- | :--- |
| `sleep` | `getSleep` | `sleep_duration` / `sleep_efficiency` / `sleep_start` / `sleep_end` (+ stage segments を `meta` に保存) | 前日 (USER_TIMEZONE) |
| `sleep` (opportunistic) | `getHrv` / `getSkinTemp` / `getCardioScore` / `getBreathingRate` / `getSpo2Daily` | `hrv_rmssd` / `hrv_deep_rmssd` / `skin_temperature_relative` / `cardio_score` / `breathing_rate` / `spo2` | 前日 |
| `activities` | `getActivitySummary` / `getAzmSummary` | `steps` / `distance` / `calories` / `floors` / `azm_total` / `azm_fat_burn` / `azm_cardio` / `azm_peak` | 当日 |
| `body` | `getWeightLog` | `weight` / `body_fat` / `bmi` | 当日 |
| `foods` | (本プロジェクトでは未使用) | — | — |

Subscription 通知に含まれる `date` フィールドは更新が発生した日 (= 通知時点の Fitbit ローカル日付) を意味する。`sleep` の場合 Worker 側では「前日」を当日として取得し直す (起床は当日朝、対象の睡眠は前夜のため)。

#### 冪等性とリプレイ
Fitbit 側で重複・順序保証はないため、Worker 側で「同じ日付・メトリクスを何度 upsert しても結果が同じ」状態を保つ。`vitals_daily` は `PRIMARY KEY (date, metric_type)` の UPSERT で担保済み。リプレイ攻撃が成立しても結果は idempotent な再書き込みに留まる。

## 5. Cron ジョブ設計

データ取得の **一次経路は webhook (§4.4)**。Cron は (a) webhook 化できない intraday 心拍、(b) Subscription 通知が来ないデバイス情報、(c) webhook 取りこぼしのための日次フォールバック、の 3 つの役割に絞る。

| Job | 頻度 | 対象 | 役割 | コスト (req/h) |
| :--- | :--- | :--- | :--- | ---: |
| High-frequency | 15 分 | 心拍 (intraday) | 一次取得 (webhook 化不能) | 4 |
| Hourly | 1 時間 | デバイス情報 | 一次取得 (webhook 通知なし) | 1 |
| Daily fallback | 1 日 (8:00 JST) | sleep / activities / body / wake-up confirmed 系全般 | webhook 取りこぼし検知 | ~0.5 |
| Token refresh | 必要時 (~7h ごと) | OAuth refresh | — | ~0.15 |
| **合計** | | | | **~6 req/h** |

#### Webhook 化前後のコスト変化
| 項目 | Before | After |
| :--- | ---: | ---: |
| High-frequency cron 内 fetch 数 | 心拍 + activity + AZM = 3 メトリクス × 4回/h = 12 req/h | 心拍のみ × 4 = 4 req/h |
| Hourly cron 内 fetch 数 | 呼吸数 + SpO2 + デバイス = 3 req/h | デバイスのみ = 1 req/h |
| Body cron (4h) | 体重 = 0.25 req/h | 廃止 (webhook 化) |
| Post-wake cron (1日) | sleep + HRV + 皮膚温 + cardio = 0.2 req/h | Daily fallback に統合 |
| **小計** | ~15.4 req/h | ~5.5 req/h |

クォータ使用率は ~4%。一次経路を webhook に寄せたことで cron 起因の req/h は約 1/3 になり、ad-hoc リクエストや 429 リトライにも余裕がある。Webhook 起因のリクエストは更新発生時のみなので長期平均でも cron 比で大幅に少ない。

#### Daily fallback の責務
8:00 JST に 1 回起動し、`vitals_daily` を走査して「直近 N 日間で値が欠けている日」を検出した場合のみ Fitbit を叩いて補完する (`util/backfill.ts` の既存ロジックを流用)。すべて揃っていればリクエストを発行しないため、平常時はほぼ 0 req。Webhook が安定して届いていれば fallback は実質的に no-op になる。

## 6. データベース設計 (Database Schema - D1)

### `vitals` テーブル
intraday 粒度の生データを保存する。**保持期間 7 日** (それ以降は別ジョブで削除)。

| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | INTEGER | 主キー (Auto Increment) |
| `timestamp` | DATETIME | データの計測日時 (ISO 8601) |
| `metric_type` | TEXT | 指標の種類 (例: `heart_rate`, `steps`) |
| `value` | REAL | 測定値 |

```sql
CREATE TABLE vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME NOT NULL,
  metric_type TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX idx_vitals_timestamp ON vitals(timestamp);
CREATE INDEX idx_vitals_type_timestamp ON vitals(metric_type, timestamp);
```

### `vitals_daily` テーブル
日次集計データを永続保存する。GUI の長期トレンド表示および `/metrics` の daily summary 系メトリクスに利用する。

| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `date` | TEXT | 対象日 (`YYYY-MM-DD`) |
| `metric_type` | TEXT | 指標の種類 (例: `sleep_score`, `resting_heart_rate`, `hrv_rmssd`) |
| `value` | REAL | 集計値 |
| `meta` | TEXT | 補助情報 (JSON, 例: 睡眠ステージ別秒数など) |

```sql
CREATE TABLE vitals_daily (
  date TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  value REAL NOT NULL,
  meta TEXT,
  PRIMARY KEY (date, metric_type)
);
CREATE INDEX idx_vitals_daily_type_date ON vitals_daily(metric_type, date);
```

### `auth_tokens` テーブル
OAuth トークンを永続化・更新するために使用する。常に `id = 1` のレコードを更新する。

| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | INTEGER | 主キー (常に 1) |
| `access_token` | TEXT | 現在のアクセストークン |
| `refresh_token` | TEXT | 次回更新に使うリフレッシュトークン (ローテーションされるため必ず上書き) |
| `expires_at` | DATETIME | アクセストークンの失効時刻 (proactive refresh 用) |
| `scope` | TEXT | 付与された scope のスペース区切り文字列 |
| `fitbit_user_id` | TEXT | Fitbit 側のユーザー ID |
| `updated_at` | DATETIME | トークンの最終更新日時 |

```sql
CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  scope TEXT NOT NULL,
  fitbit_user_id TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);
```

### `rate_limit_state` テーブル
Fitbit API のレートリミットヘッダを記録し、運用メトリクスおよび過剰リクエスト防止に使う。常に `id = 1` のレコードを更新する。

| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | INTEGER | 主キー (常に 1) |
| `limit_total` | INTEGER | クォータ総数 (通常 150) |
| `remaining` | INTEGER | 残リクエスト数 |
| `reset_at` | DATETIME | リセット予定時刻 |
| `updated_at` | DATETIME | 最終更新日時 |

## 7. API エンドポイント仕様 (Endpoints)

GUI / Prometheus 向けエンドポイントはすべて公開・認証なし・読み取り専用。唯一の例外は Fitbit からの Subscription 通知を受ける webhook (§7.4) で、これは HTTP メソッドとしては `POST` になるが、正当性は Fitbit の署名 (HMAC-SHA1) によって担保する (§8.1 参照)。OAuth 関連エンドポイントは存在しない。

### 7.1. GUI / ポートフォリオ向け API
- **`GET /api/vitals/latest`**: 各メトリクスの最新値を JSON で返す。
- **`GET /api/vitals/daily?metric=<name>&from=<date>&to=<date>`**: 指定メトリクスの日次サマリ系列を返す。GUI のトレンドグラフ用。
- **`GET /api/vitals/intraday?metric=<name>&date=<date>`**: 指定日の intraday 生データを返す (保持期間 7 日内のみ)。
- CORS は `Access-Control-Allow-Origin: *`。

### 7.2. Prometheus Scraper 向け API
- **`GET /metrics`**: 最新値のみを Prometheus exposition フォーマット (text/plain) で返す。
- メトリクスのカタログ (名前、型、ラベル、単位) は `metrics.md` §2 に定義する。
- Prometheus 側のスクレイプ間隔は 30〜60s を推奨。

### 7.3. GUI ルート
- **`GET /`**: ダッシュボード (最新値・トレンドグラフ)。
- **`GET /history`**: 履歴閲覧。

設定変更系の画面 (`/setup`, `/settings`) は存在しない。設定はすべて `wrangler.toml` および Secrets で管理する。

### 7.4. Fitbit Subscription Webhook
Fitbit の Subscription API からの push 通知を受けて低レイテンシでデータを取り込むエンドポイント。認証は署名検証 (§8.1) で担保し、処理は短時間で完結させる。データ取り込みの実装ロジックは §4.2 の cron と共通で、対象日付のみ webhook 由来に差し替える。

- **`POST /webhook/fitbit`**: Fitbit からの通知受信口。
  - リクエストボディは更新があったコレクションとユーザー ID の配列のみで、データ実体は含まれない。
  - ヘッダ `X-Fitbit-Signature` を `HMAC-SHA1(body, FITBIT_CLIENT_SECRET)` の Base64 値と比較して検証する。検証失敗時は `401` を返す。
  - 検証成功時は即座に `204 No Content` を返し、実データの GET は `ctx.waitUntil` でバックグラウンド実行する (Fitbit 側のタイムアウトは 3 秒)。
- **`GET /webhook/fitbit?verify=<token>`**: Fitbit Developer ポータルでの Subscriber 登録時に届く verification challenge。`token` が Secret `FITBIT_SUBSCRIBER_VERIFY` と一致すれば `204`、不一致なら `404` を返す (Fitbit 仕様)。

本エンドポイントは CORS ヘッダを返さない (ブラウザから呼ぶ用途ではない)。

## 8. セキュリティと制約事項 (Security & Constraints)

### 8.1. 認証モデル
- **OAuth エンドポイントは存在しない**。ユーザー認証・セッション管理・書き込み系業務 API も存在しない。これにより通常の意味での「認証保護が必要なエンドポイント」は 0 になる。
- 公開エンドポイント (`/api/*`, `/metrics`, GUI) は **すべて認証なし読み取り専用**。バイタルデータをポートフォリオ的に公開する用途を前提としたデザイン。
- 個人情報を非公開にしたいユーザーは本システムの想定外。フォークしてアクセス制御を追加する必要がある。

#### 例外: Fitbit Webhook (`POST /webhook/fitbit`)
Subscription 通知の受信は HTTP メソッド上は書き込み (`POST`) だが、**Fitbit が `HMAC-SHA1(body, FITBIT_CLIENT_SECRET)` で署名した通知のみを受理**することで正当性を担保する。`CLIENT_SECRET` はサーバー側でしか保持できないため、事実上 Fitbit 以外は有効な通知を生成できない。

この署名検証をもって「認証保護」の代替とする設計判断を採り、セッション・API キー・Bearer トークンなどの通常の認証機構は導入しない。したがって以下の前提が成立する:

- 署名検証に失敗したリクエストは副作用なしで `401` を返して破棄する (D1 への書き込み、Fitbit API 呼び出し、いずれも発生させない)。
- 通知本体にはデータ実体が含まれず、Worker 側は「どのコレクションが更新されたか」のシグナルとしてのみ使う。実データは Worker が自らトークンを用いて Fitbit から GET する。したがって署名偽装が仮に成功しても、攻撃者は「正規のデータを D1 に入れる」以上の悪用はできない (DoS については §8.4 のレートリミット配慮で吸収)。
- リプレイ攻撃対策は署名に加え、`vitals_daily` の `PRIMARY KEY (date, metric_type)` による UPSERT 冪等性で実害を無効化する。

### 8.2. シークレット管理
Cloudflare Workers の Secrets として以下を保存する。

| Secret | 用途 |
| :--- | :--- |
| `FITBIT_CLIENT_ID` | Fitbit OAuth クライアント ID。refresh 時に必要 |
| `FITBIT_CLIENT_SECRET` | Fitbit OAuth クライアント秘密鍵。refresh 時、および webhook の署名検証鍵として使用 |
| `FITBIT_REFRESH_TOKEN_SEED` | 初回 bootstrap 用の refresh_token (使い切り) |
| `FITBIT_SUBSCRIBER_VERIFY` | Fitbit Developer ポータルで Subscriber 登録時に発行される verification code。`GET /webhook/fitbit?verify=<token>` のチャレンジ応答で一致確認に使う |

### 8.2.1. 環境変数 (`wrangler.toml [vars]`)
秘匿性のない設定値は plain な vars として宣言する。

| Variable | デフォルト | 用途 |
| :--- | :--- | :--- |
| `USER_TIMEZONE` | `Asia/Tokyo` | Fitbit のローカル日付確定および日次 cron の起床時刻決定に使用 |

### 8.3. OAuth フロー
- Bootstrap スクリプトでは Authorization Code Grant + PKCE を採用する。Implicit Grant は使用しない。
- `refresh_token` は使い切り仕様 (`fitbit-api.md` §3.2) のため、Worker 側では Durable Object ストレージに保存された最新値を正本として使用する。Secret の seed は (a) DO ストレージと D1 ミラーの双方が空の初回起動時、および (b) 保存済み token が Fitbit に拒否された場合の自動リカバリ時 (§4.1 参照) に参照される。

### 8.4. その他の制約
- **Fitbit API レートリミット**: 1 ユーザーにつき 150 リクエスト / 時。本設計では ~16 req/h 程度に抑え、429 リトライや手動操作の余地を残す。
- **Cloudflare 無料枠**: Workers は 1 日 10 万リクエスト、D1 は 1 日 10 万回の読み出し / 10 万回の書き込みまで無料。本用途であれば無料枠内に十分収まる。
- **Personal アプリ前提**: Intraday API は Personal アプリで申請なしに利用可能。Server / Client アプリでデプロイすると Intraday が使えなくなる点に注意。

## 9. 今後の拡張性 (Future Enhancements)

- **Grafana 連携テンプレート**: 標準的なダッシュボード JSON を同梱し、ユーザーがすぐに可視化を始められるようにする。
- **アラートルールの同梱**: `metrics.md` §7 で定義したアラート群を Prometheus アラートルール YAML として配布する。
- **エクスポート機能**: 蓄積データを CSV / JSON で一括ダウンロードできる機能を GUI に追加する。
