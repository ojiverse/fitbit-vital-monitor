import { vi } from "vitest";

export type UrlHandler = (
  url: string,
) => { body: unknown; headers?: Record<string, string> } | undefined;

const DEFAULT_RATE_LIMIT_HEADERS: Record<string, string> = {
  "fitbit-rate-limit-limit": "150",
  "fitbit-rate-limit-remaining": "140",
  "fitbit-rate-limit-reset": "1200",
};

export function stubFetchByUrl(handler: UrlHandler) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = handler(url);
    if (!res) {
      return new Response(`not stubbed: ${url}`, { status: 500 });
    }
    const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    return new Response(body, {
      status: 200,
      headers: { ...DEFAULT_RATE_LIMIT_HEADERS, ...(res.headers ?? {}) },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
