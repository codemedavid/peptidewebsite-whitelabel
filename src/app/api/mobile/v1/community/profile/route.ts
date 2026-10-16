import { communityLimit } from "@/lib/community/limits.server";
import { getProfile, updateMyProfile } from "@/lib/community/members.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/profile → this account's community profile.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/profile", preview: true }, async (actor) => {
    const profile = await getProfile(actor, actor.key);
    return profile ? ok(profile) : fail("not_found", "Profile not found.");
  });
}

// PATCH /api/mobile/v1/community/profile  { displayName, bio } — customers.
export async function PATCH(req: Request) {
  return withCommunity(req, { route: "community/profile:patch", preview: true }, async (actor) => {
    const limited = communityLimit("profileEdit", actor);
    if (limited) return limited;
    const res = await updateMyProfile(actor, await readJson(req));
    return res.ok ? ok(res.value) : fail("invalid_input", res.error);
  });
}
