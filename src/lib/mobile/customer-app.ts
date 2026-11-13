// Is this store open to SHOPPERS in the Pepweb app (sign in, browse, order)?
//
// App shopping (MOBILE_SHOP) is the switch, operator-granted (default OFF). The app
// community (MOBILE_COMMUNITY) also opens it, so a store that already runs the
// community never loses its shoppers. Chats, pushes and the order bot stay on
// MOBILE_COMMUNITY alone. The one predicate for login, sign-up, the shop API,
// the store link preview and the /app page.

import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";

export function isCustomerAppOpen(entitlements: ReadonlySet<FeatureKey>): boolean {
  return entitlements.has(FEATURES.MOBILE_SHOP) || entitlements.has(FEATURES.MOBILE_COMMUNITY);
}

export async function customerAppOpen(tenantId: string): Promise<boolean> {
  return isCustomerAppOpen(await getEntitlements(tenantId));
}
