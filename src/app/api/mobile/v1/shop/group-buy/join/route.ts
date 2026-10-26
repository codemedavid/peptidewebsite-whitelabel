import { getGroupBuyJoinAction, startGroupBuyJoinAction } from "@/actions/gb-join";
import { fail, ok, withCustomer } from "@/lib/mobile/http";
import { asShopper } from "@/lib/mobile/shop";
import type { GroupBuyJoinResult } from "@/lib/mobile/shop-contract";

// Paid group-buy join (lib/storefront/gb-join.server.ts) — the website's own
// actions, run as the signed-in customer.
//   GET  /api/mobile/v1/shop/group-buy/join?round=<id>  → GroupBuyJoinState
//   POST /api/mobile/v1/shop/group-buy/join { roundId }  → GroupBuyJoinState
// POST is idempotent: a live request comes back as-is, never a second one.

function respond(result: GroupBuyJoinResult) {
  return result.ok ? ok(result.state) : fail(result.code, result.message);
}

export async function GET(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/join" }, async (ctx) => {
    const round = new URL(req.url).searchParams.get("round");
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    return respond(await asShopper(store, () => getGroupBuyJoinAction(round)));
  });
}

export async function POST(req: Request) {
  return withCustomer(req, { route: "shop/group-buy/join" }, async (ctx) => {
    const body = (await req.json().catch(() => null)) as { roundId?: unknown } | null;
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    return respond(await asShopper(store, () => startGroupBuyJoinAction(body?.roundId)));
  });
}
