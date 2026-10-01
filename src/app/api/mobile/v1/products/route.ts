import { ok, withMobile } from "@/lib/mobile/http";
import { listProducts } from "@/lib/mobile/products";

// GET /api/mobile/v1/products — the catalog with stock levels (Products or Inventory grant).
export async function GET(req: Request) {
  return withMobile(req, { route: "products", permission: ["products", "inv"] }, async (ctx) =>
    ok({ products: await listProducts(ctx) }),
  );
}
