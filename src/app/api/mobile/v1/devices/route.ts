import { fail, ok, readJson, withSession } from "@/lib/mobile/http";
import { registerDevice, unregisterDevice } from "@/lib/mobile/push";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";

// POST /api/mobile/v1/devices  { expoPushToken, platform, newOrders, messages? }
// Binds this phone's push token to the CURRENT session (moving it away from any
// other store or account it was registered under). The store team needs the
// Orders or Community grant; customers register for community messages only —
// their `newOrders` is always stored false.
export async function POST(req: Request) {
  return withSession(req, { route: "devices" }, async (principal) => {
    let canOrders = false;
    if (principal.kind === "admin") {
      const actor = principal.ctx.actor;
      canOrders = isModuleAllowed(actor, "orders");
      if (!canOrders && !isModuleAllowed(actor, "community")) {
        return fail("forbidden", "Your account doesn't have access to this. Ask the store owner.");
      }
    }
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "This device can't receive notifications.");
    const res = await registerDevice(principal.ctx.session, { ...body, newOrders: canOrders && body.newOrders !== false });
    return res.ok ? ok({ newOrders: res.newOrders }) : fail("invalid_input", res.message);
  });
}

// DELETE /api/mobile/v1/devices  { expoPushToken } — stop notifications on this phone.
export async function DELETE(req: Request) {
  return withSession(req, { route: "devices:delete" }, async (principal) => {
    const body = await readJson(req);
    await unregisterDevice(principal.ctx.session.id, body?.expoPushToken);
    return ok({ newOrders: false });
  });
}
