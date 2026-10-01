import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { fail, logServerError, ok } from "@/lib/mobile/http";
import { loadStorePreview } from "@/lib/mobile/store-preview";

const FIFTEEN_MIN = 15 * 60 * 1000;
const MAX_LOOKUPS = 60;

// GET /api/mobile/v1/stores/:store — public preview of the store a shared app
// link (or a typed store code) points at. No auth: nothing here is more than
// the storefront itself shows.
export async function GET(_req: Request, { params }: { params: Promise<{ store: string }> }) {
  try {
    if (!rateLimit(`mobile:store-preview:${await clientIp()}`, MAX_LOOKUPS, FIFTEEN_MIN).ok) {
      return fail("rate_limited", "Too many lookups. Try again in a few minutes.");
    }
    const { store } = await params;
    const result = await loadStorePreview(decodeURIComponent(store));
    return result.ok ? ok(result.data) : fail(result.code, result.message);
  } catch (e) {
    logServerError("stores/preview", e);
    return fail("server_error", "We couldn't open that store right now. Please try again.");
  }
}
