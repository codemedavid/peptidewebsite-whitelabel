import { FEATURES } from "@/lib/features/catalog";
import { fail, ok, readJson, withCustomer } from "@/lib/mobile/http";
import { parsePresenceBeat, readGeo } from "@/lib/presence/live";
import { recordPresence } from "@/lib/presence/live.server";

// POST /api/mobile/v1/presence — the customer app's "live now" heartbeat
// (features/live/usePresenceBeacon). One visitor per app session; the store's
// Live screen shows the customer by name. A plan without Sales Analytics
// answers recorded:false and writes nothing.
export async function POST(req: Request) {
  return withCustomer(req, { route: "presence" }, async (ctx) => {
    const beat = parsePresenceBeat(await readJson(req), { requireVisitorId: false });
    if (!beat) return fail("invalid_input", "That heartbeat wasn't readable.");
    if (!ctx.tenant.has(FEATURES.STORE_SALES_ANALYTICS)) return ok({ recorded: false });

    await recordPresence(ctx.tenantId, {
      visitorId: `a-${ctx.session.id}`,
      surface: "app",
      beat,
      customerId: ctx.customer.id,
      geo: readGeo((name) => req.headers.get(name)),
    });
    return ok({ recorded: true });
  });
}
