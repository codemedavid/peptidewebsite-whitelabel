import { setChannelMute } from "@/lib/community/channels.server";
import { communityLimit } from "@/lib/community/limits.server";
import { respond } from "@/lib/community/respond";
import { fail, readJson, withCommunity } from "@/lib/mobile/http";

type Params = { params: Promise<{ id: string }> };
const GONE = "This channel isn't available.";

// PUT /api/mobile/v1/community/channels/:id/mute  ChannelMuteRequest → ChannelMuteResponse
// Members only: stop (or resume) this channel's chat-message pushes on my phones.
// Drops and group buys still push. Not open in preview — previewers get no channel pushes.
export async function PUT(req: Request, { params }: Params) {
  return withCommunity(req, { route: "community/channels/:id/mute" }, async (actor) => {
    const limited = communityLimit("mute", actor);
    if (limited) return limited;
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Choose whether to mute this channel.");
    return respond(await setChannelMute(actor, (await params).id, body), GONE);
  });
}
