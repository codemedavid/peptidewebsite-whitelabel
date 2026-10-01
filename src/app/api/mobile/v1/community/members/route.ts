import { listMembers, setJoinMode } from "@/lib/community/members.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/members?status=pending|approved|rejected|revoked (moderators)
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/members", moderator: true }, async (actor) =>
    ok(await listMembers(actor, new URL(req.url).searchParams.get("status"))),
  );
}

// PATCH /api/mobile/v1/community/members  { joinMode: "open" | "approval" } (moderators)
export async function PATCH(req: Request) {
  return withCommunity(req, { route: "community/members:patch", moderator: true }, async (actor) => {
    const res = await setJoinMode(actor, await readJson(req));
    return res.ok ? ok({ joinMode: res.value }) : fail("invalid_input", res.error);
  });
}
