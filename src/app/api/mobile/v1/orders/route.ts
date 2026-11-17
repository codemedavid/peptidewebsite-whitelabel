import { ok, withMobile } from "@/lib/mobile/http";
import { listOrders } from "@/lib/mobile/orders";

// GET /api/mobile/v1/orders?filter=new|to-fulfil|shipped|all&payment=all|unpaid|paid&q=
//   &round=<groupBuyId>|on-hand&folder=<groupBuyId>|outside&cursor=&limit=
// `folder` files orders like the web Orders hub (stamped + in-window unstamped);
// `round` matches the stamped groupBuyId only. statusCounts / paymentCounts are
// taken over the folder + round, each under the other facet's choice.
export async function GET(req: Request) {
  return withMobile(req, { route: "orders", permission: "orders" }, async (ctx) =>
    ok(await listOrders(ctx, new URL(req.url).searchParams)),
  );
}
