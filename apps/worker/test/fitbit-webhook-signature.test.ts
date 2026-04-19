import { describe, expect, it } from "vitest";
import { computeFitbitSignature, verifyFitbitSignature } from "../src/fitbit/webhook-signature";

const SECRET = "test-client-secret";
const BODY = JSON.stringify([
  { collectionType: "sleep", date: "2024-06-15", ownerId: "ABC", subscriptionId: "sleep-1" },
]);

describe("verifyFitbitSignature", () => {
  it("accepts a signature computed with HMAC-SHA1 over the raw body and `${secret}&` key", async () => {
    const signature = await computeFitbitSignature(BODY, SECRET);
    const ok = await verifyFitbitSignature({ body: BODY, signature, clientSecret: SECRET });
    expect(ok).toBe(true);
  });

  it("rejects a signature computed with the wrong client secret", async () => {
    const signature = await computeFitbitSignature(BODY, "different-secret");
    const ok = await verifyFitbitSignature({ body: BODY, signature, clientSecret: SECRET });
    expect(ok).toBe(false);
  });

  it("rejects when the body has been tampered with", async () => {
    const signature = await computeFitbitSignature(BODY, SECRET);
    const tampered = `${BODY} `; // single trailing space changes the digest
    const ok = await verifyFitbitSignature({
      body: tampered,
      signature,
      clientSecret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it("rejects when the signature header is missing", async () => {
    const ok = await verifyFitbitSignature({ body: BODY, signature: null, clientSecret: SECRET });
    expect(ok).toBe(false);
  });

  it("rejects an empty-string signature without throwing", async () => {
    const ok = await verifyFitbitSignature({ body: BODY, signature: "", clientSecret: SECRET });
    expect(ok).toBe(false);
  });

  it("rejects a base64-shaped but unrelated signature of equal length", async () => {
    const real = await computeFitbitSignature(BODY, SECRET);
    const fake = `${"A".repeat(real.length - 1)}=`;
    const ok = await verifyFitbitSignature({ body: BODY, signature: fake, clientSecret: SECRET });
    expect(ok).toBe(false);
  });
});

describe("computeFitbitSignature", () => {
  it("appends `&` to the secret when deriving the HMAC key (Fitbit spec)", async () => {
    // If the implementation forgot the trailing `&`, the digest would equal
    // HMAC(secret, body) instead of HMAC(`${secret}&`, body). Compute both and
    // make sure ours matches the latter.
    const ours = await computeFitbitSignature(BODY, SECRET);
    const withAmp = await directHmacBase64(`${SECRET}&`, BODY);
    const withoutAmp = await directHmacBase64(SECRET, BODY);
    expect(ours).toBe(withAmp);
    expect(ours).not.toBe(withoutAmp);
  });

  it("produces deterministic output for the same input", async () => {
    const a = await computeFitbitSignature(BODY, SECRET);
    const b = await computeFitbitSignature(BODY, SECRET);
    expect(a).toBe(b);
  });
});

async function directHmacBase64(keyText: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyText),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  let s = "";
  for (let i = 0; i < sig.length; i++) s += String.fromCharCode(sig[i] as number);
  return btoa(s);
}
