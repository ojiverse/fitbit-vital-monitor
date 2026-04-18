#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { platform } from "node:os";

const SCOPES = [
  "activity",
  "heartrate",
  "sleep",
  "oxygen_saturation",
  "respiratory_rate",
  "temperature",
  "weight",
  "cardio_fitness",
  "settings",
  "profile",
].join(" ");

const DEFAULT_PORT = 48125;

function main(): Promise<void> {
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "Missing FITBIT_CLIENT_ID or FITBIT_CLIENT_SECRET env vars. Obtain them from https://dev.fitbit.com/apps and re-run.",
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const redirectUri = `http://localhost:${port}/callback`;
  const codeVerifier = base64UrlEncode(randomBytes(64));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  const state = base64UrlEncode(randomBytes(16));

  const authUrl = new URL("https://www.fitbit.com/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  console.log("Opening browser for Fitbit authorization...");
  console.log(`If it does not open automatically, visit:\n${authUrl.toString()}\n`);
  openInBrowser(authUrl.toString());

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400).end("bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400).end(`OAuth error: ${error}`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }
      if (!code || returnedState !== state) {
        res.writeHead(400).end("Invalid code or state");
        server.close();
        reject(new Error("Invalid code or state"));
        return;
      }
      try {
        const token = await exchangeCode({
          clientId,
          clientSecret,
          code,
          codeVerifier,
          redirectUri,
        });
        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            "<html><body><h1>Fitbit authorization complete</h1><p>You may close this tab and return to your terminal.</p></body></html>",
          );
        server.close();
        printInstructions(token);
        resolve();
      } catch (err) {
        res.writeHead(500).end(String(err));
        server.close();
        reject(err);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`Waiting for callback on ${redirectUri} ...`);
    });
  });
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  user_id: string;
  token_type: string;
};

async function exchangeCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
    code: args.code,
    code_verifier: args.codeVerifier,
  });
  const response = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

function printInstructions(token: TokenResponse): void {
  console.log("\n=== Fitbit authorization succeeded ===");
  console.log(`fitbit_user_id: ${token.user_id}`);
  console.log(`scopes: ${token.scope}`);
  console.log(`access_token expires in: ${token.expires_in}s (will be refreshed by the Worker)\n`);
  console.log("Next steps:");
  console.log("  1. Store the refresh_token as a Cloudflare secret:");
  console.log(`     echo "${token.refresh_token}" | wrangler secret put FITBIT_REFRESH_TOKEN_SEED`);
  console.log("  2. Store the OAuth app credentials as secrets (once per app):");
  console.log("     wrangler secret put FITBIT_CLIENT_ID");
  console.log("     wrangler secret put FITBIT_CLIENT_SECRET");
  console.log("  3. Run `wrangler deploy`.\n");
  console.log("For local dev with `wrangler dev`, put the same values in apps/worker/.dev.vars:");
  console.log(`     FITBIT_CLIENT_ID=${process.env.FITBIT_CLIENT_ID}`);
  console.log("     FITBIT_CLIENT_SECRET=<your client secret>");
  console.log(`     FITBIT_REFRESH_TOKEN_SEED=${token.refresh_token}`);
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function openInBrowser(url: string): void {
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // User will need to open manually; the URL is already printed.
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
