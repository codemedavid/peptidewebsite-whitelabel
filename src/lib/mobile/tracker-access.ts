// Is the Peptide Tracker open for this store's app customers? (docs/mobile-admin/TRACKER.md)
//
// One predicate for /me (which shows the Tracker tab) and every /tracker route.
// The tracker rides on the customer app (same rule as isCustomerAppOpen), so a
// grant on a store whose app is closed is inert. Guide import also needs the
// store's Protocols — there are no guides to copy otherwise.

import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import type { TrackerMe } from "./contract";

export function trackerAccess(has: (key: FeatureKey) => boolean): TrackerMe {
  const appOpen = has(FEATURES.MOBILE_SHOP) || has(FEATURES.MOBILE_COMMUNITY);
  const enabled = appOpen && has(FEATURES.MOBILE_TRACKER);
  const guideImport =
    enabled && has(FEATURES.MOBILE_TRACKER_GUIDE_IMPORT) && has(FEATURES.STORE_PROTOCOLS);
  return { enabled, guideImport };
}
