import { fail, ok, readJson, withMobile } from "@/lib/mobile/http";
import { getOrder, updateOrder } from "@/lib/mobile/orders";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = "This order isn't available. It may have been deleted.";

function cleanId(raw: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

// GET /api/mobile/v1/orders/:id — also the target of a notification tap, so it
// is authorised here like any other read (the push payload grants nothing).
export async function GET(req: Request, { params }: Params) {
  return withMobile(req, { route: "orders/:id", permission: "orders" }, async (ctx) => {
    const id = cleanId((await params).id);
    const order = id ? await getOrder(ctx, id) : null;
    return order ? ok(order) : fail("not_found", NOT_FOUND);
  });
}

// PATCH /api/mobile/v1/orders/:id  { status?, courier?, trackingNumber?, shippingNote?, expectedUpdatedAt }
export async function PATCH(req: Request, { params }: Params) {
  return withMobile(req, { route: "orders/:id:patch", permission: "orders" }, async (ctx) => {
    const id = cleanId((await params).id);
    const body = await readJson(req);
    if (!id) return fail("not_found", NOT_FOUND);
    if (!body) return fail("invalid_input", "Nothing to save.");

    const res = await updateOrder(ctx, id, body);
    switch (res.kind) {
      case "ok":
        return ok(res.order);
      case "conflict":
        return fail("conflict", "This order was just updated by someone else. Review the latest version.", {
          current: res.current,
        });
      case "invalid":
        return fail("invalid_input", res.message);
      default:
        return fail("not_found", NOT_FOUND);
    }
  });
}
