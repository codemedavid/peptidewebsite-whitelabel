import { getProfile } from "@/lib/community/members.server";
import { fail, ok, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ key: string }> };

// GET /api/mobile/v1/community/profiles/:key → a member's (or the store's) profile.
export async function GET(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/profiles/:key" }, async (actor) => {
    let key: string;
    try {
      key = decodeURIComponent((await params).key);
    } catch {
      return fail("not_found", "This member isn't available.");
    }
    const profile = await getProfile(actor, key);
    return profile ? ok(profile) : fail("not_found", "This member isn't available.");
  });
}
