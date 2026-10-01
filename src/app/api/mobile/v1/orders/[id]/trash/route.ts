import { fail, ok, withMobile } from "@/lib/mobile/http";
import { restoreOrder, trashOrder } from "@/lib/mobile/orders";

type Params = { params: Promise<{ id: string }> };

function cleanId(raw: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

// POST /api/mobile/v1/orders/:id/trash — move to the Trash (reversible, no stock move).
export async function POST(req: Request, { params }: Params) {
  return withMobile(req, { route: "orders/:id/trash", permission: "orders" }, async (ctx) => {
    const id = cleanId((await params).id);
    const done = id ? await trashOrder(ctx, id) : false;
    return done ? ok({ trashed: true }) : fail("not_found", "This order is already gone.");
  });
}

// DELETE /api/mobile/v1/orders/:id/trash — take it back out (the Undo).
export async function DELETE(req: Request, { params }: Params) {
  return withMobile(req, { route: "orders/:id/restore", permission: "orders" }, async (ctx) => {
    const id = cleanId((await params).id);
    const done = id ? await restoreOrder(ctx, id) : false;
    return done ? ok({ restored: true }) : fail("not_found", "This order isn't in the trash.");
  });
}
