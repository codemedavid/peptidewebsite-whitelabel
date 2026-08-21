import { createHash, timingSafeEqual } from "node:crypto";

/** Query parameters a connector URL may carry the admin token on. */
const URL_TOKEN_PARAMS = ["token", "adminToken", "admin_token", "key"] as const;

const FINGERPRINT_CHARS = 8;

export type McpAuthRequest = {
  authorization?: string | null;
  url?: string | null;
};

export type McpAuthResult = { ok: true } | { ok: false; message: string };

type TokenSource = "header" | "url" | "argument";

/**
 * Env values are stored literally by most hosts, so a token pasted straight out
 * of a `.env` line arrives wrapped in its quotes and silently never matches.
 */
function normalizeToken(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const quoted = /^(["'])(.*)\1$/s.exec(value);
  return (quoted?.[2] ?? value).trim();
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, FINGERPRINT_CHARS);
}

function tokensMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function headerToken(authorization: string | null | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec((authorization ?? "").trim());
  return normalizeToken(match?.[1]);
}

function urlToken(url: string | null | undefined): string {
  if (!url) return "";
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return "";
  }
  for (const param of URL_TOKEN_PARAMS) {
    const value = normalizeToken(params.get(param));
    if (value) return value;
  }
  return "";
}

/**
 * Every place a connector is allowed to present the token, in preference order.
 * ChatGPT connectors configured with "No authentication" send no Authorization
 * header at all, so the connector URL has to be able to carry the secret too.
 */
function suppliedTokens(req: McpAuthRequest, args: Record<string, unknown>): Array<{ source: TokenSource; token: string }> {
  return [
    { source: "header" as const, token: headerToken(req.authorization) },
    { source: "url" as const, token: urlToken(req.url) },
    { source: "argument" as const, token: normalizeToken(args.adminToken) },
  ];
}

/**
 * Explains what arrived without echoing it, so a rejected connector can be
 * diagnosed from the ChatGPT transcript alone.
 */
function diagnose(candidates: ReturnType<typeof suppliedTokens>, expected: string): string {
  const parts = candidates.map(({ source, token }) =>
    token ? `${source}: present (sent ${fingerprint(token)}, ${token.length} chars)` : `${source}: absent`,
  );
  return `Invalid or missing MCP admin token. Looked in — ${parts.join("; ")}. Server expected ${fingerprint(expected)}.`;
}

export function checkMcpAuth(
  req: McpAuthRequest,
  args: Record<string, unknown>,
  expectedRaw: string | undefined | null,
): McpAuthResult {
  const expected = normalizeToken(expectedRaw);
  if (!expected) return { ok: false, message: "MCP_ADMIN_TOKEN is not configured on the server." };

  const candidates = suppliedTokens(req, args);
  if (candidates.some(({ token }) => token && tokensMatch(token, expected))) return { ok: true };

  return { ok: false, message: diagnose(candidates, expected) };
}
