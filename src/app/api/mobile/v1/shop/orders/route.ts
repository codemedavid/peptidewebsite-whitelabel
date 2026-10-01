import { fail, ok, readJson, withCustomer } from "@/lib/mobile/http";
import { listShopOrders } from "@/lib/mobile/shop-orders";
import { placeShopOrder } from "@/lib/mobile/shop-flow";
import { rateLimit } from "@/lib/security/rate-limit";

const TEN_MIN = 10 * 60 * 1000;
const MAX_PLACEMENTS = 20;

// POST /api/mobile/v1/shop/orders  PlaceShopOrderRequest → PlaceShopOrderResponse
// Customers only: every app order lands in the account's order history.
// Idempotent on `id` (the website's clientId), so a retry after a lost
// response returns the stored order instead of a second one.
export async function POST(req: Request) {
  return withCustomer(req, { route: "shop/orders" }, async (ctx) => {
    if (!rateLimit(`mobile:shop-order:${ctx.session.id}`, MAX_PLACEMENTS, TEN_MIN).ok) {
      return fail("rate_limited", "Too many orders in a short time. Try again in a few minutes.");
    }
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Your order couldn't be read. Please try again.");
    const result = await placeShopOrder({ tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx }, body);
    return result.ok ? ok({ order: result.data }) : fail(result.code, result.message);
  });
}

// GET /api/mobile/v1/shop/orders → ShopOrdersResponse (newest first, max 100)
export async function GET(req: Request) {
  return withCustomer(req, { route: "shop/orders" }, async (ctx) =>
    ok({ orders: await listShopOrders(ctx.tenantId, ctx.customer.id) }),
  );
}
