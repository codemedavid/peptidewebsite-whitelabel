import { communityLimit } from "@/lib/community/limits.server";
import { reapply } from "@/lib/community/members.server";
import { fail, ok, readJson, withCustomer } from "@/lib/mobile/http";

// POST /api/mobile/v1/community/reapply  { displayName } → CommunityMe
// A declined customer sends their application again (back to pending).
export async function POST(req: Request) {
  return withCustomer(req, { route: "community/reapply" }, async (ctx) => {
    const limited = communityLimit("reapply", { tenantId: ctx.tenantId, key: `c:${ctx.customer.id}` });
    if (limited) return limited;
    const res = await reapply(ctx, await readJson(req));
    return res.ok ? ok(res.value) : fail("invalid_input", res.error);
  });
}
