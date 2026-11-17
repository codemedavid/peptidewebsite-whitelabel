import { fail, ok, readJson, withSession } from "@/lib/mobile/http";
import { promoPushEnabled } from "@/lib/mobile/promo-push";
import { setPromoOptIn } from "@/lib/mobile/promo-push.server";

// PUT /api/mobile/v1/account/promo-push  { on: boolean } → { optedIn }
// A customer turns the store's "Promos & events" notifications on or off for
// their account (every phone they're signed in on). Off by default — App Store
// 4.5.4 needs this explicit opt-in before any promotional push.
export async function PUT(req: Request) {
  return withSession(req, { route: "account/promo-push" }, async (principal) => {
    if (principal.kind !== "customer") return fail("forbidden", "This is for customer accounts.");
    const ctx = principal.ctx;
    if (!promoPushEnabled((key) => ctx.tenant.has(key))) return fail("not_found", "Promo notifications aren't available for this store.");
    const body = await readJson(req);
    if (typeof body?.on !== "boolean") return fail("invalid_input", "Say on or off.");
    return ok({ optedIn: await setPromoOptIn(ctx.tenantId, ctx.customer.id, body.on) });
  });
}
