import { uploadCommunityFile } from "@/lib/community/uploads.server";
import { fail, ok, withCommunity } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";

const UPLOADS_PER_WINDOW = 30;
const TEN_MIN = 10 * 60 * 1000;

// POST /api/mobile/v1/community/uploads  multipart { file } → UploadResponse
// Photos ≤ 10 MB; pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/rtf ≤ 25 MB, sniffed from the bytes.
export async function POST(req: Request) {
  return withCommunity(req, { route: "community/uploads" }, async (actor) => {
    if (!rateLimit(`community:upload:${actor.session.id}`, UPLOADS_PER_WINDOW, TEN_MIN).ok) {
      return fail("rate_limited", "Too many uploads. Try again in a few minutes.");
    }
    const form = (await req.formData().catch(() => null)) as { get(name: string): unknown } | null;
    if (!form) return fail("invalid_input", "Choose a photo or file to send.");
    const res = await uploadCommunityFile(actor, form.get("file"));
    return res.ok ? ok(res.upload) : fail("invalid_input", res.message);
  });
}
