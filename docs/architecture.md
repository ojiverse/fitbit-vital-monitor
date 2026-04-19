# Infrastructure Architecture

本書は `fitbit-vital-monitor` のインフラアーキテクチャと実装スタックを定義する。`DESIGN.md` の論理設計を Cloudflare 上の具体的なサービス構成にマッピングしたものである。

---

## 1. Cloudflare サービス棚卸し

採用候補サービスと本プロジェクトでの位置付け。

| サービス | 無料枠 | 用途 | 採用 |
| :--- | :--- | :--- | :---: |
| **Workers** | 100k req/日 | ロジック全体 (Webhook + Cron + HTTP) | ✅ MVP |
| **Cron Triggers** | 無制限 (Workers 内) | webhook で取れない領域とフォールバック | ✅ MVP |
| **D1** | 5 GB / 5M reads/日 / 100k writes/日 | 時系列・トークン保存 | ✅ MVP |
| **Workers Secrets** | 無制限 | Client Secret 等 (4 個) | ✅ MVP |
| **Workers Static Assets** | (Workers 内) | GUI (SPA) を同一 Worker から配信 | ✅ MVP |
| **Custom Domains / Routes** | 無料 (CF DNS 利用時) | デプロイ先ドメイン (任意) | ✅ MVP |
| **Durable Objects** | 無料枠あり | トークン更新の競合排除 | 🔵 推奨 |
| **R2** | 10 GB / Class A 1M / Class B 10M / **egress 無料** | 期限切れ intraday データの長期アーカイブ | 🔵 推奨 |
| **Cache API** | 無料 | `/metrics` の短期キャッシュ (任意) | ⏭ 任意 |
| **Queues** | 1M ops/月 | Cron 失敗時のリトライバッファ | ⏭ 将来 |
| **Workers Analytics Engine** | 無料枠あり | 高頻度の運用メトリクス | ⏭ 将来 |
| **Email Routing / Email Workers** | 無料 | データ取得停止時のアラート通知 | ⏭ 将来 |
| **Pages** | 500 builds/月 | (GUI を別ホスティングする場合) | ❌ 不採用 |
| **KV** | 100k reads / 1k writes/日 | (トークン保管用に検討) | ❌ 不採用 |

### 不採用の理由
- **Pages**: GUI を Workers Static Assets で同居させた方が、CORS・デプロイ・ドメインがすべて一本化されシンプル。
- **KV**: eventual consistency により refresh_token のローテーションで「古い refresh_token を読んで失敗」リスクがある。D1 の strong consistency が安全。

---

## 2. 採用アーキテクチャ (MVP)

「単一 Worker + D1」を中核とする最小構成。

```
                   ┌────────────────────────┐
                   │   Fitbit Web API       │
                   └─┬─────────┬────────────┘
                     │ REST    │ webhook push (signed HMAC-SHA1)
                     │ (cron)  │
   ┌─────────────────┼─────────┼───────────────────────────────┐
   │  Cloudflare Worker (single deployment, edge global)       │
   │                 │         ▼                               │
   │  ┌──────────────┴┐  ┌────────────────┐  ┌──────────────┐  │
   │  │ Cron Triggers │  │ HTTP Handler   │  │ Static       │  │
   │  │ - 15min HR    │  │ /api/*         │  │ Assets (GUI) │  │
   │  │ - 1h devices  │  │ /metrics       │  │   /          │  │
   │  │ - daily       │  │ /webhook/fitbit│  │   /history   │  │
   │  │   fallback    │  │   (signed)     │  │              │  │
   │  │ - 4h archive  │  │                │  │              │  │
   │  └────────┬──────┘  └──────┬─────────┘  └──────┬───────┘  │
   │           └───────┬────────┴───────────────────┘          │
   │                   ▼                                       │
   │  ┌─────────────────────────────────────────────────────┐  │
   │  │              Bindings                               │  │
   │  ├──────────────┬──────────────────┬───────────────────┤  │
   │  │  D1          │  Secrets         │  Durable Object   │  │
   │  │  ・vitals    │  ・FITBIT_       │  ・TokenStore     │  │
   │  │  ・vitals_dly│    CLIENT_ID     │  (refresh の排他) │  │
   │  │  ・auth_tkn  │  ・FITBIT_       │                   │  │
   │  │  ・rate_lmt  │    CLIENT_SECRET │  R2 (推奨)        │  │
   │  │              │   (兼 webhook    │  ・archive/...    │  │
   │  │              │    署名検証鍵)   │   (>7日 intraday) │  │
   │  │              │  ・FITBIT_       │                   │  │
   │  │              │    REFRESH_      │                   │  │
   │  │              │    TOKEN_SEED    │                   │  │
   │  │              │  ・FITBIT_       │                   │  │
   │  │              │    SUBSCRIBER_   │                   │  │
   │  │              │    VERIFY        │                   │  │
   │  └──────────────┴──────────────────┴───────────────────┘  │
   └───────────────────────────────────────────────────────────┘
        ▲                ▲                  ▲
        │ HTTPS          │ /metrics scrape  │ Browser
   ┌────┴─────┐    ┌─────┴───────┐    ┌─────┴───────┐
   │ End User │    │ Prometheus  │    │ End User    │
   │ (API)    │    │  / Grafana  │    │ (GUI)       │
   └──────────┘    └─────────────┘    └─────────────┘

   ┌─────────────────────────────────────────────┐
   │  Local (deploy 前のみ)                      │
   │  ・bootstrap スクリプト                     │
   │    Fitbit OAuth (PKCE) を完走し、           │
   │    refresh_token を取得 → wrangler secret   │
   └─────────────────────────────────────────────┘
```

### 採用サービスの役割

| サービス | 役割 |
| :--- | :--- |
| **Worker (1 個)** | Webhook 受信 + Cron 実行 + HTTP API + GUI 配信を 1 デプロイで担当。`wrangler deploy` 一発でデプロイ完了 |
| **Workers Static Assets** | ビルド済み GUI (SPA) を同 Worker から配信。CORS 不要 |
| **D1 (1 個)** | `vitals` / `vitals_daily` / `auth_tokens` / `rate_limit_state` の 4 テーブル |
| **Workers Secrets** | `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` / `FITBIT_REFRESH_TOKEN_SEED` / `FITBIT_SUBSCRIBER_VERIFY` の 4 個 |
| **Cron Triggers** | `metrics.md` §3.2 で定義した 4 ジョブ (HR intraday / デバイス情報 / daily fallback / R2 archive) を `wrangler.toml` の `[triggers]` で宣言 |
| **Webhook (`POST /webhook/fitbit`)** | Fitbit Subscription 通知の一次取得経路。HMAC-SHA1 署名検証 → 204 即応 → `ctx.waitUntil` で fetch (DESIGN.md §4.4 / §7.4) |
| **Durable Object: TokenStore** | トークン取得・更新の排他処理 (推奨、§3 参照) |
| **R2** | 7 日経過した `vitals` 行のアーカイブ (推奨、§4 参照) |

---

## 3. Durable Object: `TokenStore`

### 3.1. 解決する問題
複数 Cron が時刻一致 (例: 毎時 0 分は 15min と Hourly が同時発火) で並行実行された際、両方がトークン失効を検知すると、両方が同じ `refresh_token` で更新を試み、**片方が必ず失敗する** (refresh_token は使い切り)。

### 3.2. 設計
- 単一インスタンスの Durable Object として実装する (`idFromName("singleton")`)
- 公開メソッド: `getValidToken()` のみ
  - 内部で D1 から現在のトークンを読む
  - `expires_at` が失効間近なら排他的に refresh を実行し、結果を D1 に書き戻す
  - 呼び出し元には有効な `access_token` を返す
- すべての Cron / HTTP ハンドラは Fitbit API を叩く前にこのメソッドを必ず経由する

### 3.3. 代替案との比較
| 方式 | 実装コスト | 信頼性 | 採用 |
| :--- | :--- | :--- | :---: |
| Durable Object でシリアライズ | 中 | 高 | ✅ 推奨 |
| D1 楽観ロック (`UPDATE WHERE updated_at = ?`) | 低 | 中 (失敗側のリトライ要) | 代替案 |
| Cron スケジュールをずらして物理回避 | 低 | 低 (運用脆弱) | 不採用 |

MVP は Durable Object 採用が望ましいが、実装コストを抑えたい場合は楽観ロック方式で開始し、運用上の問題が顕在化した時点で移行することも可能。

---

## 4. R2: 長期アーカイブ

### 4.1. 目的
`vitals` テーブルの 7 日経過分を削除する前に R2 に書き出し、長期保存と低コスト分析を可能にする。

### 4.2. 設計
- 日次 cron が `vitals` から expired 行 (date < today - 7) を取り出す
- JSONL (1 行 1 レコード) として `archive/YYYY-MM-DD.jsonl` のキーで R2 に PUT
- PUT 完了後に `vitals` から該当行を `DELETE`
- R2 の **egress 無料**特性により、ユーザーが過去データを CSV エクスポート / 機械学習等で利用しても帯域コストはゼロ

### 4.3. 容量試算
- 1 日の intraday 行数: 5 メトリクス × 1440 分 ≈ 7,200 行 ≈ 700 KB (JSONL)
- 10 GB 無料枠: 約 **40 年分**

---

## 5. デプロイトポロジ

### 5.1. 単一 Worker 構成 (採用)
- 1 Worker = Cron + API + GUI の全機能
- `wrangler deploy` だけでセットアップ完了
- D1 / Durable Object / R2 / Secrets はすべて同 Worker のバインディングで利用

### 5.2. 単一構成を選ぶ理由
教科書的な「Cron Worker」と「API Worker」の分離は、本プロジェクトでは以下の理由で採用しない:

- **Cold start**: Workers は V8 isolate で ~5ms。分離する性能上の必然性なし
- **デプロイ容易性**: 1 デプロイで完結 (READMEの手順が短くなる)
- **無料枠**: 100k req/日 を共有しても余裕 (§7 参照)
- **コード共有**: トークン取得・D1 アクセスのロジックを内部関数として共有でき、HTTP 呼び出しを挟む必要がない

### 5.3. ドメイン
| 選択肢 | 推奨 |
| :--- | :--- |
| `<name>.workers.dev` (デフォルト) | ✅ ゼロ設定でデプロイ即利用可能 |
| カスタムドメイン (CF DNS 利用) | 任意で `wrangler.toml` に追加 |

`workers.dev` を既定にし、README で「カスタムドメインを使う場合は ... を追記」と案内する。

---

## 6. ローカル Bootstrap スクリプト

### 6.1. 役割
Fitbit OAuth フローをユーザーのローカル環境で完走し、初回 `refresh_token` を Secrets として注入できる状態にする。デプロイ済み Worker からは独立しており、本番ランタイムには含まれない。

### 6.2. 配置
- リポジトリ内 `scripts/bootstrap.ts` (Node 実行)
- `pnpm bootstrap` で起動

### 6.3. 流れ
1. Client ID / Secret を CLI 引数または `.env` から取得
2. ローカル `http://localhost:<port>/callback` を一時 HTTP サーバーで待ち受け
3. Fitbit 認可ページをブラウザで自動オープン (Authorization Code Grant + PKCE)
4. ユーザーが同意して callback に認可コードが返る
5. スクリプトがトークンエンドポイントへ送信し、`refresh_token` / `fitbit_user_id` / `scope` / 一時 `access_token` を取得
6. 標準出力に `wrangler secret put` の手順と値を表示

### 6.4. デプロイ後の Subscription 登録 (`scripts/subscribe.ts`)
デプロイ済み Worker に対して `sleep` / `activities` / `body` の Fitbit Subscription を登録する CLI。`pnpm subscribe` で起動し、`FITBIT_ACCESS_TOKEN` (bootstrap が表示) と Fitbit Developer ポータルで採番された `FITBIT_SUBSCRIBER_ID` を環境変数で渡す。冪等で、同じ `subscriptionId` を再登録しても Fitbit 側で no-op となる。Subscriber 登録時の verification challenge は Worker の `GET /webhook/fitbit?verify=...` で `FITBIT_SUBSCRIBER_VERIFY` Secret と照合される。

---

## 7. 無料枠の余裕分析

### 7.1. Worker 呼び出し (上限 100,000 req/日)
| ソース | 1 日の呼び出し |
| :--- | ---: |
| Cron (15min HR) | 96 |
| Cron (1h device) | 24 |
| Cron (4h archive) | 6 |
| Cron (daily fallback) | 1 |
| Webhook 受信 (sleep + activities + body) | ~50 (watch sync 頻度依存) |
| `/metrics` スクレイプ (30s 間隔) | 2,880 |
| `/api/*` (GUI / portfolio 想定) | ~1,000 |
| **合計** | **~4,100** (上限の 4%) |

### 7.2. D1 (上限 5M reads / 100k writes/日)
| 操作 | 1 日の回数 |
| :--- | ---: |
| Cron 書き込み (intraday + summary) | ~2,000 writes |
| Cron 読み (token + rate_limit) | ~150 reads |
| `/metrics` 読み | ~3,000 reads |
| `/api/*` 読み | ~5,000 reads |
| **合計** | **~8k reads / ~2k writes** (それぞれ上限の <2%) |

### 7.3. ストレージ (D1 上限 5 GB)
- intraday 7 日 × 7,200 行 ≈ 50,400 行 ≈ 5 MB
- vitals_daily ≈ 5 メトリクス × 365 日 × 数年 = 数千行
- 数年運用で <100 MB

### 7.4. R2 (上限 10 GB)
- intraday アーカイブ: 1 日 ~700 KB → 約 **40 年分**

→ **すべての無料枠で大幅な余裕**。追加メトリクスや高頻度化の余地あり。

---

## 8. 運用上の重要考慮点

### 8.1. Cron 重複実行
Cloudflare Cron は同一スケジュールの重複実行はしない。ただし複数の異なるスケジュールが同時刻に発火することはあるため、Fitbit API リクエスト前に必ず `TokenStore` を経由する設計でカバーする (§3)。

### 8.2. 失敗時の挙動
- 429 / 5xx 受信時: 即座にリトライせず、Cron の次回起動に委ねる
- トークン Refresh 失敗: `fitbit_token_refresh_total{result="failure"}` カウンタで観測。Prometheus 側でアラート
- 連続失敗時: 再ブートストラップ手順を README で案内

### 8.3. ログ・観測
- 開発時: `wrangler tail` でリアルタイムログ参照
- 運用時: 本システム自身の `/metrics` をユーザーの Prometheus でスクレイプ (循環構造)

### 8.4. バックアップ / DR
- D1 は Cloudflare 側で日次スナップショット (Time Travel) が利用可能
- R2 アーカイブにより、生データの長期保全は Cloudflare 側障害時にも残る (R2 の冗長化に依存)

---

## 9. wrangler.toml バインディング設計

`wrangler.toml` で宣言するバインディングと Secrets:

| 種別 | 名前 | 内容 |
| :--- | :--- | :--- |
| `name` | — | `fitbit-vital-monitor` |
| `[triggers] crons` | — | `*/15 * * * *` (HR intraday), `0 * * * *` (device), `0 23 * * *` (= 8:00 JST daily fallback), `0 */4 * * *` (R2 archive) |
| `[[d1_databases]]` | `DB` | `fitbit_vital_monitor` (D1 データベース) |
| `[[durable_objects.bindings]]` | `TOKEN_STORE` | クラス `TokenStore` |
| `[[r2_buckets]]` | `ARCHIVE` | バケット `fitbit-vital-monitor-archive` (採用時) |
| `[assets]` | `directory` | `./apps/gui/dist` (GUI ビルド出力) |
| `[vars]` | `USER_TIMEZONE` | デフォルト `Asia/Tokyo` |
| Secrets (CLI 投入) | `FITBIT_CLIENT_ID` | Fitbit OAuth クライアント ID |
| Secrets (CLI 投入) | `FITBIT_CLIENT_SECRET` | Fitbit OAuth クライアント秘密鍵 (refresh + webhook 署名検証鍵) |
| Secrets (CLI 投入) | `FITBIT_REFRESH_TOKEN_SEED` | 初回 bootstrap 用 refresh_token |
| Secrets (CLI 投入) | `FITBIT_SUBSCRIBER_VERIFY` | Fitbit Developer ポータル発行の verification code (`GET /webhook/fitbit?verify=...` で照合) |

---

## 10. 採用しないが将来検討

| 機能 | トリガー条件 | 期待効果 |
| :--- | :--- | :--- |
| **Queues** | Cron 失敗のリトライ要件が顕在化したら | 信頼性向上 |
| **Workers Analytics Engine** | 運用メトリクスが大量化したら | 低コスト時系列保存 |
| **Email Workers** | 自前 Prometheus を持たないユーザー向け | 簡易アラート |
| **Pages** | GUI を Worker から分離したくなったら | ビルド独立化 |
| **Cache API** | `/metrics` のスクレイプ負荷が問題化したら | レイテンシ低減 |

---

## 11. 技術スタック

### 11.1. Worker (バックエンド)

| 領域 | 採用 | 理由 |
| :--- | :--- | :--- |
| 言語 | TypeScript | 型安全、CLAUDE.md 方針 |
| ランタイム | Cloudflare Workers | プロジェクト前提 |
| HTTP ルーティング | Hono | Cloudflare 公式推奨、軽量、型安全 |
| バリデーション | zod | Fitbit API レスポンスの実行時検証 |
| ビルド | wrangler 標準 (esbuild) | 追加設定不要 |
| テスト | Vitest + `@cloudflare/vitest-pool-workers` | Workers 環境で実行可能 |
| Lint / Format | Biome | CLAUDE.md 方針、高速 |

### 11.2. GUI (フロントエンド)

| 領域 | 採用 | 理由 |
| :--- | :--- | :--- |
| フレームワーク | Svelte | 軽量、ランタイム小さい、SPA に最適 |
| ビルド | Vite | Svelte 公式推奨 |
| グラフ | uPlot | 時系列描画に高速、軽量 (ヘルスバイタルに最適) |
| 状態管理 | Svelte stores (組み込み) | 規模的に十分 |
| HTTP クライアント | `fetch` (組み込み) | 追加依存なし |

### 11.3. Bootstrap スクリプト

| 領域 | 採用 |
| :--- | :--- |
| ランタイム | Node.js (>=20) |
| 言語 | TypeScript (`tsx` で直接実行) |
| HTTP サーバー | Node 組み込み `http` |

### 11.4. パッケージマネージャ
- **pnpm** (CLAUDE.md 方針)
- pnpm workspaces で monorepo 化

---

## 12. プロジェクト構成 (Monorepo Layout)

```
fitbit-vital-monitor/
├── apps/
│   ├── worker/           # Cloudflare Worker
│   │   ├── src/
│   │   │   ├── index.ts          # Hono ルーティング エントリ
│   │   │   ├── api/              # /api/vitals, /metrics, /webhook/fitbit ハンドラ
│   │   │   ├── cron/             # 各 cron ハンドラ (high-frequency / hourly / daily-fallback / body)
│   │   │   ├── ingest/           # cron / webhook 共通の取得関数群と通知ディスパッチ
│   │   │   ├── fitbit/           # Fitbit API クライアント (含 webhook-signature 検証)
│   │   │   ├── db/               # D1 アクセス層
│   │   │   ├── metrics/          # Prometheus exposition formatter
│   │   │   ├── token-store.ts    # Durable Object 実装
│   │   │   └── types.ts          # 共有型 (zod schema 含む)
│   │   ├── test/
│   │   ├── wrangler.toml
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── gui/              # Svelte SPA
│       ├── src/
│       │   ├── App.svelte
│       │   ├── routes/           # /, /history
│       │   ├── components/
│       │   └── lib/api.ts        # Worker API クライアント
│       ├── public/
│       ├── vite.config.ts
│       ├── package.json
│       └── tsconfig.json
├── scripts/
│   ├── bootstrap.ts      # ローカル OAuth フロー実行
│   └── subscribe.ts      # デプロイ後の Fitbit Subscription 登録 CLI
├── migrations/           # D1 マイグレーション SQL
│   ├── 0001_initial.sql
│   └── ...
├── docs/
│   ├── DESIGN.md
│   ├── architecture.md
│   ├── metrics.md
│   └── fitbit-api.md
├── biome.json
├── pnpm-workspace.yaml
├── package.json          # ルート (devDeps: biome, vitest, wrangler, tsx)
├── tsconfig.base.json
├── README.md
└── LICENSE               # MIT
```

### 12.1. ビルドフロー
1. `pnpm --filter gui build` → `apps/gui/dist/` に静的アセット生成
2. `pnpm --filter worker deploy` → wrangler が GUI dist を Static Assets として同梱
3. `[assets] directory = "../gui/dist"` で参照

---

## 13. ローカル開発フロー

| コマンド | 動作 |
| :--- | :--- |
| `pnpm install` | 全 workspace の依存をインストール |
| `pnpm bootstrap` | OAuth を完走し refresh_token / 一時 access_token を表示 |
| `pnpm subscribe` | デプロイ済み Worker に対し Fitbit Subscription を登録 (1 回限り、冪等) |
| `pnpm --filter worker d1:migrate` | ローカル D1 にマイグレーションを適用 |
| `pnpm --filter gui dev` | Vite dev サーバー起動 (HMR) |
| `pnpm --filter worker dev` | `wrangler dev` (ローカル D1 + Cron 手動 trigger) |
| `pnpm test` | 全 workspace の Vitest 実行 |
| `pnpm lint` | Biome でチェック |
| `pnpm --filter worker deploy` | 本番デプロイ |

ローカル D1 は miniflare 経由で SQLite ファイル化される。Cron はローカルでは自動発火しないため、`wrangler dev --test-scheduled` で手動 trigger する。

