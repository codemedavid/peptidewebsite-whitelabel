import "server-only";
import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { getSignedInCustomer } from "@/lib/auth/customer-session";
import {
  decideAccountGate,
  normalizeAccountGate,
  type AccountGateDecision,
} from "@/lib/storefront/account-gate";

/**
 * Should this request see the members-only sign-in wall? Read by the storefront
 * layout right after the visitor access-code gate. The decision itself is the
 * pure decideAccountGate; this only gathers its inputs, cheapest first, so a
 * store without the wall pays for one config read and nothing else.
 *
 * The customer session is re-read from the row (getSignedInCustomer), so a
 * disabled account or a reset password walls that shopper on their next page.
 */
export async function evaluateAccountGate(tenantId: string, rawConfig: unknown): Promise<AccountGateDecision> {
  const config = normalizeAccountGate(rawConfig);
  if (!config.enabled || isDemoMode()) return "off";
  const accountsOn = await hasFeature(tenantId, FEATURES.STORE_CUSTOMER_ACCOUNTS);
  if (!accountsOn) return "off";

  const isAdmin = (await requireStorefrontAdmin()) !== null;
  const hasCustomer = isAdmin ? false : (await getSignedInCustomer(tenantId)) !== null;
  return decideAccountGate({ demo: false, accountsOn, config, isAdmin, hasCustomer });
}
