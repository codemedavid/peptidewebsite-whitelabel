import { NextResponse } from "next/server";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { evaluateVisitorGate } from "@/lib/auth/gate-enforcement";

/**
 * Visitor-gate heartbeat endpoint. The storefront client (GateHeartbeat) polls
 * this on activity to learn whether its access-code session is still valid —
 * because a hash-routed SPA never re-hits middleware/layout on its own, so a
 * rotated code or a disabled gate wouldn't otherwise reach an idle visitor.
 *
 * Returns an EXPLICIT `{ authenticated: boolean }` JSON body, and nothing else:
 * the client's decision core (interpretHeartbeat) treats anything that isn't this
 * literal — an HTML shell, a 5xx, a network error — as inconclusive and does not
 * boot the visitor. So the contract here is "always answer in JSON, or fail loud
 * with a non-2xx"; never let this route fall through to the SPA HTML shell.
 *
 * The gate decision is the SAME evaluateVisitorGate the layout uses, so the two
 * can't drift. Runs on Node (Prisma + cookie/scrypt-adjacent reads).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tenantId = await getTenantIdOrNull();
    // No tenant resolved → there is no gated store here to protect. Report
    // authenticated so the client never boots to a wall that doesn't exist; a
    // genuinely gated store always resolves a tenant.
    if (!tenantId) return NextResponse.json({ authenticated: true });

    const decision = await evaluateVisitorGate(tenantId);
    // "off" and "unlocked" → still authenticated; only "blocked" boots.
    return NextResponse.json({ authenticated: decision.status !== "blocked" });
  } catch (err) {
    console.error("gate/session heartbeat", (err as Error)?.message);
    // Fail INCONCLUSIVE, never authenticated:false. A transient server error must
    // not log every gated visitor out; the client reads a 500 as inconclusive and
    // retries next tick, and the layout still gates on the next real navigation.
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
