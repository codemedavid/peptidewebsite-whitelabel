import "server-only";
import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantGateState } from "@/lib/tenant/gate-state";
import { isGateUnlocked } from "@/lib/auth/storefront-gate";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";

/**
 * Single source of truth for "what should this visitor see — the store, or the
 * access wall?" Used by BOTH the storefront layout (which renders the wall) and
 * the heartbeat endpoint /api/gate/session (which answers authenticated:false).
 *
 * Keeping the two on one function is the point: if the layout and the heartbeat
 * ever computed the gate differently, one of two failures follows — the endpoint
 * says "authenticated" while the layout would show the wall (a rotated code that
 * never boots an idle SPA visitor), or the reverse (a valid visitor booted on
 * every heartbeat). This function makes them provably agree.
 *
 * Three outcomes, because the layout needs to know not just "blocked or not" but
 * whether the gate is even in force (so it only mounts the heartbeat for a
 * genuinely gated-but-unlocked visitor — no point polling when there's no wall):
 *   - "off":      gate not enforced (demo, entitlement off, disabled, or no code)
 *   - "blocked":  show the wall (carries the heading to render)
 *   - "unlocked": gated, but this visitor holds a valid cookie → heartbeat applies
 */
export type VisitorGateDecision =
  | { status: "off" }
  | { status: "blocked"; heading: string }
  | { status: "unlocked" };

export async function evaluateVisitorGate(tenantId: string): Promise<VisitorGateDecision> {
  // The gate is skipped in demo mode and when the platform entitlement is off
  // (operator-grantable, default OFF — revoking it reopens a gated store).
  if (isDemoMode()) return { status: "off" };
  if (!(await hasFeature(tenantId, FEATURES.STORE_ACCESS_CODE))) return { status: "off" };

  // Read FRESH (getTenantGateState is uncached on purpose — it's a security
  // boundary, see that module). A gate with no code set can't be enforced.
  const gate = await getTenantGateState(tenantId);
  if (!gate.enabled || !gate.hasCode) return { status: "off" };

  // A signed-in store admin/staff is NEVER walled. The visitor gate exists to
  // hide the store from shoppers — not to make the operator type the visitor
  // code to reach #admin, which is a client-only hash the server can't see. The
  // sf_admin_session cookie IS sent to the server and is tenant-scoped
  // (requireStorefrontAdmin rejects a cookie issued for another store), so
  // treating a valid admin session as unlocked can't leak store A to store B.
  // The heartbeat shares this decision, so an admin is never booted mid-session.
  if (await requireStorefrontAdmin()) return { status: "unlocked" };

  const unlocked = await isGateUnlocked({ id: tenantId, accessCodeVersion: gate.codeVersion });
  return unlocked ? { status: "unlocked" } : { status: "blocked", heading: gate.heading };
}
