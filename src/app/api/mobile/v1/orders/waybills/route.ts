import { fail, ok, withMobile } from "@/lib/mobile/http";
import { listWaybills } from "@/lib/mobile/orders";
import { waybillQuery } from "@/lib/mobile/waybill";

// GET /api/mobile/v1/orders/waybills?round=<groupBuyId>|on-hand&filter=&q=  — a round's waybills
// GET /api/mobile/v1/orders/waybills?id=<orderId>                          — one order's waybill
export async function GET(req: Request) {
  return withMobile(req, { route: "orders/waybills", permission: "orders" }, async (ctx) => {
    const query = waybillQuery(new URL(req.url).searchParams);
    if (!query) return fail("invalid_input", "Pick a group buy to print its waybills.");
    return ok(await listWaybills(ctx, query));
  });
}
