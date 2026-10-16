/**
 * CORS for the mobile API — only for the Expo WEB build during development.
 *
 * The phone apps never send an Origin, so CORS never applied to them. The web
 * build runs on http://localhost:<port> and calls /api/mobile/v1 cross-origin;
 * with no Access-Control headers the browser blocked every call, fetch() threw,
 * and sign-in showed "Can't reach the server" while the server was fine.
 *
 * Only local/private-network dev origins are allowed, and never with
 * credentials: the API authenticates by bearer token, not cookies, so this
 * opens nothing a page on another site could ride on. Edge-safe (no imports).
 */
const MOBILE_API_PREFIX = "/api/mobile/v1/";
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** localhost, 127.x, lvh.me, and RFC 1918 LAN addresses (phone/Mac on Wi-Fi). */
function isDevHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "lvh.me" || hostname.endsWith(".lvh.me")) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function mobileCorsHeaders(pathname: string, origin: string | null): Record<string, string> | null {
  if (!origin || !pathname.startsWith(MOBILE_API_PREFIX)) return null;
  let hostname: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    hostname = url.hostname;
  } catch {
    return null;
  }
  if (!isDevHost(hostname)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
    "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS),
    Vary: "Origin",
  };
}
