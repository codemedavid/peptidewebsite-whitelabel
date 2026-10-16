import { saveCommunityTags } from "@/lib/community/tags.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

// PATCH /api/mobile/v1/community/tags  { tags: { admin?, reseller? } } (the team and community admins)
// Each tag: { label, icon | null, color "#RRGGBB" | null, style, shape } → the store's full tags.
// Every member reads them from /me (community.tags).
export async function PATCH(req: Request) {
  return withCommunity(req, { route: "community/tags:patch", moderator: true }, async (actor) => {
    const res = await saveCommunityTags(actor, await readJson(req));
    return res.ok ? ok(res.value) : fail("invalid_input", res.error);
  });
}
