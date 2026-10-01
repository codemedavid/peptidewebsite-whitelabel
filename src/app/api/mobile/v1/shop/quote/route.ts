import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { fail, logServerError, ok, readJson } from "@/lib/mobile/http";
import { resolveShopStore } from "@/lib/mobile/shop";
import { quoteShopOrder } from "@/lib/mobile/shop-flow";

const TEN_MIN = 10 * 60 * 1000;
const MAX_QUOTES = 120;

// POST /api/mobile/v1/shop/quote  ShopQuoteRequest → ShopQuote
// The website's own pricing (quoteStorefrontOrderAction): re-priced lines,
// shipping, admin fee, promo, QR PH fee and the first blocking rule as a 400.
// Optional auth, exactly like the catalog.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Your cart couldn't be read. Please try again.");
    const resolved = await resolveShopStore(req, body.store);
    if (!resolved.ok) return fail(resolved.code, resolved.message);
    const who = resolved.store.customer?.session.id ?? `ip:${await clientIp()}`;
    if (!rateLimit(`mobile:shop-quote:${who}`, MAX_QUOTES, TEN_MIN).ok) {
      return fail("rate_limited", "Too many requests. Try again in a few minutes.");
    }
    const result = await quoteShopOrder(resolved.store, body);
    return result.ok ? ok(result.data) : fail(result.code, result.message);
  } catch (e) {
    logServerError("shop/quote", e);
    return fail("server_error", "Something went wrong on our side. Please try again.");
  }
}
