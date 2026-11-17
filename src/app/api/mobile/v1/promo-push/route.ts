import { fail, ok, readJson, withSession } from "@/lib/mobile/http";
import { encodeSubject } from "@/lib/mobile/sessions";
import { rateLimit } from "@/lib/security/rate-limit";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import type { MobileContext } from "@/lib/mobile/auth";
import { PROMO_STAFF_MODULE, parsePromoInput, promoPushEnabled } from "@/lib/mobile/promo-push";
import { promoPushStatus, sendPromoPush } from "@/lib/mobile/promo-push.server";
import { storeDisplayName } from "@/lib/mobile/store-name";

// Store promo & event notifications (lib/mobile/promo-push.ts).
//   GET  /api/mobile/v1/promo-push → PromoPushStatus (who'll get it, sends left, recent)
//   POST /api/mobile/v1/promo-push  PromoPushRequest → PromoPushSent
// The store team only: the owner, or staff with Promo Codes. Store granted
// mobile.promo_push and its customer app open, else 404. Goes ONLY to customers
// who opted in; at most 3 sends per rolling 24 hours (429 rate_limited).

const TEN_MIN = 10 * 60 * 1000;

function gate(ctx: MobileContext): { code: "not_found" | "forbidden"; message: string } | null {
  if (!promoPushEnabled((key) => ctx.tenant.has(key))) return { code: "not_found", message: "Promo notifications aren't available for this store." };
  if (!isModuleAllowed(ctx.actor, PROMO_STAFF_MODULE)) return { code: "forbidden", message: "Your account doesn't have access to this. Ask the store owner." };
  return null;
}

export async function GET(req: Request) {
  return withSession(req, { route: "promo-push" }, async (principal) => {
    if (principal.kind !== "admin") return fail("forbidden", "This is for the store team.");
    const refused = gate(principal.ctx);
    if (refused) return fail(refused.code, refused.message);
    return ok(await promoPushStatus(principal.ctx.tenantId));
  });
}

export async function POST(req: Request) {
  return withSession(req, { route: "promo-push:post" }, async (principal) => {
    if (principal.kind !== "admin") return fail("forbidden", "This is for the store team.");
    const ctx = principal.ctx;
    const refused = gate(ctx);
    if (refused) return fail(refused.code, refused.message);
    if (!rateLimit(`mobile:promo-push:${ctx.session.id}`, 10, TEN_MIN).ok) {
      return fail("rate_limited", "Too many tries. Wait a few minutes.");
    }
    const parsed = parsePromoInput(await readJson(req));
    if (!parsed.ok) return fail("invalid_input", parsed.message);
    const res = await sendPromoPush(ctx.tenantId, storeDisplayName(ctx.tenant), encodeSubject(ctx.session.subject), parsed.value);
    return res.ok ? ok(res.value) : fail(res.code, res.message);
  });
}
