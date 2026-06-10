// The per-tenant admin (service) fee charged on top of the order total at
// checkout. Toggled and configured by the SUPER ADMIN only (settings →
// "Admin fee") and persisted in the shared branding.config blob as `adminFee`
// — the store admin's config saves never touch the key (read-modify-write).
// Shared between the platform settings editor, its save action, and the
// checkout/order pipeline so every surface normalizes the value identically.

export const ADMIN_FEE_LABEL_MAX = 60;
export const ADMIN_FEE_LABEL_DEFAULT = "Admin fee";
/** Hard ceiling on the configurable amount — guards against typos like 1e12. */
export const ADMIN_FEE_AMOUNT_MAX = 1_000_000;

/** What the super admin configures (branding.config.adminFee). */
export type AdminFeeConfig = {
  enabled: boolean;
  /** What the fee is for — the line label customers see at checkout. */
  label: string;
  /** Flat amount in the store's currency, added on top of the order total. */
  amount: number;
};

/** What an order actually charged (Order.adminFee) — a snapshot at placement. */
export type OrderAdminFee = { label: string; amount: number };

/** Coerce an untrusted/legacy config value into a well-formed AdminFeeConfig. */
export function normalizeAdminFee(input: unknown): AdminFeeConfig {
  const x = (input ?? {}) as Record<string, unknown>;
  const label =
    typeof x.label === "string" ? x.label.trim().slice(0, ADMIN_FEE_LABEL_MAX) : "";
  const raw = Number(x.amount);
  const amount = Number.isFinite(raw)
    ? Math.min(ADMIN_FEE_AMOUNT_MAX, Math.max(0, Math.round(raw * 100) / 100))
    : 0;
  return { enabled: x.enabled === true, label, amount };
}

/**
 * The fee a checkout should charge right now, or null when none applies
 * (toggle off, missing, or a non-positive amount). A blank label falls back to
 * the default so the checkout/admin rows never render an empty line name.
 */
export function activeAdminFee(input: unknown): OrderAdminFee | null {
  const fee = normalizeAdminFee(input);
  if (!fee.enabled || fee.amount <= 0) return null;
  return { label: fee.label || ADMIN_FEE_LABEL_DEFAULT, amount: fee.amount };
}
