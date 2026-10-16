import { after } from "next/server";
import { createDrop, listDrops } from "@/lib/community/drops.server";
import { notifyDrop } from "@/lib/community/push.server";
import { respond } from "@/lib/community/respond";
import { ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/drops → { drops } (live ones only)
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/drops", preview: true }, async (actor) => ok(await listDrops(actor)));
}

// POST /api/mobile/v1/community/drops  DropInput → CommunityDrop (moderators).
// Announces in the channel's General topic and pushes every approved member.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/drops:post", team: true }, async (actor) => {
    const res = await createDrop(actor, await readJson(req));
    if (res.kind === "ok") {
      const drop = res.value;
      after(() => notifyDrop({ tenantId: actor.tenantId, topicId: drop.topicId, headline: drop.headline, storeName: actor.storeName }));
    }
    return respond(res);
  });
}
