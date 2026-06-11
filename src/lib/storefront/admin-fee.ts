// The per-tenant admin (service) fee charged on top of the order total at
// checkout. Configured from the platform settings ("Admin fee") and from the
// store admin's Group Buy Rules view; both edit the SAME key — persisted in the
// shared branding.config blob as `adminFee` (read-modify-write) — so a store
// can never be charged two competing fees. The fee is either a flat amount or
// a percentage of the items subtotal; either way the order stores a resolved
// {label, amount} snapshot at placement, so every downstream surface (order
// detail, analytics, chat summary, tracking) keeps reading a plain amount.
// Shared between the editors, their save actions, and the checkout/order
// pipeline so every surface normalizes the value identically.

export const ADMIN_FEE_LABEL_MAX = 60;
export const ADMIN_FEE_LABEL_DEFAULT = "Admin fee";
/** Hard ceiling on the configurable amount — guards against typos like 1e12. */
export const ADMIN_FEE_AMOUNT_MAX = 1_000_000;
export const ADMIN_FEE_PERCENT_MAX = 100;

export type AdminFeeMode = "fixed" | "percentage";

/** What the admins configure (branding.config.adminFee). */
export type AdminFeeConfig = {
  enabled: boolean;
  /** What the fee is for — the line label customers see at checkout. */
  label: string;
  /** Flat amount vs percentage of the items subtotal. Legacy configs (no mode)
   *  are fixed — the only behavior that existed before modes. */
  mode: AdminFeeMode;
  /** Flat amount in the store's currency (mode "fixed"). */
  amount: number;
  /** Percent of the items subtotal, 0–100 (mode "percentage"). */
  percent: number;
};

/** What an order actually charged (Order.adminFee) — a snapshot at placement. */
export type OrderAdminFee = { label: string; amount: number };

/** Coerce an untrusted/legacy config value into a well-formed AdminFeeConfig. */
export function normalizeAdminFee(input: unknown): AdminFeeConfig {
  const x = (input ?? {}) as Record<string, unknown>;
  const label =
    typeof x.label === "string" ? x.label.trim().slice(0, ADMIN_FEE_LABEL_MAX) : "";
  const rawAmount = Number(x.amount);
  const amount = Number.isFinite(rawAmount)
    ? Math.min(ADMIN_FEE_AMOUNT_MAX, Math.max(0, Math.round(rawAmount * 100) / 100))
    : 0;
  const rawPercent = Number(x.percent);
  const percent = Number.isFinite(rawPercent)
    ? Math.min(ADMIN_FEE_PERCENT_MAX, Math.max(0, Math.round(rawPercent * 100) / 100))
    : 0;
  return {
    enabled: x.enabled === true,
    label,
    mode: x.mode === "percentage" ? "percentage" : "fixed",
    amount,
    percent,
  };
}

/**
 * The fee a checkout should charge on the given items subtotal, or null when
 * none applies (toggle off, missing, or a fee that resolves to zero). A
 * percentage fee is resolved against the subtotal here — callers snapshot the
 * returned amount, never the percent. A blank label falls back to the default
 * so the checkout/admin rows never render an empty line name.
 */
export function activeAdminFee(input: unknown, subtotal: number): OrderAdminFee | null {
  const fee = normalizeAdminFee(input);
  if (!fee.enabled) return null;
  const amount =
    fee.mode === "percentage"
      ? Math.round(Math.max(0, subtotal) * fee.percent) / 100
      : fee.amount;
  if (amount <= 0) return null;
  return { label: fee.label || ADMIN_FEE_LABEL_DEFAULT, amount };
}
