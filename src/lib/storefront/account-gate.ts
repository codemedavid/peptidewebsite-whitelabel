/**
 * Members-only store: a visitor must sign in to (or create) a customer account
 * before the store renders. The owner switches it on in store admin →
 * Customers; it lives in `branding.config.accountGate`.
 *
 * It rides the customer-accounts entitlement (FEATURES.STORE_CUSTOMER_ACCOUNTS)
 * rather than a grant of its own: the wall is only a sign-in form, so with
 * accounts revoked it would lock every shopper out with no way in. Revoking
 * accounts therefore reopens the store, the same way revoking the access-code
 * feature reopens a code-gated one.
 *
 * Pure on purpose — the layout (server) and the admin panel (client) both read
 * it, and scripts/test-account-gate.ts pins the decision.
 */

export type AccountGateConfig = { enabled: boolean };

export const ACCOUNT_GATE_OFF: AccountGateConfig = { enabled: false };

/** Fails closed to OFF: only an explicit `enabled: true` turns the wall on. */
export function normalizeAccountGate(raw: unknown): AccountGateConfig {
  if (!raw || typeof raw !== "object") return ACCOUNT_GATE_OFF;
  return { enabled: (raw as { enabled?: unknown }).enabled === true };
}

export type AccountGateInput = {
  /** Demo mode renders fixtures, which have no accounts to sign in to. */
  demo: boolean;
  /** The tenant holds the customer-accounts entitlement. */
  accountsOn: boolean;
  config: AccountGateConfig;
  /** A signed-in store admin/staff for THIS tenant — never walled. */
  isAdmin: boolean;
  /** A signed-in, active customer of THIS tenant. */
  hasCustomer: boolean;
};

/** "off" = gate not in force; "open" = in force, visitor may pass; "blocked" = show the wall. */
export type AccountGateDecision = "off" | "open" | "blocked";

export function decideAccountGate(input: AccountGateInput): AccountGateDecision {
  if (input.demo || !input.accountsOn || !input.config.enabled) return "off";
  if (input.isAdmin || input.hasCustomer) return "open";
  return "blocked";
}
