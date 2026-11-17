import { FEATURES } from "@/lib/features/catalog";
import { mobileCan } from "@/lib/mobile/branding";
import { fail, ok, withMobile } from "@/lib/mobile/http";
import { parseInsightsQuery } from "@/lib/mobile/insights";
import { getInsights } from "@/lib/mobile/reports";

// GET /api/mobile/v1/insights?range=<preset>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//   [&granularity=hour|day|week|month][&compare=previous|year|none] — sales analytics. Same
// gate as the web's Sales Analytics: staff grant + plan entitlement + the
// operator's branding switch (mobileCan().analytics).
//
// The "Group Buys" breakdown rides its own Sales Analytics slice, exactly like
// the website's brand.showAnalyticsGroupBuys (lib/storefront/storefront-brand):
// without SA_SECTION_GROUP_BUYS the section is null, never an empty list.
export async function GET(req: Request) {
  return withMobile(req, { route: "insights" }, async (ctx) => {
    if (!mobileCan(ctx).analytics) {
      return fail("forbidden", "Sales insights aren't available for this account or plan.");
    }
    const report = await getInsights(ctx, parseInsightsQuery(new URL(req.url).searchParams));
    const showGroupBuys = ctx.tenant.has(FEATURES.SA_SECTION_GROUP_BUYS);
    return ok(showGroupBuys ? report : { ...report, groupBuys: null });
  });
}
