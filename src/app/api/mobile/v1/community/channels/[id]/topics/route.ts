import { communityLimit } from "@/lib/community/limits.server";
import { createTopic } from "@/lib/community/channels.server";
import { respond } from "@/lib/community/respond";
import { readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };

// POST /api/mobile/v1/community/channels/:id/topics  TopicInput → CommunityTopic
// Anyone who can post in the channel may start a topic.
export async function POST(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/channels/:id/topics" }, async (actor) => {
    const limited = communityLimit("topicCreate", actor);
    if (limited) return limited;
    return respond(await createTopic(actor, (await params).id, await readJson(req)), "This channel isn't available.");
  });
}
