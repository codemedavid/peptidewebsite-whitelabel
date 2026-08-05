/**
 * Self-contained test for the LEGACY ORDER IMPORT (HP GLOW's pre-whitelabel
 * Supabase orders → storefront_orders).
 *
 * HP GLOW ran on its own Supabase app until 2026-08 and carries 487 orders of
 * real history. The whitelabel tenant started empty, so the owner loses eight
 * months of order history, revenue reporting and Best Sellers ranking unless
 * those rows are carried across.
 *
 * Two things make that non-trivial, and both are what this file pins down:
 *
 *  1. SHAPE. The old table is flat (customer_name, shipping_city, order_items
 *     jsonb of {product_name, variation_name, quantity, price}); the whitelabel
 *     row is denormalized JSON (customer{}, shipping{}, items[]) with a
 *     server-minted orderNumber and a replayable statusHistory. The mapping has
 *     to be faithful — money especially: the old `total_price` is the ITEMS
 *     SUBTOTAL ONLY (it excludes both shipping and the voucher), whereas the
 *     whitelabel derives the total as items − discount + shipping + adminFee.
 *
 *  2. INVENTORY. Confirming an order deducts stock and cancelling restocks it,
 *     matched by productId (or exact name). 432 of the imported orders are
 *     already "confirmed", so linking them to the live catalog — which we WANT,
 *     for Best Sellers and per-product analytics — would let a later status
 *     change silently move live stock that was really consumed months ago on a
 *     different system. `StorefrontOrder.imported` freezes that: an imported
 *     order's status still moves, its stock never does.
 *
 * Runs the REAL pure helpers (no DB, no React runtime):
 *
 *   - src/lib/orders/legacy-import.ts
 *       parseLegacyOrders   — Postgres COPY text format → typed rows
 *       buildCatalogIndex / resolveLegacyLine — old name+dose → live productId
 *       mapLegacyOrder      — one legacy row → the order we write
 *       importOrderNumber   — the HPG-IMP-#### namespace
 *   - src/lib/storefront/order-status.ts (inventoryMove / planStatusChange
 *       honour the `imported` flag)
 *   - src/lib/storefront/admin-dashboard.ts (orderTotal reconciles)
 *
 * When the real dump is present at the repo root it is parsed end-to-end too,
 * so a mapping regression fails against all 487 real rows, not just fixtures.
 * Fixture rows below use synthetic customers — no real buyer data lives here.
 *
 *   npm run test:legacy-import
 */

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseLegacyOrders,
  buildCatalogIndex,
  resolveLegacyLine,
  mapLegacyOrder,
  importOrderNumber,
  type LegacyCatalogProduct,
} from "../src/lib/orders/legacy-import";
import { planStatusChange, inventoryMove } from "../src/lib/storefront/order-status";
import { orderTotal } from "../src/lib/storefront/admin-dashboard";
import type { Order, OrderStatusEvent } from "../src/storefront/types";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ──────────────────────────── fixtures ──────────────────────────────────────

/** A stand-in for the live hpglow catalog — the shapes that actually matter:
 *  a product whose doses are VARIATIONS, and a product whose dose is baked into
 *  its own name with no variations at all. */
const CATALOG: LegacyCatalogProduct[] = [
  {
    id: "p-tirz",
    name: "Tirzepatide",
    variations: [{ name: "15mg" }, { name: "20mg" }, { name: "30mg" }],
  },
  { id: "p-glut", name: "Glutathione", variations: [{ name: "1500mg" }] },
  { id: "p-t60", name: "Tirzepatide 60mg (Free Shipping Nationwide)" },
  { id: "p-aqua", name: "Aqualyx" },
];

const INDEX = buildCatalogIndex(CATALOG);

const COPY_COLUMNS =
  "COPY public.orders (id, customer_name, customer_email, customer_phone, shipping_address, " +
  "shipping_city, shipping_state, shipping_zip_code, shipping_country, shipping_location, " +
  "shipping_fee, order_items, total_price, payment_method_id, payment_method_name, " +
  "payment_proof_url, payment_status, contact_method, order_status, notes, created_at, " +
  "updated_at, shipping_barangay, voucher_code, voucher_discount) FROM stdin;";

/** Build one raw COPY line from its 25 already-escaped fields. */
function copyRow(fields: string[]): string {
  assert.equal(fields.length, 25, "fixture row must have 25 columns");
  return fields.join("\t");
}

const ITEMS_TIRZ_30 =
  '[{"price": 4299, "total": 4299, "quantity": 2, "product_id": "old-1", ' +
  '"product_name": "Tirzepatide", "variation_id": "old-v1", "variation_name": "30mg"}]';

const ITEMS_MIXED =
  '[{"price": 1499, "total": 1499, "quantity": 1, "product_id": "old-2", ' +
  '"product_name": "Glutathione 1500mg", "variation_id": null, "variation_name": null}, ' +
  '{"price": 14, "total": 14, "quantity": 3, "product_id": "old-3", ' +
  '"product_name": "Terumo 30g x 3/8 Syringe", "variation_id": null, "variation_name": null}]';

/** Row A — confirmed + paid, a variation line, a proof on the dead Supabase host,
 *  a customer note containing an escaped newline, and no voucher. */
const ROW_A = copyRow([
  "5b074ded-28b8-40a9-b4da-b295ec98e9af",
  "Test Buyer One",
  "buyer.one@example.com",
  "09170000001",
  "2F Example Telecom Store",
  "Dasmariñas City",
  "Cavite",
  "4114",
  "\\N",
  "LUZON",
  "165.00",
  ITEMS_TIRZ_30,
  "8598.00",
  "gcash",
  "GCash",
  "https://rtsnxmatvbabdylsnuuh.supabase.co/storage/v1/object/public/payment-proofs/x.jpeg",
  "paid",
  "instagram",
  "confirmed",
  "Leave with guard.\\nCall on arrival.",
  "2026-01-23 01:50:18.299906+00",
  "2026-01-23 07:25:05.603831+00",
  "Sampaloc 1",
  "\\N",
  "0",
]);

/** Row B — still "new" / unpaid, no proof, a voucher applied, two lines. */
const ROW_B = copyRow([
  "51926c35-6a8c-40b9-a7b5-e6fcd90b1008",
  "Test Buyer Two",
  "buyer.two@example.com",
  "09170000002",
  "46 Example St.",
  "Las Pinas City",
  "Metro Manila",
  "1741",
  "Philippines",
  "NCR",
  "160.00",
  ITEMS_MIXED,
  "1541.00",
  "\\N",
  "\\N",
  "\\N",
  "pending",
  "viber",
  "new",
  "\\N",
  "2026-01-26 02:52:54.222691+00",
  "2026-01-26 08:11:28.626282+00",
  "Pamplona 2",
  "REWARDS300",
  "300",
]);

const DUMP = [
  "--",
  "-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres",
  "--",
  "",
  COPY_COLUMNS,
  ROW_A,
  ROW_B,
  "\\.",
  "",
  "",
  "--",
  "-- Data for Name: payment_methods; Type: TABLE DATA",
  "--",
  "",
  "COPY public.payment_methods (id, name) FROM stdin;",
  "gcash\tGCash",
  "\\.",
].join("\n");

const ROWS = parseLegacyOrders(DUMP);

// ──────────────────────────── 1. COPY parser ────────────────────────────────
console.log("\nCOPY text-format parser");

check("reads exactly the orders block, stopping at the \\. terminator", () => {
  assert.equal(ROWS.length, 2);
  assert.equal(ROWS[0].id, "5b074ded-28b8-40a9-b4da-b295ec98e9af");
  assert.equal(ROWS[1].id, "51926c35-6a8c-40b9-a7b5-e6fcd90b1008");
});

check("\\N becomes null, never the literal string", () => {
  assert.equal(ROWS[0].shippingCountry, null);
  assert.equal(ROWS[0].voucherCode, null);
  assert.equal(ROWS[1].paymentMethodName, null);
  assert.equal(ROWS[1].notes, null);
});

check("\\n unescapes to a real newline inside a text field", () => {
  assert.equal(ROWS[0].notes, "Leave with guard.\nCall on arrival.");
});

check("numeric columns are parsed as numbers", () => {
  assert.equal(ROWS[0].shippingFee, 165);
  assert.equal(ROWS[0].totalPrice, 8598);
  assert.equal(ROWS[1].voucherDiscount, 300);
  assert.equal(ROWS[0].voucherDiscount, 0);
});

check("order_items jsonb is parsed into typed line objects", () => {
  assert.equal(ROWS[0].orderItems.length, 1);
  assert.equal(ROWS[0].orderItems[0].product_name, "Tirzepatide");
  assert.equal(ROWS[0].orderItems[0].variation_name, "30mg");
  assert.equal(ROWS[0].orderItems[0].quantity, 2);
  assert.equal(ROWS[1].orderItems.length, 2);
});

check("a dump with no orders block yields no rows rather than throwing", () => {
  assert.deepEqual(parseLegacyOrders("-- nothing here\nSELECT 1;\n"), []);
});

// ──────────────────────────── 2. catalog resolution ─────────────────────────
console.log("\nLegacy line → live catalog");

check("a variation line resolves to the BASE product id and keeps its dose", () => {
  const line = resolveLegacyLine(INDEX, {
    product_name: "Tirzepatide",
    variation_name: "30mg",
    quantity: 2,
    price: 4299,
  });
  assert.equal(line.productId, "p-tirz");
  assert.equal(line.variation, "30mg");
  // Named the way a native checkout names it (makeVariationEntry / cartDisplayName)
  // so an imported order reads identically to a real one in the admin list.
  assert.equal(line.name, "Tirzepatide — 30mg");
});

check("a dose baked into the old NAME folds back onto the matching variation", () => {
  const line = resolveLegacyLine(INDEX, {
    product_name: "Glutathione 1500mg",
    variation_name: null,
    quantity: 1,
    price: 1499,
  });
  assert.equal(line.productId, "p-glut");
  assert.equal(line.variation, "1500mg");
  assert.equal(line.name, "Glutathione — 1500mg");
});

check("a product whose dose IS its name resolves with no variation", () => {
  const line = resolveLegacyLine(INDEX, {
    product_name: "Tirzepatide 60mg (Free Shipping Nationwide)",
    variation_name: null,
    quantity: 1,
    price: 8999,
  });
  assert.equal(line.productId, "p-t60");
  assert.equal(line.variation, undefined);
  assert.equal(line.name, "Tirzepatide 60mg (Free Shipping Nationwide)");
});

check("matching tolerates stray whitespace on either side", () => {
  const line = resolveLegacyLine(INDEX, {
    product_name: "Aqualyx ",
    variation_name: null,
    quantity: 1,
    price: 999,
  });
  assert.equal(line.productId, "p-aqua");
});

check("a discontinued product keeps its name and price but links to nothing", () => {
  const line = resolveLegacyLine(INDEX, {
    product_name: "Terumo 30g x 3/8 Syringe",
    variation_name: null,
    quantity: 3,
    price: 14,
  });
  assert.equal(line.productId, undefined);
  assert.equal(line.name, "Terumo 30g x 3/8 Syringe");
  assert.equal(line.qty, 3);
  assert.equal(line.price, 14);
});

// ──────────────────────────── 3. order mapping ──────────────────────────────
console.log("\nLegacy row → storefront order");

const A = mapLegacyOrder(ROWS[0], { index: INDEX, orderNumber: importOrderNumber("HPG-IMP", 1) });
const B = mapLegacyOrder(ROWS[1], { index: INDEX, orderNumber: importOrderNumber("HPG-IMP", 2) });

check("order numbers use the zero-padded import namespace", () => {
  assert.equal(A.orderNumber, "HPG-IMP-0001");
  assert.equal(B.orderNumber, "HPG-IMP-0002");
  assert.equal(importOrderNumber("HPG-IMP", 487), "HPG-IMP-0487");
});

check("the legacy uuid is carried as clientId so a re-run is idempotent", () => {
  assert.equal(A.clientId, "5b074ded-28b8-40a9-b4da-b295ec98e9af");
  assert.equal(B.clientId, "51926c35-6a8c-40b9-a7b5-e6fcd90b1008");
});

check("every imported order is flagged imported", () => {
  assert.equal(A.imported, true);
  assert.equal(B.imported, true);
});

check("customer details map across, contact method included", () => {
  assert.deepEqual(A.customer, {
    name: "Test Buyer One",
    email: "buyer.one@example.com",
    phone: "09170000001",
    contactMethod: "instagram",
  });
});

check("shipping maps across, region from shipping_location and a numeric fee", () => {
  assert.deepEqual(A.shipping, {
    address: "2F Example Telecom Store",
    barangay: "Sampaloc 1",
    city: "Dasmariñas City",
    province: "Cavite",
    postal: "4114",
    country: "",
    region: "LUZON",
    fee: 165,
  });
  assert.equal(B.shipping.country, "Philippines");
});

check("the customer's delivery note is carried as the shipping note", () => {
  assert.equal(A.shippingNote, "Leave with guard.\nCall on arrival.");
  assert.equal(B.shippingNote, "");
});

check("status and payment status map across", () => {
  assert.equal(A.status, "confirmed");
  assert.equal(A.paymentStatus, "paid");
  assert.equal(A.paymentMethod, "GCash");
  assert.equal(B.status, "new");
  assert.equal(B.paymentStatus, "pending");
  assert.equal(B.paymentMethod, "");
});

check("the dead Supabase proof URL is dropped, never stored as a broken link", () => {
  // The old project (rtsnxmatvbabdylsnuuh.supabase.co) was deleted; the images
  // are unrecoverable, so the admin shows "no proof" rather than a broken image.
  assert.equal(A.paymentProofUrl, null);
  assert.equal(B.paymentProofUrl, null);
});

check("statusHistory replays placement, then the final status at its update time", () => {
  assert.deepEqual(A.statusHistory, [
    { status: "new", at: "2026-01-23T01:50:18.299Z" },
    { status: "confirmed", at: "2026-01-23T07:25:05.603Z" },
  ]);
});

check("an order that never left 'new' gets a single placement event", () => {
  assert.deepEqual(B.statusHistory, [{ status: "new", at: "2026-01-26T02:52:54.222Z" }]);
});

check("timestamps are preserved — the order dates from when it was really placed", () => {
  assert.equal(A.placedAt, "2026-01-23T01:50:18.299Z");
  assert.equal(A.updatedAt, "2026-01-23T07:25:05.603Z");
});

check("a voucher becomes a snapshotted discount; no voucher means no discount", () => {
  assert.equal(A.discount, undefined);
  assert.deepEqual(B.discount, { code: "REWARDS300", label: "REWARDS300", amount: 300 });
});

check("items carry faithful qty and unit price, linked where the product survives", () => {
  assert.deepEqual(A.items, [
    { name: "Tirzepatide — 30mg", qty: 2, price: 4299, productId: "p-tirz", variation: "30mg" },
  ]);
  assert.equal(B.items.length, 2);
  assert.equal(B.items[0].productId, "p-glut");
  assert.equal(B.items[1].productId, undefined);
});

// ──────────────────────────── 4. money reconciliation ───────────────────────
console.log("\nMoney");

/** The mapped order as the admin/dashboard sees it, for orderTotal(). */
function asOrder(o: ReturnType<typeof mapLegacyOrder>): Order {
  return {
    id: o.clientId,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    date: o.placedAt,
    customer: o.customer,
    shipping: o.shipping,
    courier: o.courier,
    trackingNumber: o.trackingNumber,
    shippingNote: o.shippingNote,
    items: o.items,
    statusHistory: o.statusHistory,
    discount: o.discount,
    paymentProof: o.paymentProofUrl,
  };
}

check("the old total_price is the items subtotal — the mapping reproduces it", () => {
  const subtotal = A.items.reduce((s, i) => s + i.price * i.qty, 0);
  assert.equal(subtotal, ROWS[0].totalPrice);
});

check("the whitelabel total adds shipping and subtracts the voucher", () => {
  // A: 8598 items + 165 shipping, no voucher.
  assert.equal(orderTotal(asOrder(A)), 8763);
  // B: 1541 items − 300 voucher + 160 shipping.
  assert.equal(orderTotal(asOrder(B)), 1401);
});

// ──────────────────────────── 5. inventory is frozen ────────────────────────
console.log("\nImported orders never move live stock");

const CONFIRMED_HISTORY: OrderStatusEvent[] = [
  { status: "new", at: "2026-01-23T01:50:18.299Z" },
  { status: "confirmed", at: "2026-01-23T07:25:05.603Z" },
];
const NOW = "2026-08-05T00:00:00.000Z";

check("a NORMAL confirmed order still restocks when cancelled", () => {
  const plan = planStatusChange(
    { status: "confirmed", statusHistory: CONFIRMED_HISTORY },
    "cancelled",
    NOW,
  );
  assert.equal(plan.move, "restock");
});

check("an IMPORTED confirmed order moves no stock when cancelled", () => {
  const plan = planStatusChange(
    { status: "confirmed", statusHistory: CONFIRMED_HISTORY, imported: true },
    "cancelled",
    NOW,
  );
  assert.equal(plan.move, null);
});

check("a NORMAL new order still deducts when confirmed", () => {
  const plan = planStatusChange(
    { status: "new", statusHistory: [{ status: "new", at: NOW }] },
    "confirmed",
    NOW,
  );
  assert.equal(plan.move, "deduct");
});

check("an IMPORTED new order deducts nothing when confirmed", () => {
  const plan = planStatusChange(
    { status: "new", statusHistory: [{ status: "new", at: NOW }], imported: true },
    "confirmed",
    NOW,
  );
  assert.equal(plan.move, null);
});

check("freezing stock does NOT freeze the order — status and journey still move", () => {
  const plan = planStatusChange(
    { status: "confirmed", statusHistory: CONFIRMED_HISTORY, imported: true },
    "delivered",
    NOW,
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.status, "delivered");
  assert.equal(plan.statusHistory.length, 3);
  assert.deepEqual(plan.statusHistory[2], { status: "delivered", at: NOW });
});

check("inventoryMove itself honours the flag, so no caller can route around it", () => {
  assert.equal(inventoryMove("new", [{ status: "new", at: NOW }], "confirmed"), "deduct");
  assert.equal(inventoryMove("new", [{ status: "new", at: NOW }], "confirmed", true), null);
  assert.equal(inventoryMove("confirmed", CONFIRMED_HISTORY, "cancelled", true), null);
});

// ──────────────────────────── 6. the real dump ──────────────────────────────
const DUMP_PATH = join(process.cwd(), "db_cluster-05-08-2026@01-12-58.backup");

if (existsSync(DUMP_PATH)) {
  console.log("\nAgainst the real HP GLOW dump");
  const real = parseLegacyOrders(readFileSync(DUMP_PATH, "utf8"));

  check("parses all 487 historical orders", () => {
    assert.equal(real.length, 487);
  });

  check("every row maps without throwing, and money reconciles on all of them", () => {
    real.forEach((row, i) => {
      const mapped = mapLegacyOrder(row, {
        index: INDEX,
        orderNumber: importOrderNumber("HPG-IMP", i + 1),
      });
      const subtotal = mapped.items.reduce((s, it) => s + it.price * it.qty, 0);
      assert.ok(
        Math.abs(subtotal - row.totalPrice) < 0.01,
        `row ${i + 1} (${row.id}): items ${subtotal} ≠ total_price ${row.totalPrice}`,
      );
      const expected = Math.max(0, subtotal - row.voucherDiscount + row.shippingFee);
      assert.ok(
        Math.abs(orderTotal(asOrder(mapped)) - expected) < 0.01,
        `row ${i + 1}: total ${orderTotal(asOrder(mapped))} ≠ ${expected}`,
      );
    });
  });

  check("no imported order ever carries a proof URL", () => {
    real.forEach((row, i) => {
      const mapped = mapLegacyOrder(row, {
        index: INDEX,
        orderNumber: importOrderNumber("HPG-IMP", i + 1),
      });
      assert.equal(mapped.paymentProofUrl, null, `row ${i + 1} kept a proof URL`);
    });
  });

  check("order numbers are unique and clientIds are unique", () => {
    const numbers = new Set<string>();
    const clients = new Set<string>();
    real.forEach((row, i) => {
      const mapped = mapLegacyOrder(row, {
        index: INDEX,
        orderNumber: importOrderNumber("HPG-IMP", i + 1),
      });
      numbers.add(mapped.orderNumber);
      clients.add(mapped.clientId);
    });
    assert.equal(numbers.size, real.length);
    assert.equal(clients.size, real.length);
  });
} else {
  console.log("\nAgainst the real HP GLOW dump — SKIPPED (dump not at repo root)");
}

// ──────────────────────────── summary ───────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
