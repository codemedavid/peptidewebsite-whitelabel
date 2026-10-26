import { getGroupBuyReceiptUrlAction, submitGroupBuyReceiptAction } from "@/actions/gb-join";
import { fail, ok, withCustomer } from "@/lib/mobile/http";
import { asShopper } from "@/lib/mobile/shop";

// Paid group-buy receipt (lib/storefront/gb-join.server.ts).
//   POST multipart { roundId, file, reference, method?, paidAt? } → GroupBuyJoinState
//   GET  ?round=<id> → { url } — a 10-minute signed link to the caller's OWN receipt.
// Receipts are private files: no endpoint ever returns another customer's.

export async function POST(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/receipt" }, async (ctx) => {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("invalid_input", "Add a screenshot of your payment.");
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    const result = await asShopper(store, () => submitGroupBuyReceiptAction(form));
    return result.ok ? ok(result.state) : fail(result.code, result.message);
  });
}

export async function GET(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/receipt" }, async (ctx) => {
    const round = new URL(req.url).searchParams.get("round");
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    const result = await asShopper(store, () => getGroupBuyReceiptUrlAction(round));
    return result.ok ? ok({ url: result.url }) : fail(result.code, result.message);
  });
}
