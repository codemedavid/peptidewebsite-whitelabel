import { removeAccountPhoto, setAccountPhoto } from "@/lib/mobile/account-profile.server";
import { fail, ok, withSession } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";

const UPLOADS_PER_WINDOW = 10;
const TEN_MIN = 10 * 60 * 1000;

// POST /api/mobile/v1/account/profile/photo  multipart { file } → AccountProfileView
// Images only (JPG/PNG/WEBP/GIF, sniffed from the bytes), into the store's media folder.
export async function POST(req: Request) {
  return withSession(req, { route: "account/profile/photo" }, async (principal) => {
    if (!rateLimit(`account:photo:${principal.ctx.session.id}`, UPLOADS_PER_WINDOW, TEN_MIN).ok) {
      return fail("rate_limited", "Too many uploads. Try again in a few minutes.");
    }
    const form = (await req.formData().catch(() => null)) as { get(name: string): unknown } | null;
    if (!form) return fail("invalid_input", "Choose a photo.");
    const res = await setAccountPhoto(principal, form.get("file"));
    return res.ok ? ok(res.profile) : fail("invalid_input", res.message);
  });
}

// DELETE /api/mobile/v1/account/profile/photo → back to initials.
export async function DELETE(req: Request) {
  return withSession(req, { route: "account/profile/photo:delete" }, async (principal) => ok(await removeAccountPhoto(principal)));
}
