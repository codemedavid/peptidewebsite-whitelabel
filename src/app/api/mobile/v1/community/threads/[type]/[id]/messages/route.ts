import { communityLimit } from "@/lib/community/limits.server";
import { after } from "next/server";
import { listMessages, sendMessage } from "@/lib/community/messages.server";
import { notifyDm, notifySafetyFlag, notifyTopicMessage } from "@/lib/community/push.server";
import { respond } from "@/lib/community/respond";
import { parseThreadType } from "@/lib/community/thread-access.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ type: string; id: string }> };
const GONE = "This chat isn't available.";

// GET /api/mobile/v1/community/threads/:type/:id/messages?before=|after=|limit=
// Newest first. `after` (the last pollCursor) returns only newer messages plus
// `changed` — edits and deletions since the previous poll.
export async function GET(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/threads/messages", preview: true }, async (actor) => {
    const { type: rawType, id } = await params;
    const type = parseThreadType(rawType);
    if (!type) return fail("not_found", GONE);
    return respond(await listMessages(actor, type, id, new URL(req.url).searchParams), GONE);
  });
}

// POST /api/mobile/v1/community/threads/:type/:id/messages  SendMessageRequest → CommunityMessage
// Idempotent on clientId. A new DM pushes the other side after the response; a
// new channel message pushes the channel's members (minus anyone who muted it).
// Members' text is checked by the safety bot first (lib/community/moderation.server.ts).
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/threads/messages:post", preview: true }, async (actor) => {
    const { type: rawType, id } = await params;
    const type = parseThreadType(rawType);
    if (!type) return fail("not_found", GONE);
    const limited = communityLimit("send", actor);
    if (limited) return limited;
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Type a message first.");
    const res = await sendMessage(actor, type, id, body);
    if (res.kind !== "ok") return respond(res, GONE);
    const { message, created, access } = res.value;
    // A message the safety bot hid never buzzes the recipient — the team gets the review ping instead.
    if (created && message.moderated) {
      after(() => notifySafetyFlag({ tenantId: actor.tenantId, storeName: actor.storeName }));
    } else if (created && access.type === "dm") {
      after(() =>
        notifyDm({
          tenantId: actor.tenantId,
          conversationId: access.id,
          senderKey: actor.key,
          recipientKey: access.peer.key,
          senderName: message.sender?.name ?? "",
          storeName: actor.storeName,
        }),
      );
    } else if (created && access.type === "topic") {
      after(() =>
        notifyTopicMessage({
          tenantId: actor.tenantId,
          topic: access.topic,
          channel: access.channel,
          senderKey: actor.key,
          senderName: message.sender?.name ?? "",
          storeName: actor.storeName,
        }),
      );
    }
    return ok(message);
  });
}
