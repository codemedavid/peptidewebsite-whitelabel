import { listMembers, setJoinMode, setWelcome } from "@/lib/community/members.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/members?status=pending|approved|rejected|revoked (moderators; community admins get no contact details)
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/members", moderator: true }, async (actor) =>
    ok(await listMembers(actor, new URL(req.url).searchParams.get("status"))),
  );
}

// PATCH /api/mobile/v1/community/members
//   { joinMode: "open" | "approval" }            → who can join (the store team)
//   { welcome: { enabled, messages: [{ id?, text, media }] } } → the new-member welcome DMs
//     (moderators: the team and community admins; older builds: { enabled, message } —
//     edits the first message only)
export async function PATCH(req: Request) {
  return withCommunity(req, { route: "community/members:patch", moderator: true }, async (actor) => {
    const body = await readJson(req);
    if (body && typeof body === "object" && "welcome" in body) {
      const res = await setWelcome(actor, body);
      return res.ok ? ok({ welcome: res.value }) : fail("invalid_input", res.error);
    }
    if (!actor.isTeam) return fail("forbidden", "Only the store team can do this.");
    const res = await setJoinMode(actor, body);
    return res.ok ? ok({ joinMode: res.value }) : fail("invalid_input", res.error);
  });
}
