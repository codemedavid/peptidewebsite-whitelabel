import { ok, withMobile } from "@/lib/mobile/http";
import { ADMIN_VIEWER } from "@/lib/storefront/gb-access.server";
import { asAppActor } from "@/lib/mobile/admin-bridge";
import { loadStorefrontBrand } from "@/lib/storefront/storefront-brand";

// GET /api/mobile/v1/admin/brand — the same Brand projection the website
// #admin renders from, built as this app user. The reseller unlock is a
// shopper cookie concept, so it is always "locked" for the app.
export async function GET(req: Request) {
  return withMobile(req, { route: "admin/brand" }, async (ctx) => {
    const { brand } = await asAppActor(ctx, () =>
      loadStorefrontBrand({ tenantId: ctx.tenantId, slug: ctx.slug, isResellerUnlocked: async () => false, groupBuyViewer: async () => ADMIN_VIEWER }),
    );
    return ok({ brand });
  });
}
