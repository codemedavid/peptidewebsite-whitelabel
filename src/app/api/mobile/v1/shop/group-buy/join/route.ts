import {
  cancelPaidAccessJoinAction,
  getPaidAccessJoinAction,
  startPaidAccessJoinAction,
  startPaidAccessOnlinePaymentAction,
  submitPaidAccessFormAction,
} from "@/modules/paid-access/actions";
import { withCustomer } from "@/lib/mobile/http";
import { respond } from "@/lib/mobile/paid-access-http";
import { asShopper } from "@/lib/mobile/shop";

// Paid Access join (src/modules/paid-access) — the website's own actions, run as the
// signed-in customer.
//   GET  ?round=<id>                                   → GroupBuyJoinState
//   POST { roundId, action?: "start" }                 → start (idempotent: a live membership comes back as-is)
//   POST { roundId, action: "form", answers }          → submit the application
//   POST { roundId, action: "online" }                 → { state, checkout: { url } } — paid only once the webhook lands
//   POST { roundId, action: "cancel" }                 → leave before paying

export async function GET(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/join" }, async (ctx) => {
    const round = new URL(req.url).searchParams.get("round");
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    return respond(await asShopper(store, () => getPaidAccessJoinAction(round)));
  });
}

export async function POST(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/join" }, async (ctx) => {
    const body = ((await req.json().catch(() => null)) ?? {}) as { roundId?: unknown; action?: unknown; answers?: unknown };
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    const id = body.roundId;
    const run =
      body.action === "form"
        ? () => submitPaidAccessFormAction(id, body.answers)
        : body.action === "online"
          ? () => startPaidAccessOnlinePaymentAction(id)
          : body.action === "cancel"
            ? () => cancelPaidAccessJoinAction(id)
            : () => startPaidAccessJoinAction(id);
    return respond(await asShopper(store, run));
  });
}
