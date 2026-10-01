import { fail, ok, readJson, withMobile } from "@/lib/mobile/http";
import { updateProduct } from "@/lib/mobile/products";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/mobile/v1/products/:id  { available?, stock?, expectedUpdatedAt }
// Same grants as the web's Inventory screen, which edits these two fields.
export async function PATCH(req: Request, { params }: Params) {
  return withMobile(req, { route: "products/:id", permission: ["products", "inv"] }, async (ctx) => {
    const raw = (await params).id;
    const id = /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
    const body = await readJson(req);
    if (!id) return fail("not_found", "This product isn't available.");
    if (!body) return fail("invalid_input", "Nothing to save.");

    const res = await updateProduct(ctx, id, body);
    switch (res.kind) {
      case "ok":
        return ok(res.product);
      case "conflict":
        return fail("conflict", "This product was just changed elsewhere. Here's the latest.", {
          current: res.current,
        });
      case "invalid":
        return fail("invalid_input", res.message);
      default:
        return fail("not_found", "This product isn't available.");
    }
  });
}
