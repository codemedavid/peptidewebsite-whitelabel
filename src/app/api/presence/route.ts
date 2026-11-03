import { isDemoMode } from "@/lib/demo/fixtures";
import { FEATURES } from "@/lib/features/catalog";
import { hasFeature } from "@/lib/features/entitlements";
import { parsePresenceBeat, readGeo } from "@/lib/presence/live";
import { recordPresence } from "@/lib/presence/live.server";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { getTenantIdOrNull } from "@/lib/tenant/headers";

/**
 * Website "live now" heartbeat (storefront/components/PresenceBeacon). Posted
 * every 30s while a store tab is visible, and once with `leave` when it hides —
 * that one arrives via sendBeacon as text/plain, so the body is read as text.
 *
 * Total and quiet: no tenant, demo mode, or a plan without Sales Analytics all
 * answer 204 without writing, so a store that cannot see the Live screen never
 * pays for its heartbeats. Answers carry no body — the beacon ignores them.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A visible tab beats twice a minute; the slack covers stage changes and
// several tabs behind one shared IP (an office, mobile carrier NAT).
const BEATS_PER_MINUTE_PER_IP = 40;
const MINUTE_MS = 60_000;
const MAX_BODY = 2_000;

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantIdOrNull();
    if (!tenantId || isDemoMode()) return empty(204);

    const limit = rateLimit(`presence:${await clientIp()}`, BEATS_PER_MINUTE_PER_IP, MINUTE_MS);
    if (!limit.ok) return empty(429);

    const text = await req.text();
    if (text.length > MAX_BODY) return empty(413);
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return empty(400);
    }
    const beat = parsePresenceBeat(body, { requireVisitorId: true });
    if (!beat?.visitorId) return empty(400);

    if (!(await hasFeature(tenantId, FEATURES.STORE_SALES_ANALYTICS))) return empty(204);

    await recordPresence(tenantId, {
      visitorId: `w-${beat.visitorId}`,
      surface: "web",
      beat,
      customerId: null,
      geo: readGeo((name) => req.headers.get(name)),
    });
    return empty(204);
  } catch (err) {
    console.error("presence heartbeat", (err as Error)?.name);
    return empty(500);
  }
}
