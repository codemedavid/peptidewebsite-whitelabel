import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { fail, logServerError, ok } from "@/lib/mobile/http";
import { hasAuthHeader, resolveShopStore } from "@/lib/mobile/shop";
import { loadShopCatalog } from "@/lib/mobile/shop-catalog";

const FIFTEEN_MIN = 15 * 60 * 1000;
const MAX_GUEST_READS = 60;

// GET /api/mobile/v1/shop/catalog?store=  → ShopCatalog (lib/mobile/shop-contract.ts)
// Optional auth: a bearer token must be a live CUSTOMER session and its store
// wins; without one, `store` names the store (a store link / code) and the
// caller is rate-limited per IP like the store preview.
export async function GET(req: Request) {
  try {
    if (!hasAuthHeader(req) && !rateLimit(`mobile:shop-catalog:${await clientIp()}`, MAX_GUEST_READS, FIFTEEN_MIN).ok) {
      return fail("rate_limited", "Too many requests. Try again in a few minutes.");
    }
    const store = new URL(req.url).searchParams.get("store");
    const resolved = await resolveShopStore(req, store ?? undefined);
    if (!resolved.ok) return fail(resolved.code, resolved.message);
    return ok(await loadShopCatalog(resolved.store));
  } catch (e) {
    logServerError("shop/catalog", e);
    return fail("server_error", "We couldn't load the shop right now. Please try again.");
  }
}
