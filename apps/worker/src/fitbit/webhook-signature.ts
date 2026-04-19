// Fitbit Subscription notifications are signed with HMAC-SHA1 over the raw
// request body, keyed by the OAuth client secret followed by `&`. The Base64
// digest is sent in the `X-Fitbit-Signature` header.
// Reference: https://dev.fitbit.com/build/reference/web-api/subscription/

const encoder = new TextEncoder();

export async function verifyFitbitSignature(args: {
  body: string;
  signature: string | null;
  clientSecret: string;
}): Promise<boolean> {
  if (!args.signature) return false;
  const expected = await computeFitbitSignature(args.body, args.clientSecret);
  return timingSafeEqual(args.signature, expected);
}

export async function computeFitbitSignature(body: string, clientSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${clientSecret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return base64Encode(new Uint8Array(digest));
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i] as number);
  }
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
