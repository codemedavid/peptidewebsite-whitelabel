import { fail, ok, readJson, withMobile } from "@/lib/mobile/http";
import { FEATURES } from "@/lib/features/catalog";
import { updateBrandingConfig } from "@/lib/tenant/branding-config-write";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import { APP_PROMO_STAFF_MODULE } from "@/lib/storefront/app-promo";

// PUT /api/mobile/v1/admin/app-promo  { enabled: boolean } → { enabled }
// Show or hide the "Get our app" bar on the store's website
// (lib/storefront/app-promo.ts). The store team only: the owner, or staff
// with Announcement Banner. Turning it ON needs the customer app open (App
// shopping or App community) — there's no app to advertise otherwise; the
// website re-checks that on every render too.
export async function PUT(req: Request) {
  return withMobile(req, { route: "admin/app-promo" }, async (ctx) => {
    if (!isModuleAllowed(ctx.actor, APP_PROMO_STAFF_MODULE)) {
      return fail("forbidden", "Your account doesn't have access to this. Ask the store owner.");
    }
    const body = await readJson(req);
    if (typeof body?.enabled !== "boolean") return fail("invalid_input", "Say on or off.");
    const appOpen = ctx.tenant.has(FEATURES.MOBILE_SHOP) || ctx.tenant.has(FEATURES.MOBILE_COMMUNITY);
    if (body.enabled && !appOpen) {
      return fail("forbidden", "Your store's app isn't switched on yet, so there's nothing to show. Ask Pepweb to turn on App shopping.");
    }
    const enabled = body.enabled;
    await updateBrandingConfig(ctx.tenantId, (current) => ({ ...current, appPromo: { enabled } }));
    revalidateTenant(ctx.tenantId, ctx.slug);
    return ok({ enabled });
  });
}
