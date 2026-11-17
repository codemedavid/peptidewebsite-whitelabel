import { ok } from "@/lib/mobile/http";
import { withTracker } from "@/lib/tracker/http";
import { loadOrderVials } from "@/lib/tracker/order-vials.server";

// GET /api/mobile/v1/tracker/order-vials → { vials: TrackerOrderVial[] }
// The buyer's shipped/delivered order lines (newest first, max 100), so the app
// can add one as a vial with its strength prefilled. The store team tracks too
// but buys nothing through the app, so theirs is always empty.
export async function GET(req: Request) {
  return withTracker(req, { route: "tracker/order-vials" }, async (ctx) =>
    ok(ctx.owner.customerId ? await loadOrderVials(ctx.tenantId, ctx.owner.customerId) : { vials: [] }),
  );
}
