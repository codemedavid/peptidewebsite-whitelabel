import { mobileCan } from "@/lib/mobile/branding";
import { fail, ok, withMobile } from "@/lib/mobile/http";
import { parseRange } from "@/lib/mobile/insights";
import { getInsights } from "@/lib/mobile/reports";

// GET /api/mobile/v1/insights?range=today|7d|30d|90d — sales analytics. Same
// gate as the web's Sales Analytics: staff grant + plan entitlement + the
// operator's branding switch (mobileCan().analytics).
export async function GET(req: Request) {
  return withMobile(req, { route: "insights" }, async (ctx) => {
    if (!mobileCan(ctx).analytics) {
      return fail("forbidden", "Sales insights aren't available for this account or plan.");
    }
    const range = parseRange(new URL(req.url).searchParams.get("range"));
    return ok(await getInsights(ctx, range));
  });
}
