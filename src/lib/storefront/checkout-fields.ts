// The customer-detail fields the checkout asks for, per store.
//
// WHY a function rather than a constant: some stores never email their buyers
// (thepeppylab confirms every order in chat), and a required Email box is one
// more field standing between a customer and the order. `checkoutHideEmail`
// drops it. Email was never required server-side, so the order saves the same;
// buildOrderMessage leaves the blank "Email:" line out.

import type { Brand } from "@/storefront/types";
import type { CheckoutCustomer } from "@/storefront/checkout";

export type CheckoutField = {
  key: keyof CheckoutCustomer;
  label: string;
  required: boolean;
  type?: string;
};

const ALL_FIELDS: readonly CheckoutField[] = [
  { key: "name", label: "Full name", required: true },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone", required: true, type: "tel" },
  { key: "address", label: "Address", required: true },
  { key: "barangay", label: "Barangay", required: true },
  { key: "city", label: "City / Municipality", required: true },
  { key: "province", label: "Province / State", required: true },
  { key: "postal", label: "Postal code", required: false },
];

/** A dual-currency store's International cart ships abroad: a barangay means
 *  nothing there, and the country is the one line the courier can't guess. */
const INTL_FIELDS: readonly CheckoutField[] = [
  { key: "name", label: "Full name", required: true },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone (with country code)", required: true, type: "tel" },
  { key: "address", label: "Street address", required: true },
  { key: "city", label: "City", required: true },
  { key: "province", label: "State / Province / Region", required: false },
  { key: "postal", label: "Postal / ZIP code", required: true },
  { key: "country", label: "Country", required: true },
];

/** Asked right after Phone on stores that message buyers on WhatsApp
 *  (`checkoutWhatsapp`, mnm-pepsabuy) — the name + number land in the order and
 *  the group-buy customer report. The NAME is how the owner finds the buyer's
 *  chat: a number alone shows up as whatever the buyer called themselves. */
const WHATSAPP_FIELDS: readonly CheckoutField[] = [
  { key: "whatsappName", label: "WhatsApp name", required: true },
  { key: "whatsapp", label: "WhatsApp number", required: true, type: "tel" },
];

/** The fields to render (and validate) for this store's checkout. `market`
 *  is the cart being checked out on a dual-currency store. */
export function checkoutFields(
  brand: Pick<Brand, "checkoutHideEmail" | "checkoutWhatsapp">,
  market?: "local" | "international" | null,
): CheckoutField[] {
  const base = market === "international" ? INTL_FIELDS : ALL_FIELDS;
  const shown = brand.checkoutHideEmail === true ? base.filter((f) => f.key !== "email") : base;
  if (brand.checkoutWhatsapp !== true) return [...shown];
  return shown.flatMap((f) => (f.key === "phone" ? [f, ...WHATSAPP_FIELDS] : [f]));
}
