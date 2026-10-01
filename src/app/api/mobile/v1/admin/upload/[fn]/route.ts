import { fail, ok, withMobile } from "@/lib/mobile/http";
import { FORM_ACTIONS, lookupAction, runBridgedUpload } from "@/lib/mobile/admin-bridge";

type Params = { params: Promise<{ fn: string }> };

/** Actions cap images at 10 MB; leave room for the multipart envelope. */
const MAX_UPLOAD_BODY_BYTES = 11 * 1024 * 1024;

// POST /api/mobile/v1/admin/upload/:fn?field=<name> — multipart, one file in
// <field>. The form is handed to the allowlisted website upload action as-is,
// so the app sends the file under the name that action reads ("file").
export async function POST(req: Request, { params }: Params) {
  return withMobile(req, { route: "admin/upload" }, async (ctx) => {
    const { fn } = await params;
    if (!lookupAction(FORM_ACTIONS, fn)) return fail("not_found", "This upload isn't available in the app.");

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BODY_BYTES) return fail("invalid_input", "Image too large (max 10 MB).");

    const field = new URL(req.url).searchParams.get("field") || "file";
    let form: FormData;
    try {
      // Request#formData's FormData and the DOM lib's are the same object at
      // runtime; the cast only bridges two ambient declarations.
      form = (await req.formData()) as unknown as FormData;
    } catch {
      return fail("invalid_input", "Malformed upload.");
    }
    if (!(form.get(field) instanceof File)) return fail("invalid_input", "No file provided.");

    const res = await runBridgedUpload(ctx, fn, form);
    if (!res.ok) return fail("not_found", "This upload isn't available in the app.");
    return ok(res.data ?? null);
  });
}
