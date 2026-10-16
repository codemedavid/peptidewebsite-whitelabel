import { videoUploadTicket } from "@/lib/community/uploads.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";

const TICKETS_PER_WINDOW = 30;
const TEN_MIN = 10 * 60 * 1000;

// POST /api/mobile/v1/community/uploads/video  { name } → VideoUploadTicket (moderators)
// The app uploads the video straight to ImageKit with the ticket, then calls /confirm.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/uploads/video", moderator: true }, async (actor) => {
    if (!rateLimit(`community:video-ticket:${actor.session.id}`, TICKETS_PER_WINDOW, TEN_MIN).ok) {
      return fail("rate_limited", "Too many uploads. Try again in a few minutes.");
    }
    const body = await readJson(req);
    const name = body && typeof body === "object" ? (body as Record<string, unknown>).name : undefined;
    return ok(await videoUploadTicket(actor, name));
  });
}
