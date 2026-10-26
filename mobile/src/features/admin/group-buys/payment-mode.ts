// Group-buy payment mode — when a customer pays for a group-buy order.
//
//   pay_first  "Pay before checkout": the checkout collects a payment method +
//              proof, like any other order (the historical default).
//   pay_later  "Pay after close": a round order is placed unpaid and settled
//              after the round closes (the invoice in gb-invoice.ts, and the
//              Payment time stage that follows Bunuan/Ligwak).
//
// ONE per-store setting, read by the website checkout, the PepWorld app
// checkout and the server's placement stamp alike. Stored at
// branding.config.groupBuyPayment.mode. Stores that predate it have no mode
// and fall back to the old invoice switch (groupBuyInvoice.enabled), so they
// keep behaving exactly as before.
//
// The mode and the invoice switch are kept in step by every writer
// (withGbPaymentMode / syncGbPaymentModeToInvoice): pay-after-close IS the
// invoice machinery — its flat shipping fee, its add-on rule and its chat
// invoice — so the two can never disagree about whether an order is paid now.
//
// PURE and ZERO IMPORTS on purpose: the Expo app keeps a byte-identical copy at
// mobile/src/features/admin/group-buys/payment-mode.ts, and
// npm run test:gb-payment-mode fails when the two drift.

export type GbPaymentMode = "pay_first" | "pay_later";

export const GB_PAYMENT_MODES: readonly GbPaymentMode[] = ["pay_first", "pay_later"];

export const GB_PAYMENT_MODE_COPY: Readonly<Record<GbPaymentMode, { label: string; hint: string }>> = {
  pay_first: {
    label: "Pay before checkout",
    hint: "Customers pay and upload their proof of payment when they place a group-buy order.",
  },
  pay_later: {
    label: "Pay after close",
    hint: "Customers place group-buy orders without paying. Once the round closes, each one gets their total and the ways to pay.",
  },
};

/** What the customer reads at checkout in place of the payment step. */
export const PAY_LATER_CHECKOUT_NOTE = "You'll pay after the group buy closes.";

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** Untrusted value → a mode, or null when it isn't one (unset / garbage). */
export function normalizeGbPaymentMode(raw: unknown): GbPaymentMode | null {
  return raw === "pay_first" || raw === "pay_later" ? raw : null;
}

/**
 * The store's mode, from its branding config (or a Brand carrying the same two
 * fields). An explicit groupBuyPayment.mode wins; otherwise the old invoice
 * switch decides, so a store that never saw this setting is unchanged.
 */
export function gbPaymentModeFor(brand: unknown): GbPaymentMode {
  if (!isRow(brand)) return "pay_first";
  const payment = isRow(brand.groupBuyPayment) ? brand.groupBuyPayment : null;
  const explicit = normalizeGbPaymentMode(payment?.mode);
  if (explicit) return explicit;
  const invoice = isRow(brand.groupBuyInvoice) ? brand.groupBuyInvoice : null;
  return invoice?.enabled === true ? "pay_later" : "pay_first";
}

/**
 * The config with `mode` saved — a NEW object, the input is not touched. The
 * invoice switch follows the mode, and turning it on stamps the server's
 * enabledAt (the same rule as mergeGroupBuyInvoiceSave) so switching to
 * pay-after-close never invoices rounds that closed before the switch.
 */
export function withGbPaymentMode(config: unknown, mode: GbPaymentMode, now: Date = new Date()): Row {
  const base: Row = isRow(config) ? config : {};
  const prev: Row = isRow(base.groupBuyInvoice) ? base.groupBuyInvoice : {};
  const enabled = mode === "pay_later";
  const wasOn = prev.enabled === true && typeof prev.enabledAt === "string" && prev.enabledAt !== "";
  const enabledAt = enabled && !wasOn ? now.toISOString() : (prev.enabledAt ?? null);
  return {
    ...base,
    groupBuyPayment: { ...(isRow(base.groupBuyPayment) ? base.groupBuyPayment : {}), mode },
    groupBuyInvoice: { ...prev, enabled, enabledAt },
  };
}

/**
 * After an invoice-settings save: the mode follows the switch, so an older app
 * build's "Pay after the group buy closes" toggle still changes how customers
 * pay. A NEW object; the input is not touched.
 */
export function syncGbPaymentModeToInvoice(config: unknown): Row {
  const base: Row = isRow(config) ? config : {};
  const invoice = isRow(base.groupBuyInvoice) ? base.groupBuyInvoice : {};
  const mode: GbPaymentMode = invoice.enabled === true ? "pay_later" : "pay_first";
  return { ...base, groupBuyPayment: { ...(isRow(base.groupBuyPayment) ? base.groupBuyPayment : {}), mode } };
}

/**
 * Will this cart be placed as a pay-after-close round order? Mirrors the
 * server's attribution (groupBuyForOrder): with a live round, a round that
 * covers the whole catalog takes every cart, otherwise a cart joins it when
 * any line is one of the round's products. The server decides for real at
 * placement; this only picks which checkout step the customer sees.
 */
export function isPayLaterCart(
  mode: GbPaymentMode | null | undefined,
  round: { coversAll: boolean; productIds: readonly string[] } | null | undefined,
  productIds: readonly string[],
): boolean {
  if (mode !== "pay_later" || !round || productIds.length === 0) return false;
  return round.coversAll || productIds.some((id) => round.productIds.includes(id));
}
