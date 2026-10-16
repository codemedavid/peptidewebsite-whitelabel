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

/** The fields to render (and validate) for this store's checkout. */
export function checkoutFields(brand: Pick<Brand, "checkoutHideEmail">): CheckoutField[] {
  return brand.checkoutHideEmail === true
    ? ALL_FIELDS.filter((f) => f.key !== "email")
    : [...ALL_FIELDS];
}
