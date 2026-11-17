import { buildDashboardGroupBuy } from "@/lib/mobile/dashboard-gb";
import { fail, ok, withMobile } from "@/lib/mobile/http";

// GET /api/mobile/v1/dashboard/group-buy — Home's Group Buy card (the website
// dashboard's DashboardGroupBuy). `{ status: "off" }` when this store or account
// can't see group buys; the website's own group-buy guard runs as this app user
// and its refusal comes back word for word.
export async function GET(req: Request) {
  return withMobile(req, { route: "dashboard/group-buy" }, async (ctx) => {
    const card = await buildDashboardGroupBuy(ctx);
    return "error" in card ? fail("forbidden", card.error) : ok(card);
  });
}
