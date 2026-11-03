// Is this visitor walled out of the storefront right now?
//
// WHY this exists next to the layout's own gate checks: in the App Router a
// page renders ALONGSIDE its layout, so a layout that returns the gate instead
// of `children` still lets the page run and serialize its props. The storefront
// page's props are the whole catalog (prices included), so "members only" and
// "access code" walls drew correctly while View Source showed everything behind
// them. The page asks this and renders nothing for a blocked visitor; the
// layout keeps drawing the wall. Same two decisions, same order as the layout.

import { evaluateVisitorGate } from "@/lib/auth/gate-enforcement";
import { evaluateAccountGate } from "@/lib/auth/account-gate-enforcement";
import { getTenantContext } from "@/lib/tenant/context";

export async function isStorefrontBlocked(tenantId: string): Promise<boolean> {
  if ((await evaluateVisitorGate(tenantId)).status === "blocked") return true;
  const { branding } = await getTenantContext(tenantId);
  const config = (branding?.config ?? {}) as { accountGate?: unknown };
  return (await evaluateAccountGate(tenantId, config.accountGate)) === "blocked";
}
