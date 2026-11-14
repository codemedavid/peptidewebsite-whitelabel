import { mobileCan } from "@/lib/mobile/branding";
import { fail, ok, withMobile } from "@/lib/mobile/http";
import { parseInsightsQuery } from "@/lib/mobile/insights";
import { getInsights } from "@/lib/mobile/reports";

// GET /api/mobile/v1/insights?range=<preset>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//   [&granularity=hour|day|week|month][&compare=previous|year|none] — sales analytics. Same
// gate as the web's Sales Analytics: staff grant + plan entitlement + the
// operator's branding switch (mobileCan().analytics).
export async function GET(req: Request) {
  return withMobile(req, { route: "insights" }, async (ctx) => {
    if (!mobileCan(ctx).analytics) {
      return fail("forbidden", "Sales insights aren't available for this account or plan.");
    }
    return ok(await getInsights(ctx, parseInsightsQuery(new URL(req.url).searchParams)));
  });
}
