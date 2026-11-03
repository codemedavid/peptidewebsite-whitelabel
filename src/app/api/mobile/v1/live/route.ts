import { mobileCan } from "@/lib/mobile/branding";
import { fail, ok, withMobile } from "@/lib/mobile/http";
import { loadLive } from "@/lib/presence/live.server";

// GET /api/mobile/v1/live — who is on the store right now (website + app).
// Same gate as Insights (mobileCan().analytics): it is visitor analytics.
export async function GET(req: Request) {
  return withMobile(req, { route: "live" }, async (ctx) => {
    if (!mobileCan(ctx).analytics) {
      return fail("forbidden", "Live visitors aren't available for this account or plan.");
    }
    const currency = (ctx.tenant.branding?.config as { currency?: unknown } | null | undefined)?.currency;
    return ok(await loadLive(ctx.tenantId, currency));
  });
}
