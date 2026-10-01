import { ok, withMobile } from "@/lib/mobile/http";
import { listCustomers } from "@/lib/mobile/reports";

// GET /api/mobile/v1/customers?q=&sort=spent|recent|orders&segment=new|returning|loyal|lapsed
// Customers are built from orders, so they need the same Orders permission
// that already shows each order's customer.
export async function GET(req: Request) {
  return withMobile(req, { route: "customers", permission: "orders" }, async (ctx) =>
    ok(await listCustomers(ctx, new URL(req.url).searchParams)),
  );
}
