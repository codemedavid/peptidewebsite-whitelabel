// Self-contained test gate for the CUSTOMER ORDER NOTE — the free-text box a
// buyer fills in at checkout ("please deliver after 5pm", "no ice packs") that
// the store owner reads on the order.
//
//   npm run test:order-note
//
// The rule the whole file is really testing: `customerNote` flows INBOUND
// (customer → owner) and is a record, not a workspace. It is therefore
//
//   • its own column, never `shippingNote` — that field flows the other way
//     (the owner types it, the customer reads it on the public Track page), so
//     sharing one column would let an owner overwrite what a customer asked for
//     AND republish the customer's words on a page reachable with just an order
//     number;
//   • normalized ONCE, server-side, through a single capped helper — it is
//     free text from an anonymous buyer that lands in the owner's spreadsheet;
//   • not admin-editable — `cleanPatch` must never accept it;
//   • kept out of the SUPPLIER group-buy workbook, which is the no-PII copy a
//     third party receives, while the owner's own customer workbook does carry it.
//
// Covers: the normalizer, the owner's on/off + label config, both chat-message
// builders, the confirmation view-model, the CSV export columns, the group-buy
// report rows, and source-level wiring for the pieces that live inside a
// "use server" module and so cannot be imported here.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CUSTOMER_NOTE_MAX, normalizeCustomerNote } from "../src/lib/orders/customer-note";
import {
  CHECKOUT_RULES_DEFAULTS,
  CHECKOUT_RULE_CUSTOMER_NOTE_LABEL,
  CUSTOMER_NOTE_LABEL_MAX,
  customerNoteLabel,
  normalizeCheckoutRules,
} from "../src/lib/storefront/checkout-rules";
import { buildOrderMessage } from "../src/storefront/checkout";
import {
  buildOrderConfirmation,
  formatOrderMessage,
  type ConfirmationOrder,
} from "../src/lib/storefront/order-confirmation";
import { ORDER_COLUMNS, buildOrderRows, csvCell } from "../src/lib/storefront/data-export";
import { buildRoundOrderRows } from "../src/lib/storefront/group-buy-orders";
import type { Brand, Order, Product } from "../src/storefront/types";

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

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("customer order note — the buyer's request, on the owner's order\n");

// ── 1. The normalizer ────────────────────────────────────────────────────────
// One helper, used by the server action, so there is a single place where an
// anonymous buyer's free text gets bounded.
console.log("normalizeCustomerNote — the single hardening seam");

eq(
  "a plain note survives",
  normalizeCustomerNote("Please deliver after 5pm"),
  "Please deliver after 5pm",
);
eq("surrounding whitespace is trimmed", normalizeCustomerNote("  ring the bell  "), "ring the bell");
eq("a missing note is the empty string, never undefined", normalizeCustomerNote(undefined), "");
eq("null is the empty string", normalizeCustomerNote(null), "");
eq("a whitespace-only note collapses to empty", normalizeCustomerNote("   \n  "), "");
eq("a non-string is coerced, not trusted", normalizeCustomerNote(42), "42");
eq("an object cannot smuggle structure through", normalizeCustomerNote({ a: 1 }), "[object Object]");
ok(
  "an over-long note is capped, not rejected",
  normalizeCustomerNote("x".repeat(CUSTOMER_NOTE_MAX + 250)).length === CUSTOMER_NOTE_MAX,
  `got ${normalizeCustomerNote("x".repeat(CUSTOMER_NOTE_MAX + 250)).length}`,
);
ok(
  "the cap leaves no ragged trailing space",
  !/\s$/.test(normalizeCustomerNote("word ".repeat(300))),
);
eq(
  "newlines inside the note are preserved — a buyer's list is a list",
  normalizeCustomerNote("line one\nline two"),
  "line one\nline two",
);

// ── 2. The owner's switch ────────────────────────────────────────────────────
// Every other checkout field in this codebase is tunable per tenant; the note
// box is no different. It ships ON — an optional box costs a store nothing —
// but an owner who doesn't want it gets an off switch rather than a code change.
console.log("\ncheckout rules — the owner's on/off + label");

ok("the note box ships ON by default", CHECKOUT_RULES_DEFAULTS.customerNoteEnabled === true);
eq(
  "a tenant that has never opened the panel gets the default",
  normalizeCheckoutRules({}).customerNoteEnabled,
  true,
);
eq(
  "an owner can switch it off",
  normalizeCheckoutRules({ customerNoteEnabled: false }).customerNoteEnabled,
  false,
);
eq(
  "a non-boolean falls back to the default rather than reading as off",
  normalizeCheckoutRules({ customerNoteEnabled: "no" }).customerNoteEnabled,
  true,
);
eq(
  "a blank label means the built-in copy",
  customerNoteLabel(normalizeCheckoutRules({})),
  CHECKOUT_RULE_CUSTOMER_NOTE_LABEL,
);
eq(
  "an owner's own label wins",
  customerNoteLabel(normalizeCheckoutRules({ customerNoteLabel: "Anything we should know?" })),
  "Anything we should know?",
);
ok(
  "the label is capped like every other owner-authored string",
  normalizeCheckoutRules({ customerNoteLabel: "y".repeat(CUSTOMER_NOTE_LABEL_MAX + 40) })
    .customerNoteLabel.length === CUSTOMER_NOTE_LABEL_MAX,
);
eq(
  "a whitespace-only label reads as unset, not as a blank label",
  customerNoteLabel(normalizeCheckoutRules({ customerNoteLabel: "   " })),
  CHECKOUT_RULE_CUSTOMER_NOTE_LABEL,
);

// ── 3. The chat hand-off ─────────────────────────────────────────────────────
// Most owners on this platform work the order out of WhatsApp / Messenger. If
// the note doesn't reach the chat message, the feature effectively doesn't
// exist for them.
console.log("\nbuildOrderMessage — the seller's copy in chat");

const brand = { name: "Peptide Lab", currency: "₱" } as unknown as Brand;
const product = {
  id: "p1",
  name: "BPC-157",
  price: 1200,
  currency: "₱",
} as unknown as Product;
const lines = [{ product, qty: 2 }];
const buyer = {
  name: "Ada Reyes",
  email: "ada@example.com",
  phone: "09171234567",
  address: "12 Mabini St",
  barangay: "Poblacion",
  city: "Davao City",
  province: "Davao del Sur",
  postal: "8000",
};

const msgWithNote = buildOrderMessage(
  brand,
  lines,
  buyer,
  undefined,
  "1042",
  null,
  null,
  null,
  null,
  "Please deliver after 5pm — gate code 1234",
);
ok("the note is labelled in the chat message", msgWithNote.includes("Customer note:"), msgWithNote);
ok(
  "the note text itself reaches the seller",
  msgWithNote.includes("Please deliver after 5pm — gate code 1234"),
  msgWithNote,
);
ok(
  "the note sits after the shipping address, where the seller reads instructions",
  msgWithNote.indexOf("Ship to:") < msgWithNote.indexOf("Customer note:"),
);

const msgNoNote = buildOrderMessage(
  brand,
  lines,
  buyer,
  undefined,
  "1042",
  null,
  null,
  null,
  null,
  "",
);
ok(
  "an order with no note prints no empty note heading",
  !msgNoNote.includes("Customer note"),
  msgNoNote,
);
ok(
  "omitting the argument entirely still works — legacy call sites",
  !buildOrderMessage(brand, lines, buyer).includes("Customer note"),
);

// ── 4. The confirmation review screen ────────────────────────────────────────
// The customer must be able to see what they typed before they hand the order
// off, otherwise a typo in a delivery instruction is undiscoverable.
console.log("\norder confirmation — the customer sees their own words back");

const storedOrder: ConfirmationOrder = {
  id: "ord_1",
  orderNumber: "1042",
  date: "2026-09-01T10:00:00.000Z",
  paymentMethod: "GCash",
  courier: "Lalamove",
  customer: { name: "Ada Reyes", email: "ada@example.com", phone: "09171234567" },
  shipping: { address: "12 Mabini St", city: "Davao City", fee: 150 },
  items: [{ name: "BPC-157", qty: 2, price: 1200 }],
  customerNote: "Please deliver after 5pm",
};

const view = buildOrderConfirmation(storedOrder, [], { currency: "₱" });
eq("the stored note rides onto the view-model", view.note, "Please deliver after 5pm");
eq(
  "an order placed without a note carries an empty string, not undefined",
  buildOrderConfirmation({ ...storedOrder, customerNote: undefined }, [], {}).note,
  "",
);
ok(
  "the pasteable fallback message carries the note too",
  formatOrderMessage(view, { brandName: "Peptide Lab" }).includes("Please deliver after 5pm"),
);
ok(
  "a note-less order's pasteable message has no dangling heading",
  !formatOrderMessage(buildOrderConfirmation({ ...storedOrder, customerNote: "" }, [], {})).includes(
    "Customer note",
  ),
);

// ── 5. The owner's export ────────────────────────────────────────────────────
console.log("\ndata export — the note is a column, and a safe one");

const exported = {
  id: "o1",
  orderNumber: "1042",
  status: "new",
  paymentStatus: "pending",
  paymentMethod: "GCash",
  date: "2026-09-01T10:00:00.000Z",
  customer: { name: "Ada Reyes", email: "ada@example.com", phone: "", contactMethod: "" },
  shipping: {
    address: "12 Mabini St",
    barangay: "",
    city: "Davao City",
    province: "",
    postal: "",
    country: "",
    region: "",
    fee: 150,
  },
  courier: "Lalamove",
  trackingNumber: "",
  shippingNote: "Shipped Monday",
  customerNote: "Please deliver after 5pm",
  items: [{ name: "BPC-157", qty: 2, price: 1200 }],
  paymentProof: null,
} as unknown as Order;

const [exportRow] = buildOrderRows([exported]);
ok(
  "every order row still lines up with its header — no column drift",
  exportRow.length === ORDER_COLUMNS.length,
  `${exportRow.length} cells vs ${ORDER_COLUMNS.length} columns`,
);
const cells = Object.fromEntries(ORDER_COLUMNS.map((c, i) => [c, exportRow[i]]));
eq("the customer's note is its own column", cells["Customer Note"], "Please deliver after 5pm");
eq("the owner's shipping note stays a SEPARATE column", cells["Shipping Note"], "Shipped Monday");
ok(
  "a note that looks like a formula lands in Excel as inert text",
  csvCell('=HYPERLINK("http://evil","click")').startsWith("'="),
  csvCell('=HYPERLINK("http://evil","click")'),
);

// ── 6. Group-buy reports — the privacy split ─────────────────────────────────
// The supplier workbook is sent to a third party and carries no PII and no
// revenue. A free-text note is exactly the kind of field that leaks an address
// or a phone number, so it belongs only in the owner's own customer copy.
console.log("\ngroup-buy reports — owner's copy only, never the supplier's");

type RoundArg = Parameters<typeof buildRoundOrderRows>[0];
type OrderArg = Parameters<typeof buildRoundOrderRows>[1][number];

const round = { name: "Round 12", startsAt: null, endsAt: null } as unknown as RoundArg;

const roundRows = buildRoundOrderRows(round, [
  {
    orderNumber: "1042",
    date: "2026-09-01T10:00:00.000Z",
    status: "new",
    customer: { name: "Ada Reyes", phone: "09171234567" },
    items: [{ name: "BPC-157", qty: 2, price: 1200 }],
    customerNote: "Please deliver after 5pm",
  } as unknown as OrderArg,
]);
eq("a round order line carries the note", roundRows[0]?.customerNote, "Please deliver after 5pm");
eq(
  "a note-less order line is an empty string",
  buildRoundOrderRows(round, [
    {
      orderNumber: "1043",
      date: "2026-09-01T10:00:00.000Z",
      status: "new",
      items: [{ name: "BPC-157", qty: 1, price: 1200 }],
    } as unknown as OrderArg,
  ])[0]?.customerNote,
  "",
);

const workbook = src("src/storefront/admin/supplier-workbook.ts");
const supplierFn = workbook.slice(
  workbook.indexOf("export async function buildSupplierWorkbook"),
  workbook.indexOf("export async function buildCustomerWorkbook"),
);
const customerFn = workbook.slice(workbook.indexOf("export async function buildCustomerWorkbook"));
ok("PRIVACY: the supplier workbook never touches the note", !/customerNote/.test(supplierFn));
ok("the owner's customer workbook does carry it", /customerNote/.test(customerFn));

// ── 7. Server wiring ─────────────────────────────────────────────────────────
// `src/actions/orders.ts` is a "use server" module — it cannot be imported into
// a plain script, so these are source-level assertions on the four places the
// column has to be threaded through, plus the one place it must NOT be.
console.log("\nserver action — threaded through, and NOT admin-writable");

const actions = src("src/actions/orders.ts");
ok(
  "checkout input runs through the shared normalizer",
  /customerNote:\s*normalizeCustomerNote\(/.test(actions),
);
ok(
  "the normalizer is imported, not re-implemented",
  /from "@\/lib\/orders\/customer-note"/.test(actions),
);
ok("the DB row type declares the column", /customerNote:\s*string/.test(actions));
ok("the column is written on create", /customerNote:\s*p\.customerNote/.test(actions));
ok("the column is read back onto the storefront order", /customerNote:\s*row\.customerNote/.test(actions));

const cleanPatch = actions.slice(
  actions.indexOf("function cleanPatch"),
  actions.indexOf("export async function updateStorefrontOrderAction"),
);
ok(
  "the admin patch path REFUSES the note — it is the customer's record",
  !/customerNote/.test(cleanPatch),
);

// ── 8. Schema + surfaces ─────────────────────────────────────────────────────
console.log("\nschema and UI surfaces");

const schema = src("prisma/schema.prisma");
const orderModel = schema.slice(
  schema.indexOf("model StorefrontOrder"),
  schema.indexOf('@@map("storefront_orders")'),
);
ok(
  "storefront_orders has its own customerNote column",
  /customerNote\s+String\s+@default\(""\)/.test(orderModel),
  orderModel
    .split("\n")
    .filter((l) => l.includes("Note"))
    .join(" | "),
);

const cart = src("src/storefront/components/CartCheckout.tsx");
ok("checkout renders a textarea for the note", /<textarea[\s\S]{0,400}sf-cart__note-input/.test(cart));
ok("the note is carried into the placed order draft", /customerNote:/.test(cart));
ok("the textarea is gated on the owner's switch", /customerNoteEnabled/.test(cart));

const detail = src("src/storefront/admin/AdminOrderDetail.tsx");
ok("the admin order detail shows the customer note", /customerNote/.test(detail));
ok(
  "the admin note display is READ-ONLY — no input bound to it",
  !/setCustomerNote|value=\{customerNote\}/.test(detail),
);

const list = src("src/storefront/admin/AdminOrders.tsx");
ok("the orders list flags which orders have a note", /customerNote/.test(list));

const track = src("src/storefront/pages/TrackOrderPage.tsx");
ok("the public Track page does NOT republish the customer's note", !/customerNote/.test(track));

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) process.exit(1);
