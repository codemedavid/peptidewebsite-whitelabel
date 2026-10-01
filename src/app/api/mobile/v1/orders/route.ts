import { ok, withMobile } from "@/lib/mobile/http";
import { listOrders } from "@/lib/mobile/orders";

// GET /api/mobile/v1/orders?filter=new|to-fulfil|shipped|all&q=&cursor=&limit=
export async function GET(req: Request) {
  return withMobile(req, { route: "orders", permission: "orders" }, async (ctx) =>
    ok(await listOrders(ctx, new URL(req.url).searchParams)),
  );
}
