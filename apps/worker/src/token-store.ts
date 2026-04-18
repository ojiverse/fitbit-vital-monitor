import { DurableObject } from "cloudflare:workers";
import { type StoredToken, getToken, upsertToken } from "./db/tokens";
import { refreshAccessToken } from "./fitbit/auth";
import type { Env } from "./types";

const REFRESH_WINDOW_MS = 30 * 60 * 1000;

export class TokenStore extends DurableObject<Env> {
  async getValidToken(): Promise<string> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const token = await this.loadToken();
      if (token && token.expiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS) {
        return token.accessToken;
      }
      const refreshed = await this.refresh(token?.refreshToken);
      return refreshed.accessToken;
    });
  }

  private async loadToken(): Promise<StoredToken | null> {
    return getToken(this.env.DB);
  }

  private async refresh(existingRefreshToken: string | undefined): Promise<StoredToken> {
    const refreshToken = existingRefreshToken ?? this.env.FITBIT_REFRESH_TOKEN_SEED;
    if (!refreshToken) {
      throw new Error(
        "No refresh_token available. Run `pnpm bootstrap` and set FITBIT_REFRESH_TOKEN_SEED.",
      );
    }
    const response = await refreshAccessToken(
      this.env.FITBIT_CLIENT_ID,
      this.env.FITBIT_CLIENT_SECRET,
      refreshToken,
    );
    const now = new Date();
    const stored: StoredToken = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: new Date(now.getTime() + response.expires_in * 1000),
      scope: response.scope,
      fitbitUserId: response.user_id,
      updatedAt: now,
    };
    await upsertToken(this.env.DB, stored);
    return stored;
  }
}

export async function getAccessToken(env: Env): Promise<string> {
  const stub = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName("singleton"));
  return stub.getValidToken();
}
