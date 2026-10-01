import "server-only";

import { normalizeCheckoutRules, customerNoteLabel } from "@/lib/storefront/checkout-rules";
import { SEED_COURIERS } from "@/storefront/data";
import type { ShopCheckoutConfig, ShopCourier, ShopPaymentMethod, ShopShippingLocation } from "./shop-contract";

/**
 * The checkout half of the shop catalog, read from the store's saved
 * branding.config — the same arrays the website checkout offers and
 * placeStorefrontOrderAction re-stamps from (stampShipping, stampPaymentFee).
 *
 * Deliberately config-only: the website falls back to demo SEED methods /
 * couriers when a store has saved none, but those are placeholders (one carries
 * a real person's account) and the server never charges from them, so the app
 * shows "nothing configured" instead. Every field is re-typed here because
 * config is untrusted JSON.
 */

type Row = Record<string, unknown>;

const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? v.filter((x): x is Row => !!x && typeof x === "object") : [];
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const money = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** Active methods, in the owner's order (activePaymentMethods). */
export function readPaymentMethods(config: Row, qrphEntitled: boolean): ShopPaymentMethod[] {
  return rows(config.paymentMethods)
    .filter((m) => m.active === true && text(m.id) && text(m.name))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((m) => ({
      id: text(m.id),
      name: text(m.name),
      account: text(m.account),
      number: text(m.number),
      qrImage: text(m.qrImage),
      qrph: qrphEntitled && m.qrph === true,
    }));
}

/** Active locations whose courier is active. */
function readLocations(config: Row, activeCourierIds: Set<string>): ShopShippingLocation[] {
  return rows(config.shippingLocations)
    .filter((l) => l.active !== false && text(l.id) && activeCourierIds.has(text(l.courierId)))
    .map((l) => ({ id: text(l.id), courierId: text(l.courierId), name: text(l.name), fee: money(l.price) }));
}

/**
 * Couriers the checkout can actually offer — CartCheckout's shipCouriers: active
 * AND either cash-on-delivery (no location) or with an active location.
 */
export function readShipping(config: Row): { couriers: ShopCourier[]; shippingLocations: ShopShippingLocation[] } {
  // A store that never saved its couriers still has the website's defaults
  // (store.tsx: `couriers ?? SEED_COURIERS`) — saved locations point at them
  // (vrjonina: c2 = J&T). Unlike seed payment methods these are names only.
  const saved = Array.isArray(config.couriers) ? config.couriers : SEED_COURIERS;
  const active = rows(saved).filter((c) => c.active !== false && text(c.id) && text(c.name));
  const locations = readLocations(config, new Set(active.map((c) => text(c.id))));
  const couriers = active
    .filter((c) => c.noLocation === true || locations.some((l) => l.courierId === text(c.id)))
    .map((c) => ({ id: text(c.id), name: text(c.name), needsLocation: c.noLocation !== true }));
  const offered = new Set(couriers.map((c) => c.id));
  return { couriers, shippingLocations: locations.filter((l) => offered.has(l.courierId)) };
}

export function readCheckoutConfig(config: Row, qrphEntitled: boolean): ShopCheckoutConfig {
  const rules = normalizeCheckoutRules(config.checkoutRules);
  return {
    paymentMethods: readPaymentMethods(config, qrphEntitled),
    requireProofOfPayment: config.requireProofOfPayment !== false,
    ...readShipping(config),
    note: text(config.checkoutNote),
    title: text(config.checkoutTitle),
    customerNoteEnabled: rules.customerNoteEnabled,
    customerNoteLabel: customerNoteLabel(rules),
  };
}
