export type StoredToken = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly scope: string;
  readonly fitbitUserId: string;
  readonly updatedAt: Date;
};

type TokenRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
  fitbit_user_id: string;
  updated_at: string;
};

export async function getToken(db: D1Database): Promise<StoredToken | null> {
  const row = await db
    .prepare(
      "SELECT access_token, refresh_token, expires_at, scope, fitbit_user_id, updated_at FROM auth_tokens WHERE id = 1",
    )
    .first<TokenRow>();
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: new Date(row.expires_at),
    scope: row.scope,
    fitbitUserId: row.fitbit_user_id,
    updatedAt: new Date(row.updated_at),
  };
}

export async function upsertToken(db: D1Database, token: StoredToken): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at, scope, fitbit_user_id, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         fitbit_user_id = excluded.fitbit_user_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      token.accessToken,
      token.refreshToken,
      token.expiresAt.toISOString(),
      token.scope,
      token.fitbitUserId,
      token.updatedAt.toISOString(),
    )
    .run();
}
