import { confirmVideoUpload } from "@/lib/community/uploads.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";

const CONFIRMS_PER_WINDOW = 30;
const TEN_MIN = 10 * 60 * 1000;

// POST /api/mobile/v1/community/uploads/video/confirm  { fileId, width?, height? } → UploadResponse (moderators)
// Records the direct upload once its bytes prove it's a video in this store's folder.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/uploads/video/confirm", moderator: true }, async (actor) => {
    if (!rateLimit(`community:video-confirm:${actor.session.id}`, CONFIRMS_PER_WINDOW, TEN_MIN).ok) {
      return fail("rate_limited", "Too many uploads. Try again in a few minutes.");
    }
    const res = await confirmVideoUpload(actor, await readJson(req));
    return res.ok ? ok(res.upload) : fail("invalid_input", res.message);
  });
}
