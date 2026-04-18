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
   - **HTTP Fetch**: クライアント (ブラウザ、Prometheus) からのリクエストを処理する API サーバー。すべて公開・読み取り専用。
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
7. 初回の Cron 起動時、Worker は D1 の `auth_tokens` が空であれば Secret の seed を用いて refresh を実行し、得られたトークンを D1 に保存する。以降は D1 上のトークンのみで動作する (Secret は再参照されない)。

#### 再ブートストラップが必要なケース
- D1 を誤って消去した
- Fitbit 側で連携を revoke された
- 長期間 Worker が停止し refresh_token が失効した

これらの場合はローカルで bootstrap スクリプトを再実行し、新しい seed を `wrangler secret put` で上書きしたうえで D1 の `auth_tokens` 行を削除する。

### 4.2. データ収集フロー (Ingestion - Cron)
1. Cron Trigger が起動する (ジョブごとに頻度が異なる。詳細は §5)。
2. `auth_tokens` から現在のトークンを取得。`expires_at` と現在時刻を比較し、失効間近 (例: 残り 30 分未満) であれば `refresh_token` を用いて更新する。
3. 取得したトークンで Fitbit API の対象エンドポイント群を呼び出す。日付パラメータは `USER_TIMEZONE` (`wrangler.toml` の var、デフォルト `Asia/Tokyo`) で確定したローカル日付を用いる。
4. 取得データを D1 に保存する:
   - 生の intraday データは `vitals` テーブルに `INSERT`
   - 日次集計は `vitals_daily` テーブルに `UPSERT`
5. レスポンスヘッダ `Fitbit-Rate-Limit-*` の値を `rate_limit_state` テーブルに記録する。
6. トークンを Refresh した場合は `auth_tokens` を `UPDATE` する (refresh_token もローテーションされるため必ず上書き)。

### 4.2.1. 初回 Backfill
初回 cron 起動時 (= D1 の `vitals_daily` が空の場合)、過去のデータを一括取得して履歴を初期化する。

- **対象期間**: intraday は過去 7 日、daily 系は過去 30 日
- **実行方法**: 通常の cron ジョブ群が「空 DB を検知 → backfill モードに切り替え」る
- **レートリミット配慮**: 1 回の cron で全 backfill を行うとクォータを瞬間的に消費するため、3〜4 回に分割して実行する

### 4.3. データ提供フロー (Serving - HTTP Fetch)
すべての公開エンドポイントは認証なしの読み取り専用。バイタルデータは公開を許容する設計判断である (§8 参照)。

- **GUI / ポートフォリオからのアクセス**: Workers が D1 から最新値および日次サマリを取得し、JSON 形式で返す。CORS は `*` を許可する。
- **Prometheus からのアクセス**: `/metrics` へのアクセスに対し、D1 の最新値を Prometheus exposition フォーマット (text/plain) に変換して返す。

## 5. Cron ジョブ設計

レートリミット 150 req/h/user の予算配分を考慮し、頻度の異なる複数の Cron ジョブで構成する (詳細は `metrics.md` §3)。

| Job | 頻度 | 対象 | コスト (req/h) |
| :--- | :--- | :--- | ---: |
| High-frequency | 15 分 | 心拍 (intraday), アクティビティ (intraday), AZM | 12 |
| Hourly | 1 時間 | 呼吸数, SpO2 (intraday), デバイス情報 | 3 |
| Post-wake | 1 日 (8:00 JST) | 睡眠, HRV, 皮膚温, カーディオスコア, 安静時心拍 | ~0.2 |
| Body | 4 時間 | 体重, 体組成 | 0.25 |
| Token refresh | 必要時 (~7h ごと) | OAuth refresh | ~0.15 |
| **合計** | | | **~16 req/h** |

クォータの使用率は ~10%。429 リトライや UI からの ad-hoc リクエストにも余裕を残す。

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

すべて公開・認証なし・読み取り専用。書き込み系エンドポイント (`POST` / `PUT` / `DELETE`) および OAuth 関連エンドポイントは存在しない。

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

## 8. セキュリティと制約事項 (Security & Constraints)

### 8.1. 認証モデル
- **書き込み系エンドポイント・OAuth エンドポイントは存在しない**。これにより認証保護が必要なエンドポイントが 0 になる。
- 公開エンドポイント (`/api/*`, `/metrics`, GUI) は **すべて認証なし読み取り専用**。バイタルデータをポートフォリオ的に公開する用途を前提としたデザイン。
- 個人情報を非公開にしたいユーザーは本システムの想定外。フォークしてアクセス制御を追加する必要がある。

### 8.2. シークレット管理
Cloudflare Workers の Secrets として以下を保存する。

| Secret | 用途 |
| :--- | :--- |
| `FITBIT_CLIENT_ID` | Fitbit OAuth クライアント ID。refresh 時に必要 |
| `FITBIT_CLIENT_SECRET` | Fitbit OAuth クライアント秘密鍵。refresh 時に必要 |
| `FITBIT_REFRESH_TOKEN_SEED` | 初回 bootstrap 用の refresh_token (使い切り) |

### 8.2.1. 環境変数 (`wrangler.toml [vars]`)
秘匿性のない設定値は plain な vars として宣言する。

| Variable | デフォルト | 用途 |
| :--- | :--- | :--- |
| `USER_TIMEZONE` | `Asia/Tokyo` | Fitbit のローカル日付確定および日次 cron の起床時刻決定に使用 |

### 8.3. OAuth フロー
- Bootstrap スクリプトでは Authorization Code Grant + PKCE を採用する。Implicit Grant は使用しない。
- `refresh_token` は使い切り仕様 (`fitbit-api.md` §3.2) のため、Worker 側では D1 に保存された最新値のみを使用し、Secret の seed は D1 が空のときのみ参照する。

### 8.4. その他の制約
- **Fitbit API レートリミット**: 1 ユーザーにつき 150 リクエスト / 時。本設計では ~16 req/h 程度に抑え、429 リトライや手動操作の余地を残す。
- **Cloudflare 無料枠**: Workers は 1 日 10 万リクエスト、D1 は 1 日 10 万回の読み出し / 10 万回の書き込みまで無料。本用途であれば無料枠内に十分収まる。
- **Personal アプリ前提**: Intraday API は Personal アプリで申請なしに利用可能。Server / Client アプリでデプロイすると Intraday が使えなくなる点に注意。

## 9. 今後の拡張性 (Future Enhancements)

- **Fitbit Subscription (Webhook) 統合**: cron polling の補完として `sleep` / `body` / `activities` のサブスクリプションを導入し、低レイテンシ反映とリクエスト削減を実現する (`metrics.md` §8 参照)。
- **Grafana 連携テンプレート**: 標準的なダッシュボード JSON を同梱し、ユーザーがすぐに可視化を始められるようにする。
- **アラートルールの同梱**: `metrics.md` §7 で定義したアラート群を Prometheus アラートルール YAML として配布する。
- **エクスポート機能**: 蓄積データを CSV / JSON で一括ダウンロードできる機能を GUI に追加する。
