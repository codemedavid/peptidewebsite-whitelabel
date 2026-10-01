import { setStoreOpen } from "@/lib/mobile/account";
import { fail, ok, readJson, withMobile } from "@/lib/mobile/http";

// PUT /api/mobile/v1/store-status  { open } — the owner's shop switch
// (same grant as the web's Store Status screen).
export async function PUT(req: Request) {
  return withMobile(req, { route: "store-status", permission: "store-status" }, async (ctx) => {
    const body = await readJson(req);
    if (typeof body?.open !== "boolean") return fail("invalid_input", "Choose open or closed.");
    return ok(await setStoreOpen(ctx, body.open));
  });
}
