import { DurableObject } from "cloudflare:workers";
import { type StoredToken, getToken, upsertToken } from "./db/tokens";
import { refreshAccessToken } from "./fitbit/auth";
import { FitbitAuthError } from "./fitbit/errors";
import type { Env } from "./types";

const REFRESH_WINDOW_MS = 30 * 60 * 1000;
const DO_STORAGE_KEY = "token";

// DO storage (strongly consistent, local to the singleton DO) is the
// authoritative record for the rotated refresh_token. D1 mirrors the same row
// for observability (`wrangler d1 execute ... SELECT ... FROM auth_tokens`).
// A D1 write failure after a successful Fitbit rotation must not lose the new
// refresh_token — Fitbit invalidates the old one on rotation, so losing the
// new one locks the Worker out until an operator runs bootstrap manually.
type StoredTokenJson = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly scope: string;
  readonly fitbitUserId: string;
  readonly updatedAt: string;
};

export class TokenStore extends DurableObject<Env> {
  async getValidToken(): Promise<string> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const token = await this.loadToken();
      if (token && token.expiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS) {
        return token.accessToken;
      }
      try {
        const refreshed = await this.refresh(token?.refreshToken);
        return refreshed.accessToken;
      } catch (e) {
        if (this.shouldFallbackToSeed(e, token?.refreshToken)) {
          console.warn(
            "[token-store] stored refresh_token rejected; falling back to FITBIT_REFRESH_TOKEN_SEED",
          );
          const refreshed = await this.refresh(this.env.FITBIT_REFRESH_TOKEN_SEED);
          return refreshed.accessToken;
        }
        throw e;
      }
    });
  }

  // Fall back to the seed only when (a) the failure was a Fitbit-side auth
  // rejection, (b) we actually had a stored token distinct from the seed, and
  // (c) a seed is configured. This rescues a common deadlock (rotation
  // succeeded on Fitbit's side but we failed to persist the new token), while
  // avoiding an infinite retry loop when the seed itself is already stale.
  private shouldFallbackToSeed(error: unknown, storedRefreshToken: string | undefined): boolean {
    if (!(error instanceof FitbitAuthError)) return false;
    if (!this.env.FITBIT_REFRESH_TOKEN_SEED) return false;
    if (!storedRefreshToken) return false;
    return storedRefreshToken !== this.env.FITBIT_REFRESH_TOKEN_SEED;
  }

  private async loadToken(): Promise<StoredToken | null> {
    const doToken = await this.ctx.storage.get<StoredTokenJson>(DO_STORAGE_KEY);
    if (doToken) {
      return {
        accessToken: doToken.accessToken,
        refreshToken: doToken.refreshToken,
        expiresAt: new Date(doToken.expiresAt),
        scope: doToken.scope,
        fitbitUserId: doToken.fitbitUserId,
        updatedAt: new Date(doToken.updatedAt),
      };
    }
    // First call on this DO (or operator just wiped it): seamlessly migrate
    // existing deployments by reading the D1 mirror once. The next persist
    // writes to both, and DO storage takes over as the source of truth.
    return getToken(this.env.DB);
  }

  private async persist(stored: StoredToken): Promise<void> {
    const serialized: StoredTokenJson = {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt.toISOString(),
      scope: stored.scope,
      fitbitUserId: stored.fitbitUserId,
      updatedAt: stored.updatedAt.toISOString(),
    };
    await this.ctx.storage.put(DO_STORAGE_KEY, serialized);
    try {
      await upsertToken(this.env.DB, stored);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[token-store] D1 mirror write failed (DO storage authoritative; mirror will self-heal next refresh): ${msg}`,
      );
    }
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
    await this.persist(stored);
    return stored;
  }
}

export async function getAccessToken(env: Env): Promise<string> {
  const stub = env.TOKEN_STORE.get(env.TOKEN_STORE.idFromName("singleton"));
  return stub.getValidToken();
}
