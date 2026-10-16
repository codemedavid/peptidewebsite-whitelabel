/**
 * Waybills — one printable shipping label per order, filed per group buy
 * (src/lib/mobile/waybill). The app prints them from the admin Orders screen.
 *
 *   npm run test:waybills
 */
import assert from "node:assert";

import type { Order } from "../src/storefront/types";
import { toWaybill, waybillQuery, WAYBILL_LIMIT } from "../src/lib/mobile/waybill";

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const money = (n: number) => `₱${n.toFixed(2)}`;
type Item = Order["items"][number];

const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  orderNumber: "PEP095",
  status: "confirmed",
  paymentStatus: "pending",
  paymentMethod: "GCash",
  date: "2026-10-02T03:00:00.000Z",
  customer: { name: " admin jonina ", email: "a@b.c", phone: " 9928214519 ", contactMethod: "App" },
  shipping: {
    address: "site p4 switzerland street hannah apartment room 4",
    barangay: "ibabang dupay",
    city: "lucena city",
    province: "",
    postal: "4301",
    country: "Philippines",
    region: "Luzon",
    fee: 250,
  },
  courier: "J&T Express (include Province, City and Brgy or District)",
  trackingNumber: "",
  shippingNote: "",
  items: [
    { name: "MICABLEND 2.0 - 30mg of Tirzepatide and 5mg of Cagrilintide (TMB 2.0)", qty: 2, price: 5000 } as Item,
    { name: "Retatrutide 30 MG (RT30)", qty: 1, price: 4000 } as Item,
  ],
  paymentProof: null,
  groupBuyId: "gb1",
  groupBuyName: "GB 10/2/2026",
  ...over,
});

console.log("toWaybill");
test("carries every line of the owner's waybill", () => {
  const w = toWaybill(order(), { money, unit: "vial" });
  assert.deepEqual(w, {
    id: "o1",
    orderNumber: "PEP095",
    name: "admin jonina",
    address: "site p4 switzerland street hannah apartment room 4, ibabang dupay, lucena city, 4301",
    phone: "9928214519",
    courier: "J&T Express (include Province, City and Brgy or District)",
    shippingFee: "₱250.00",
    roundName: "GB 10/2/2026",
    items: [
      { name: "MICABLEND 2.0 - 30mg of Tirzepatide and 5mg of Cagrilintide (TMB 2.0)", qty: 2, qtyLabel: "2 vials" },
      { name: "Retatrutide 30 MG (RT30)", qty: 1, qtyLabel: "1 vial" },
    ],
  });
});

test("an on-hand order has no round; a blank number falls back to the short id", () => {
  const w = toWaybill(order({ groupBuyId: null, groupBuyName: null, orderNumber: "", id: "cmabcdef123456" }), { money, unit: "vial" });
  assert.equal(w.roundName, "");
  assert.equal(w.orderNumber, "#123456");
});

test("a blank unit prints the bare number; a plural unit is not doubled", () => {
  assert.equal(toWaybill(order(), { money, unit: "" }).items[0].qtyLabel, "2");
  assert.equal(toWaybill(order(), { money, unit: "pcs" }).items[0].qtyLabel, "2 pcs");
});

test("empty and zero-quantity lines are dropped; a missing qty counts as 1", () => {
  const items = [
    { name: "  ", qty: 1, price: 1 },
    { name: "Zero", qty: 0, price: 1 },
    { name: "No qty", price: 1 },
  ] as unknown as Order["items"];
  // A missing qty is how legacy rows store "one" (order-view reads it the same way).
  assert.deepEqual(
    toWaybill(order({ items }), { money, unit: "vial" }).items.map((i) => [i.name, i.qty]),
    [["No qty", 1]],
  );
});

test("a free-shipping order still prints its fee line as zero, never blank", () => {
  const o = order();
  assert.equal(toWaybill({ ...o, shipping: { ...o.shipping, fee: 0 } }, { money, unit: "vial" }).shippingFee, "₱0.00");
});

console.log("waybillQuery");
test("a single order by id ignores every list filter", () => {
  assert.deepEqual(waybillQuery(new URLSearchParams("id=o1&round=gb1&filter=new&q=x")), { kind: "one", id: "o1" });
});

test("a round prints its orders under the current status + search", () => {
  assert.deepEqual(waybillQuery(new URLSearchParams("round=gb1&filter=to-fulfil&q=%20ana%20")), {
    kind: "list",
    round: "gb1",
    filter: "to-fulfil",
    q: "ana",
  });
});

test("no round and no id is refused — printing every order ever is never one tap", () => {
  assert.equal(waybillQuery(new URLSearchParams("filter=all")), null);
  assert.equal(waybillQuery(new URLSearchParams("round=all")), null);
});

test("the limit is generous enough for a full round", () => {
  assert.ok(WAYBILL_LIMIT >= 300);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall waybill tests passed");
