# Fitbit Web API 仕様まとめ

本書は Fitbit Vitals Wrapper & Exporter プロジェクトの設計判断のために、Fitbit Web API の公式ドキュメントを調査して得た事実をまとめたものである。

---

## 1. 取得可能なデータと対応エンドポイント

### 1.1. 心血管系

| データ | エンドポイントパス (プレフィックス: `https://api.fitbit.com`) | 日次 | Intraday | 必要 Scope |
| :--- | :--- | :---: | :---: | :--- |
| 心拍数 (Heart Rate Time Series) | `/1/user/-/activities/heart/...` | ✅ | ✅ | `heartrate` |
| 心拍変動 (HRV) | `/1/user/-/hrv/...` | — | ✅ (睡眠中のみ計測) | `heartrate` |
| 呼吸数 (Breathing Rate) | `/1/user/-/br/...` | ✅ | ✅ | `respiratory_rate` |
| SpO2 (血中酸素濃度) | `/1/user/-/spo2/...` | ✅ | ✅ | `oxygen_saturation` |
| 心肺フィットネス (VO2 Max / Cardio Score) | `/1/user/-/cardioscore/...` | ✅ | — | `cardio_fitness` |

### 1.2. アクティビティ

| データ | エンドポイントパス | 日次 | Intraday | 必要 Scope |
| :--- | :--- | :---: | :---: | :--- |
| 歩数 / 距離 / カロリー / 階数 | `/1/user/-/activities/...` | ✅ | ✅ | `activity` |
| アクティブゾーン分数 (AZM) | `/1/user/-/activities/active-zone-minutes/...` | ✅ | ✅ | `activity` |

### 1.3. 睡眠

| データ | エンドポイントパス | 日次 | Intraday | 必要 Scope |
| :--- | :--- | :---: | :---: | :--- |
| 睡眠ログ・ステージ・スコア | `/1.2/user/-/sleep/...` | ✅ | — | `sleep` |

### 1.4. 身体・健康指標

| データ | エンドポイントパス | 日次 | Intraday | 必要 Scope |
| :--- | :--- | :---: | :---: | :--- |
| 体温 (皮膚温) | `/1/user/-/temp/skin/...` | ✅ | — | `temperature` |
| 体重 / 体脂肪 / BMI | `/1/user/-/body/...` | ✅ | — | `weight` |
| 血糖値 (Blood Glucose) | `/1/user/-/glucose/...` | ✅ | — | `nutrition` |

### 1.5. 食事・栄養

| データ | エンドポイントパス | 日次 | Intraday | 必要 Scope |
| :--- | :--- | :---: | :---: | :--- |
| 食事ログ / 栄養 / 水分 | `/1/user/-/foods/log/...` | ✅ | — | `nutrition` |

### 1.6. メタ情報

| データ | エンドポイントパス | 必要 Scope |
| :--- | :--- | :--- |
| デバイス情報 (バッテリー残量・最終同期日時) | `/1/user/-/devices.json` | (Scope 不要 / `settings`) |
| ユーザープロフィール | `/1/user/-/profile.json` | `profile` |

### 1.7. その他のデータカテゴリ

公式ドキュメントには以下のカテゴリも存在する:

- **Electrocardiogram (ECG)** — Scope: `electrocardiogram`
- **Irregular Rhythm Notifications** — Scope: `irregular_rhythm_notifications`
- **Location (GPS)** — Scope: `location`
- **Social (Friends)** — Scope: `social`
- **Settings** — Scope: `settings`

### 1.8. URL における `-` プレースホルダ

エンドポイントパス中の `-` は user_id のプレースホルダで、「アクセストークンの所有者自身」を意味する。1 ユーザー = 1 デプロイ前提の本プロジェクトでは常に `-` を用いる。

---

## 2. Subscription (Webhook)

- **エンドポイント**: `/1/user/-/{collection}/apiSubscriptions/...`
- **対応コレクション**: `activities`, `body`, `foods`, `sleep`
- **動作**: 該当データに更新があった際、登録した URL に Fitbit から push 通知が送られる。
- **利点**: cron ポーリングを大幅に削減でき、レートリミットの節約と低レイテンシ反映が可能。
- **注意**: Subscription 通知本体にはデータ実体が含まれず、「更新があった」ことしか通知されないため、別途 GET でデータ取得が必要。

---

## 3. 認証 (OAuth 2.0)

### 3.1. サポートされる認可フロー

1. **Authorization Code Grant Flow**
2. **Authorization Code Grant Flow with PKCE** ← **公式推奨**
3. **Implicit Grant Flow** (非推奨)
4. **Client Credentials** — Fitbit Commerce APIs 専用。ユーザーデータ取得には**使用不可**。

### 3.2. トークンの寿命

| トークン | 有効期限 | ローテーション |
| :--- | :--- | :--- |
| Access Token | デフォルト **8 時間** | 失効後は Refresh で再発行 |
| Refresh Token | (使用回数ベース) | **1 回限りの使い切り**。Refresh のたびに新しい refresh_token が返るため、必ず DB を上書き保存する必要がある |

### 3.3. トークンレスポンスのフィールド

Refresh エンドポイントが返すフィールド:

- `access_token` — 更新後のアクセストークン
- `refresh_token` — 更新後のリフレッシュトークン (次回更新時に使用)
- `expires_in` — Access Token の有効期限 (秒)
- `token_type` — 固定値 `Bearer`
- `user_id` — Fitbit ユーザー ID

### 3.4. Scope 一覧

| Scope | 対象データ |
| :--- | :--- |
| `activity` | 歩数、距離、カロリー、AZM、エクササイズ |
| `heartrate` | 心拍数、HRV |
| `sleep` | 睡眠ログ、ステージ、スコア |
| `oxygen_saturation` | SpO2 |
| `respiratory_rate` | 呼吸数 |
| `temperature` | 体温 (皮膚温・コア体温) |
| `weight` | 体重、体脂肪、BMI |
| `nutrition` | 食事、水分、血糖値 |
| `cardio_fitness` | VO2 Max / Cardio Score |
| `electrocardiogram` | ECG |
| `irregular_rhythm_notifications` | 不整脈通知 |
| `profile` | ユーザープロフィール |
| `settings` | デバイス設定 |
| `location` | GPS データ |
| `social` | フレンド情報 |

認可リクエストではスペース区切りで複数 scope を指定する。

### 3.5. リクエスト形式

- HTTPS 必須
- 認証ヘッダ: `Authorization: Bearer <access_token>`

---

## 4. レートリミット

### 4.1. 制限値

- **150 リクエスト / 時 / ユーザー**
- 同意したユーザー単位で適用される (アプリケーション全体ではなく、ユーザーごと独立)
- リセットタイミング: **毎時 00 分頃** (top of the hour)

### 4.2. 超過時の挙動

- HTTP **429 Too Many Requests** が返る
- リトライはレスポンスヘッダ `Fitbit-Rate-Limit-Reset` で示される秒数だけ待つ

### 4.3. レスポンスヘッダ

すべての API レスポンスに以下が付与される:

- `Fitbit-Rate-Limit-Limit` — このユーザー枠の総クォータ数
- `Fitbit-Rate-Limit-Remaining` — 残りリクエスト数
- `Fitbit-Rate-Limit-Reset` — リセットまでの秒数

### 4.4. 認証種別による違い

公式ドキュメント上、認証フロー (Authorization Code / PKCE 等) によるレートリミットの差異は明記されていない。**すべての認証方式で 150 req/h/user が適用される**。

### 4.5. 本プロジェクトにおける含意

1 ユーザー = 1 デプロイなので 150/h を一人分まるまる使える。15 分間隔で 4 メトリクス取得しても `4 (回) × 4 (メトリクス) = 16 req/h` で十分余裕がある。

---

## 5. アプリケーション種別と Intraday アクセス

### 5.1. アプリ種別

| 種別 | 自身のデータ | 他ユーザーのデータ | Intraday |
| :--- | :--- | :--- | :--- |
| **Personal** | 自動承認 | アクセス不可 | **申請不要で全機能利用可能** |
| **Server / Client** | 利用可 | 個別審査ベースで承認 | 個別審査が必要 (商用は厳格審査) |

### 5.2. Intraday API 対応データ

分単位の細かい時系列データが取得できる対象:

- Active Zone Minutes (AZM)
- Activity (歩数、距離、カロリー、階数)
- Breathing Rate
- Heart Rate
- HRV
- SpO2

### 5.3. 申請プロセス (Server/Client アプリの場合)

- 対象: 非営利研究、個人プロジェクト、商用アプリケーション開発者
- 申請窓口: Google Issue Tracker
- 審査基準: "Applications must demonstrate necessity to create a great user experience"
- 注意: 商用アプリケーションは厳格審査の対象であり、すべての申請が承認されるわけではない

### 5.4. 本プロジェクトにおける含意

「**Personal アプリ前提**」とすることで:

- Intraday API を**申請なしで即利用可能**
- 高解像度な時系列バイタル (1 分粒度の心拍、HRV など) をエクスポート可能
- 1 デプロイ = 1 オーナーの自分のデータのみという制約と矛盾しない

---

## 6. デバイス依存性

すべてのデータが任意のデバイスで取得できるわけではない。以下のデータは比較的新しいデバイス (Sense, Charge 5 以降, Pixel Watch シリーズ等) でのみ計測される:

- HRV
- SpO2
- 体温 (皮膚温)
- 呼吸数
- ECG

古いトラッカーでは API を叩いても空のレスポンスが返る可能性がある。

---

## 7. API バージョニング

- ベース URL: `https://api.fitbit.com`
- バージョンはエンドポイントごとに異なる。多くは `/1/`、一部 (Sleep など) は `/1.2/` を使用する。
- 本プロジェクトでは各エンドポイントを叩く際に正しいバージョンを個別に指定する必要がある。

---

## 8. 設計への反映候補

本書の調査結果を踏まえ、`DESIGN.md` への反映候補は以下:

1. **Personal アプリ前提**を Constraints セクションに明記する。Intraday API の申請不要化、デプロイ手順の簡素化に直結する。
2. **Subscription (Webhook)** を cron ポーリングの代替/補完として導入を検討する。レートリミット節約と低レイテンシ化に有効。
3. `auth_tokens` スキーマに **`expires_at` カラム** を追加し、8 時間切れ前の proactive refresh を可能にする。
4. **レートリミット残量** (`Fitbit-Rate-Limit-Remaining`) を取得・記録し、`/metrics` 経由で Prometheus にエクスポートすれば、利用状況の監視が可能になる。
5. **Refresh Token のローテーション**は `auth_tokens.id=1` レコードの UPDATE で吸収する (既存設計と整合)。レース条件回避のため D1 のトランザクションを使用する。

---

## 9. 参考リンク

- [Fitbit Web API Reference (トップ)](https://dev.fitbit.com/build/reference/web-api/)
- [Application Design Best Practices (レートリミット)](https://dev.fitbit.com/build/reference/web-api/developer-guide/application-design/)
- [Authorization Overview](https://dev.fitbit.com/build/reference/web-api/authorization/)
- [Refresh Token](https://dev.fitbit.com/build/reference/web-api/authorization/refresh-token/)
- [Intraday API](https://dev.fitbit.com/build/reference/web-api/intraday/)
- [Heart Rate Time Series](https://dev.fitbit.com/build/reference/web-api/heartrate-timeseries/get-heartrate-timeseries-by-date/)
