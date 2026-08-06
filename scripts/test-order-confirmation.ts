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
  formatOrderMessage,
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

// ── The copyable order message ───────────────────────────────────────────────
// The confirmation page hands the customer off to a chat app, but only WhatsApp
// and Gmail can carry a prefilled body. On Telegram / Messenger / Instagram —
// and on any device where the deep link opens the app with an empty compose box
// — the customer needs to paste the order in themselves. formatOrderMessage
// rebuilds that text from the REVIEWED VIEW, so the pasted message and the
// screen above it can never disagree.
console.log("copyable order message");

const msg = formatOrderMessage(view, { brandName: "Peptide Lab" });
const msgLines = msg.split("\n");

eq(
  "the message names the order and the store",
  msgLines[0],
  "Order #1042 — Peptide Lab",
);
eq(
  "no store name → the order still names itself",
  formatOrderMessage(view).split("\n")[0],
  "Order #1042",
);

ok(
  "every item lists quantity and line total",
  msg.includes("• Semaglutide — 5mg ×2 — ₱6,000") &&
    msg.includes("• Bacteriostatic Water ×1 — ₱250"),
  JSON.stringify(msg),
);

// The stored line name usually already carries the chosen option (the cart
// stamps a display name at placement). Appending the variation blindly would
// print "Semaglutide — 5mg (5mg)".
ok(
  "a variation the stored name already carries is not repeated",
  !msg.includes("(5mg)"),
  JSON.stringify(msg),
);

const withOption = buildOrderConfirmation(
  {
    ...order,
    items: [{ productId: "p1", name: "Retatrutide", qty: 1, price: 4000, variation: "10mg" }],
  },
  catalog,
  { currency: "₱" },
);
ok(
  "a variation the stored name lacks is appended so the store knows the size",
  formatOrderMessage(withOption).includes("• Retatrutide (10mg) ×1 — ₱4,000"),
  JSON.stringify(formatOrderMessage(withOption)),
);

// Money breakdown: same rule as the chat message built at checkout — show the
// arithmetic only when something moved the total off the subtotal.
ok(
  "the breakdown appears when there is a discount, shipping or a fee",
  msg.includes("Subtotal: ₱6,250") &&
    msg.includes("Discount (WELCOME10): -₱500") &&
    msg.includes("Shipping (Lalamove): ₱150") &&
    msg.includes("Service fee: ₱100") &&
    msg.includes("Total: ₱6,000"),
  JSON.stringify(msg),
);
eq(
  "the message's total is the number the screen shows",
  msg.includes(`Total: ₱${view.totals.total.toLocaleString()}`),
  true,
);

const bareMsg = formatOrderMessage(bare, { brandName: "Peptide Lab" });
ok(
  "a plain order gets one Total line, no breakdown",
  bareMsg.includes("Total: ₱6,250") &&
    !bareMsg.includes("Subtotal:") &&
    !bareMsg.includes("Shipping") &&
    !bareMsg.includes("Discount"),
  JSON.stringify(bareMsg),
);

const noCode = buildOrderConfirmation(
  { ...order, discount: { label: "Manual discount", amount: 500 } },
  catalog,
  { currency: "₱" },
);
ok(
  "a discount with no code leaves no empty parentheses",
  formatOrderMessage(noCode).includes("Discount: -₱500"),
  JSON.stringify(formatOrderMessage(noCode)),
);

const noCourier = buildOrderConfirmation({ ...order, courier: "" }, catalog, { currency: "₱" });
ok(
  "shipping with no courier leaves no empty parentheses",
  formatOrderMessage(noCourier).includes("Shipping: ₱150"),
  JSON.stringify(formatOrderMessage(noCourier)),
);

ok(
  "the customer block carries name, email and phone",
  msg.includes("Name: Ada Reyes") &&
    msg.includes("Email: ada@example.com") &&
    msg.includes("Phone: 09171234567"),
  JSON.stringify(msg),
);
ok(
  "the ship-to line is the same one-line address the screen shows",
  msg.includes(`Ship to: ${view.shipping.address}`),
  JSON.stringify(msg),
);
ok("the payment method is carried", msg.includes("Payment: GCash"), JSON.stringify(msg));

// The whole point of this button is that it works when the automatic prefill
// didn't. A message with "undefined" in it is worse than no message.
ok(
  "the message never prints undefined, null or NaN",
  !/undefined|null|NaN/.test(msg),
  JSON.stringify(msg),
);
const sparseMsg = formatOrderMessage(
  buildOrderConfirmation(
    {
      id: "ord_2",
      customer: { name: "", email: "", phone: "" },
      shipping: { address: "" },
      items: [{ name: "Mystery vial", qty: 1, price: 100 }],
    },
    [],
    {},
  ),
);
ok(
  "an order missing every optional field still formats cleanly",
  !/undefined|null|NaN/.test(sparseMsg) && sparseMsg.includes("• Mystery vial ×1 — 100"),
  JSON.stringify(sparseMsg),
);

const viewBefore = JSON.stringify(view);
formatOrderMessage(view, { brandName: "Peptide Lab" });
eq("formatting the message does not mutate the view", JSON.stringify(view), viewBefore);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) process.exit(1);
