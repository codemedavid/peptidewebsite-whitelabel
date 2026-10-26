import { getPaidAccessReceiptUrlAction, submitPaidAccessProofAction } from "@/modules/paid-access/actions";
import { fail, ok, withCustomer } from "@/lib/mobile/http";
import { asShopper } from "@/lib/mobile/shop";
import { respond } from "@/lib/mobile/paid-access-http";

// Paid Access proof of payment (src/modules/paid-access).
//   POST multipart { roundId, file, reference, method?, paidAt? } → GroupBuyJoinState
//   GET  ?round=<id> → { url } — a 10-minute signed link to the caller's OWN proof.
// Proofs are private files: no endpoint ever returns another customer's.

export async function POST(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/receipt" }, async (ctx) => {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("invalid_input", "Add a screenshot of your payment.");
    if (!form.get("groupBuyId") && form.get("roundId")) form.set("groupBuyId", String(form.get("roundId")));
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    return respond(await asShopper(store, () => submitPaidAccessProofAction(form)));
  });
}

export async function GET(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/receipt" }, async (ctx) => {
    const round = new URL(req.url).searchParams.get("round");
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    const result = await asShopper(store, () => getPaidAccessReceiptUrlAction(round));
    if (result.ok) return ok({ url: result.url });
    return fail(result.code === "unauthenticated" ? "unauthenticated" : "not_found", result.message);
  });
}
