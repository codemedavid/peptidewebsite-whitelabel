import { ok, withMobile } from "@/lib/mobile/http";
import { asAppActor } from "@/lib/mobile/admin-bridge";
import { loadStorefrontBrand } from "@/lib/storefront/storefront-brand";
import { visibleNavGroups } from "@/storefront/admin/admin-nav";

// GET /api/mobile/v1/admin/menu — the website admin sidebar for THIS user:
// hidden modules and ungranted tools dropped, Business-exclusive ones flagged
// `locked` (admin-nav.ts is the single source of those rules). Icon + tint are
// website-only presentation and are not sent.
export async function GET(req: Request) {
  return withMobile(req, { route: "admin/menu" }, async (ctx) => {
    const { brand } = await asAppActor(ctx, () =>
      loadStorefrontBrand({ tenantId: ctx.tenantId, slug: ctx.slug, isResellerUnlocked: async () => false }),
    );
    const groups = visibleNavGroups(brand, ctx.actor).map((g) => ({
      id: g.id,
      label: g.label,
      items: g.items.map(({ view, label, hint, group, locked, isNew }) => ({ view, label, hint, group, locked, isNew })),
    }));
    return ok({ groups });
  });
}
