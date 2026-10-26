import { ok, withMobile } from "@/lib/mobile/http";
import { loadShopCatalog } from "@/lib/mobile/shop-catalog";
import { ADMIN_VIEWER } from "@/lib/storefront/gb-access.server";

// GET /api/mobile/v1/admin/storefront → ShopCatalog (lib/mobile/shop-contract.ts)
// The store team's native "View your store": the SAME catalog shoppers get
// from /shop/catalog (public price list, closed state, group-buy gate), built
// for the session's store. /shop/catalog refuses admin tokens on purpose, and
// a store preview must work even when the customer app (MOBILE_COMMUNITY) or
// the visitor access code would hide the store from a guest.
export async function GET(req: Request) {
  return withMobile(req, { route: "admin/storefront" }, async (ctx) =>
    // The team sees its own paid rounds in full (gb-access: admins are never locked).
    ok(await loadShopCatalog({ tenantId: ctx.tenantId, slug: ctx.slug, customer: null }, { viewer: ADMIN_VIEWER })),
  );
}
