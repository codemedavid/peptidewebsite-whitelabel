import { fail, ok, withMobile } from "@/lib/mobile/http";
import { getCustomer } from "@/lib/mobile/reports";

type Params = { params: Promise<{ key: string }> };

const NOT_FOUND = "This customer has no orders in your store.";

// GET /api/mobile/v1/customers/:key — profile, favourites and order history.
export async function GET(req: Request, { params }: Params) {
  return withMobile(req, { route: "customers/:key", permission: "orders" }, async (ctx) => {
    const key = (await params).key;
    if (!/^[a-f0-9]{20}$/.test(key)) return fail("not_found", NOT_FOUND);
    const customer = await getCustomer(ctx, key);
    return customer ? ok(customer) : fail("not_found", NOT_FOUND);
  });
}
