// Self-contained test gate for the Order Confirmed review page's view-model
// (src/lib/storefront/order-confirmation.ts). Before a customer is handed off to
// WhatsApp / Viber / Messenger they now land on a review screen; this module
// builds exactly what that screen shows. Pure — no DB, no React.
//
//   npm run test:order-confirmation
//
// The rule the whole file is really testing: the review screen reads the STORED
// order, never the local cart. The server re-derives prices, shipping, the admin
// fee and any discount at placement, so anything rebuilt from client state could
// show the customer a total the store will not honor.
//
// Covers: reference + customer + shipping blocks, the item table (variant, unit
// and line price, purity joined from the catalog), totals arithmetic including
// discount/shipping/fee and the never-negative floor, and graceful handling of
// the sparse orders real stores produce (no courier, no fee, deleted product).

import {
  buildOrderConfirmation,
  type ConfirmationOrder,
} from "../src/lib/storefront/order-confirmation";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// A stored order as the server hands it back: server-stamped number, fee,
// shipping and discount.
const order: ConfirmationOrder = {
  id: "ord_internal_1",
  orderNumber: "1042",
  date: "2026-08-05T10:00:00.000Z",
  paymentMethod: "GCash",
  courier: "Lalamove",
  customer: { name: "Ada Reyes", email: "ada@example.com", phone: "09171234567" },
  shipping: {
    address: "12 Mabini St",
    barangay: "Poblacion",
    city: "Davao City",
    province: "Davao del Sur",
    postal: "8000",
    fee: 150,
  },
  items: [
    { productId: "p1", name: "Semaglutide — 5mg", qty: 2, price: 3000, variation: "5mg" },
    { productId: "p2", name: "Bacteriostatic Water", qty: 1, price: 250 },
  ],
  adminFee: { label: "Service fee", amount: 100 },
  discount: { code: "WELCOME10", label: "10% off", amount: 500 },
};

// Purity lives on the CATALOG product, not the stored order line, so the review
// screen has to join it back by productId.
const catalog = [
  { id: "p1", name: "Semaglutide", purity: "99%" },
  { id: "p2", name: "Bacteriostatic Water", purity: "" },
];

const view = buildOrderConfirmation(order, catalog, { currency: "₱" });

// ── Order reference ──────────────────────────────────────────────────────────
console.log("order reference");

eq("shows the server-assigned order number", view.reference, "1042");
eq(
  "falls back to the internal id when a number was never assigned",
  buildOrderConfirmation({ ...order, orderNumber: "" }, catalog, { currency: "₱" }).reference,
  "ord_internal_1",
);

// ── Customer ─────────────────────────────────────────────────────────────────
console.log("customer");

eq("name", view.customer.name, "Ada Reyes");
eq("email", view.customer.email, "ada@example.com");
eq("phone", view.customer.phone, "09171234567");
eq(
  "a missing field renders as a dash, never as 'undefined'",
  buildOrderConfirmation(
    { ...order, customer: { name: "Ada Reyes", email: "", phone: "" } },
    catalog,
    { currency: "₱" },
  ).customer.email,
  "—",
);

// ── Shipping ─────────────────────────────────────────────────────────────────
console.log("shipping");

eq(
  "the address is one readable line, in postal order",
  view.shipping.address,
  "12 Mabini St, Poblacion, Davao City, Davao del Sur, 8000",
);
eq("the chosen courier is shown", view.shipping.courier, "Lalamove");
eq(
  "blank address parts are skipped, not left as empty commas",
  buildOrderConfirmation(
    {
      ...order,
      shipping: { address: "12 Mabini St", barangay: "", city: "Davao City", province: "", postal: "", fee: 0 },
    },
    catalog,
    { currency: "₱" },
  ).shipping.address,
  "12 Mabini St, Davao City",
);
eq(
  "a store with no courier set shows a dash rather than a blank row",
  buildOrderConfirmation({ ...order, courier: "" }, catalog, { currency: "₱" }).shipping.courier,
  "—",
);

// ── Item table ───────────────────────────────────────────────────────────────
console.log("items");

eq("every ordered line is listed", view.items.length, 2);
eq("product name", view.items[0].name, "Semaglutide — 5mg");
eq("variant", view.items[0].variation, "5mg");
eq("quantity", view.items[0].qty, 2);
eq("unit price", view.items[0].unitPrice, 3000);
eq("line total is unit × qty", view.items[0].lineTotal, 6000);
eq("purity is joined from the catalog", view.items[0].purity, "99%");
eq("a line with no variant carries none", view.items[1].variation, "");
eq(
  "a product with no purity recorded shows nothing (not '—' in a data column)",
  view.items[1].purity,
  "",
);
eq(
  "a line whose product was since deleted still lists, just without purity",
  buildOrderConfirmation(order, [], { currency: "₱" }).items[0].purity,
  "",
);

// ── Totals ───────────────────────────────────────────────────────────────────
console.log("totals");

// 3000×2 + 250×1 = 6250
eq("subtotal is the sum of the line totals", view.totals.subtotal, 6250);
eq("discount is carried from the stored order", view.totals.discount, 500);
eq("shipping is carried from the stored order", view.totals.shipping, 150);
eq("the admin fee is carried from the stored order", view.totals.fee, 100);
// 6250 - 500 + 150 + 100 = 6000
eq("grand total = subtotal − discount + shipping + fee", view.totals.total, 6000);
eq("the discount code is shown so the customer can see it applied", view.totals.discountCode, "WELCOME10");
eq("the fee keeps the owner's own label", view.totals.feeLabel, "Service fee");

// A discount larger than the cart must not produce a negative total — the same
// floor buildOrderMessage applies, so the review, the chat message and the
// stored order can never disagree.
eq(
  "a discount bigger than the cart floors the total at zero",
  buildOrderConfirmation(
    { ...order, discount: { code: "HUGE", label: "too much", amount: 999999 } },
    catalog,
    { currency: "₱" },
  ).totals.total,
  0,
);

// The plain case: no fee, no shipping, no discount.
const bare = buildOrderConfirmation(
  {
    ...order,
    shipping: { address: "12 Mabini St", barangay: "", city: "", province: "", postal: "", fee: 0 },
    adminFee: null,
    discount: null,
  },
  catalog,
  { currency: "₱" },
);
eq("no discount → zero, not undefined", bare.totals.discount, 0);
eq("no fee → zero", bare.totals.fee, 0);
eq("total equals subtotal when nothing is added or taken off", bare.totals.total, 6250);

// ── Formatting ───────────────────────────────────────────────────────────────
console.log("formatting");

eq("the store's currency symbol is used", view.currency, "₱");
eq(
  "an unset currency degrades to no symbol rather than printing 'undefined'",
  buildOrderConfirmation(order, catalog, { currency: "" }).currency,
  "",
);

// ── Immutability ─────────────────────────────────────────────────────────────
console.log("immutability");

const itemsBefore = JSON.stringify(order.items);
buildOrderConfirmation(order, catalog, { currency: "₱" });
eq("building the view does not mutate the stored order", JSON.stringify(order.items), itemsBefore);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) process.exit(1);
