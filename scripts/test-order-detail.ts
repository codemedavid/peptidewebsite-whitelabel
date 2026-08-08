/**
 * Self-contained test for the pure presentation helpers behind the store-admin
 * Order Detail screen (src/storefront/admin/AdminOrderDetail.tsx). These helpers
 * are extracted from the component so the redesign (two-column layout + sticky
 * sidebar) can re-skin the markup without changing what the screen computes:
 *
 *   src/storefront/admin/order-detail.ts
 *     formatOrderMoney(n, cur)  — "₱1,200.00" / "SAR 1,200.00" money formatting.
 *     formatOrderDate(iso)      — "Jun 28, 2026 · 10:42 AM" in the store's
 *                                 timezone (Asia/Manila); raw string on bad input.
 *     orEmDash(value)           — blank/whitespace → "—" (address fallbacks).
 *     buildAddressLine(ship)    — single-line address for courier paste.
 *     cityProvinceLine(ship)    — "City, Province Postal" row value.
 *     buildBookingText(order)   — multi-line Name/Phone/Address/Region block.
 *     computeOrderTotals(order) — subtotal/discount/shipping/fee/total math.
 *     itemCount(order)          — summed line quantities for the count pill.
 *
 *   npm run test:order-detail
 */

import assert from "node:assert";

import type { Order } from "../src/storefront/types";
import {
  formatOrderMoney,
  formatOrderDate,
  orEmDash,
  buildAddressLine,
  cityProvinceLine,
  buildBookingText,
  computeOrderTotals,
  itemCount,
} from "../src/storefront/admin/order-detail";

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

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    orderNumber: "PEP-1003",
    status: "new",
    paymentStatus: "paid",
    paymentMethod: "bank transfer",
    date: "2026-06-28T02:42:00.000Z", // 10:42 AM in Asia/Manila (UTC+8)
    customer: {
      name: "Juan Dela Cruz",
      email: "juan@example.com",
      phone: "+63 917 555 0101",
      contactMethod: "whatsapp",
    },
    shipping: {
      address: "123 Mabini St",
      barangay: "",
      city: "Cebu City",
      province: "Cebu",
      postal: "6000",
      country: "Philippines",
      region: "",
      fee: 0,
    },
    courier: "",
    trackingNumber: "",
    shippingNote: "",
    items: [{ name: "Peptide Nimo", qty: 1, price: 1200 }],
    paymentProof: null,
    ...over,
  };
}

console.log("\nOrder Detail presentation helpers — pure core\n");

// ── formatOrderMoney ─────────────────────────────────────────────────────────
// Was formatPHP, which hardcoded the peso. An order detail is the STORE's own
// money, so it now takes the store's currency — with the peso as the fallback,
// which is what keeps every tenant alive today reading exactly as it did.
check("formatOrderMoney renders peso with 2 decimals + thousands separators", () => {
  assert.strictEqual(formatOrderMoney(1200), "₱1,200.00");
  assert.strictEqual(formatOrderMoney(0), "₱0.00");
});
check("formatOrderMoney coerces NaN/undefined to ₱0.00", () => {
  assert.strictEqual(formatOrderMoney(Number.NaN), "₱0.00");
  assert.strictEqual(formatOrderMoney(undefined as unknown as number), "₱0.00");
});
check("formatOrderMoney prints the store's currency when it has one", () => {
  assert.strictEqual(formatOrderMoney(1200, "SAR"), "SAR 1,200.00");
  assert.strictEqual(formatOrderMoney(1200, "₱"), "₱1,200.00");
});

// ── formatOrderDate ──────────────────────────────────────────────────────────
check("formatOrderDate formats ISO in Asia/Manila as 'Mon D, YYYY · h:mm AM/PM'", () => {
  assert.strictEqual(
    formatOrderDate("2026-06-28T02:42:00.000Z"),
    "Jun 28, 2026 · 10:42 AM",
  );
});
check("formatOrderDate uses store TZ, not UTC (boundary across midnight)", () => {
  // 23:30Z on Jun 28 is 07:30 the NEXT day in Manila → must roll to Jun 29.
  assert.strictEqual(
    formatOrderDate("2026-06-28T23:30:00.000Z"),
    "Jun 29, 2026 · 7:30 AM",
  );
});
check("formatOrderDate returns '' for empty and raw string for unparseable input", () => {
  assert.strictEqual(formatOrderDate(""), "");
  assert.strictEqual(formatOrderDate("not-a-date"), "not-a-date");
});

// ── orEmDash ─────────────────────────────────────────────────────────────────
check("orEmDash replaces blank/whitespace/null with an em dash", () => {
  assert.strictEqual(orEmDash(""), "—");
  assert.strictEqual(orEmDash("   "), "—");
  assert.strictEqual(orEmDash(null), "—");
  assert.strictEqual(orEmDash(undefined), "—");
});
check("orEmDash keeps a real value (trimmed)", () => {
  assert.strictEqual(orEmDash("  Brgy. Luz "), "Brgy. Luz");
});

// ── buildAddressLine ─────────────────────────────────────────────────────────
check("buildAddressLine joins present parts, prefixes barangay, skips blanks", () => {
  const o = makeOrder({
    shipping: { ...makeOrder().shipping, barangay: "Luz", region: "Region VII" },
  });
  assert.strictEqual(
    buildAddressLine(o.shipping),
    "123 Mabini St, Brgy. Luz, Cebu City, Cebu, 6000, Philippines",
  );
});
check("buildAddressLine omits the barangay segment when empty", () => {
  assert.strictEqual(
    buildAddressLine(makeOrder().shipping),
    "123 Mabini St, Cebu City, Cebu, 6000, Philippines",
  );
});

// ── cityProvinceLine ─────────────────────────────────────────────────────────
check("cityProvinceLine renders 'City, Province Postal'", () => {
  assert.strictEqual(cityProvinceLine(makeOrder().shipping), "Cebu City, Cebu 6000");
});
check("cityProvinceLine drops missing pieces without stray separators", () => {
  const s = { ...makeOrder().shipping, province: "", postal: "" };
  assert.strictEqual(cityProvinceLine(s), "Cebu City");
});

// ── buildBookingText ─────────────────────────────────────────────────────────
check("buildBookingText stacks Name/Phone/Address and includes Region when set", () => {
  const o = makeOrder({
    shipping: { ...makeOrder().shipping, region: "Region VII" },
  });
  assert.strictEqual(
    buildBookingText(o),
    [
      "Name: Juan Dela Cruz",
      "Phone: +63 917 555 0101",
      "Address: 123 Mabini St, Cebu City, Cebu, 6000, Philippines",
      "Region: Region VII",
    ].join("\n"),
  );
});
check("buildBookingText omits the Region line when region is blank", () => {
  assert.ok(!buildBookingText(makeOrder()).includes("Region:"));
});

// ── computeOrderTotals ───────────────────────────────────────────────────────
check("computeOrderTotals sums items × qty for the subtotal", () => {
  const o = makeOrder({
    items: [
      { name: "A", qty: 2, price: 500 },
      { name: "B", qty: 1, price: 250 },
    ],
  });
  assert.strictEqual(computeOrderTotals(o).subtotal, 1250);
});
check("computeOrderTotals adds shipping + admin fee and subtracts discount", () => {
  const o = makeOrder({
    items: [{ name: "A", qty: 1, price: 1000 }],
    shipping: { ...makeOrder().shipping, fee: 80 },
    adminFee: { label: "Service fee", amount: 50 },
    discount: { code: "SAVE", label: "Save 100", amount: 100 },
  });
  const t = computeOrderTotals(o);
  assert.strictEqual(t.subtotal, 1000);
  assert.strictEqual(t.shipping, 80);
  assert.strictEqual(t.fee, 50);
  assert.strictEqual(t.discount, 100);
  assert.strictEqual(t.total, 1030); // 1000 - 100 + 80 + 50
});
check("computeOrderTotals never returns a negative total", () => {
  const o = makeOrder({
    items: [{ name: "A", qty: 1, price: 100 }],
    discount: { code: "BIG", label: "Big", amount: 999 },
  });
  assert.strictEqual(computeOrderTotals(o).total, 0);
});

// ── itemCount ────────────────────────────────────────────────────────────────
check("itemCount sums line quantities (defaulting qty to 1)", () => {
  const o = makeOrder({
    items: [
      { name: "A", qty: 3, price: 1 },
      { name: "B", qty: undefined as unknown as number, price: 1 },
    ],
  });
  assert.strictEqual(itemCount(o), 4);
});

// ──────────────────────────── summary ───────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
