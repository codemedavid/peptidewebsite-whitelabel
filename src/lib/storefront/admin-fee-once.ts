// "Admin fee once per group buy" (branding.config.adminFee.oncePerGroupBuy).
//
// A group-buy member pays the store's admin fee on their FIRST order in a round;
// every add-on order they place in the same round carries no fee. The owner
// asked for exactly this (mnm-pepsabuy, 2026-10-28): members top up their GB
// order, and the fee must not be charged twice.
//
// Who counts as "the same member": a signed-in account id when there is one,
// else the email OR the phone typed at checkout. Stores without customer
// accounts have nothing stronger. Someone could type another member's phone to
// skip the fee, but the order is then filed under that member's contact on the
// owner's round report, so the owner sees it before confirming payment.
//
// Pure, zero imports: the server (orders.ts) decides with it, and its test runs
// with nothing but tsx.

/** The buyer placing the order. */
export type FeeBuyer = {
  accountId?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** An earlier order in the same round, as stored. */
export type PriorRoundOrder = {
  status: string;
  customerAccountId?: string | null;
  customer: unknown;
  adminFee: unknown;
};

/** Shortest digit run treated as a real phone number. */
const MIN_PHONE_DIGITS = 7;
/** PH numbers are written 09xx…, +639xx…, 639xx…: the last 10 digits agree. */
const PHONE_MATCH_DIGITS = 10;

/** A comparable email, or null when it isn't one. Shared with gb-member-orders.ts
 *  so "the same member" means one thing for the fee and for the member view. */
export function emailKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.includes("@") ? v : null;
}

/** A comparable phone number (its last 10 digits), or null when too short. */
export function phoneKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits.slice(-PHONE_MATCH_DIGITS) : null;
}

function feeCharged(adminFee: unknown): boolean {
  if (!adminFee || typeof adminFee !== "object") return false;
  const amount = Number((adminFee as Record<string, unknown>).amount);
  return Number.isFinite(amount) && amount > 0;
}

function sameBuyer(order: PriorRoundOrder, buyer: FeeBuyer): boolean {
  if (buyer.accountId && order.customerAccountId === buyer.accountId) return true;
  const c = (order.customer ?? {}) as Record<string, unknown>;
  const email = emailKey(buyer.email);
  if (email && emailKey(c.email) === email) return true;
  const phone = phoneKey(buyer.phone);
  return phone !== null && phoneKey(c.phone) === phone;
}

/**
 * Has this buyer already paid the admin fee in the round? Only an order that
 * actually carried a fee counts, so an order placed before the fee existed, or
 * one that was cancelled, never waives the next one.
 */
export function hasPaidAdminFeeInRound(prior: readonly PriorRoundOrder[], buyer: FeeBuyer): boolean {
  return prior.some(
    (o) => o.status !== "cancelled" && feeCharged(o.adminFee) && sameBuyer(o, buyer),
  );
}
