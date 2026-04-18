import { FitbitAuthError, FitbitClientError, FitbitServerError } from "./errors";
import { type TokenResponse, tokenResponseSchema } from "./schemas";

const TOKEN_URL = "https://api.fitbit.com/oauth2/token";

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "<unreadable>");
    if (response.status === 401 || response.status === 403) {
      throw new FitbitAuthError(`Fitbit token refresh ${response.status}: ${text}`);
    }
    if (response.status >= 500) {
      throw new FitbitServerError(
        `Fitbit token refresh ${response.status}: ${text}`,
        response.status,
      );
    }
    throw new FitbitClientError(
      `Fitbit token refresh ${response.status}: ${text}`,
      response.status,
    );
  }
  const json = await response.json();
  return tokenResponseSchema.parse(json);
}
