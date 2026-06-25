/**
 * Edge-runtime twin of lib/auth/gate-token.ts, using the Web Crypto API
 * (crypto.subtle) instead of Node's `crypto` so it can run in middleware. The
 * output is BYTE-FOR-BYTE compatible with the Node codec: same HMAC-SHA256 over
 * the same base64url(JSON) body with the same secret, so a cookie minted by the
 * Node verify action validates here, and a cookie re-signed here (rolling exp)
 * validates back in the Node storefront layout. (Cross-checked by test:gate.)
 *
 * No "server-only" / no Node APIs — middleware bundles this for the Edge runtime.
 */

export type GatePayload = {
  tenantId: string;
  codeVersion: number;
  iat: number; // unix seconds — first unlock; anchors the absolute session cap
  exp: number; // unix seconds — rolling idle expiry
};

export function resolveGateSecret(): string | null {
  return (
    process.env.TENANT_ADMIN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    null
  );
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signGateTokenEdge(payload: GatePayload, secret: string): Promise<string> {
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${bytesToB64url(sig)}`;
}

/** Verify signature (constant-time, via subtle.verify) + expiry. Returns payload or null. */
export async function verifyGateTokenEdge(token: string, secret: string): Promise<GatePayload | null> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const body = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  try {
    const key = await importKey(secret);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sig) as BufferSource,
      enc.encode(body) as BufferSource,
    );
    if (!ok) return null;

    const payload = JSON.parse(dec.decode(b64urlToBytes(body))) as GatePayload;
    if (
      typeof payload?.tenantId !== "string" ||
      typeof payload?.codeVersion !== "number" ||
      typeof payload?.iat !== "number" ||
      typeof payload?.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
