// Checkout WhatsApp number (Brand.checkoutWhatsapp, mnm-pepsabuy): the field is
// asked only where the store switched it on, survives the order payload, and
// reaches every customer-facing sheet of the group-buy report.
//
// Run: npm run test:checkout-whatsapp

import assert from "node:assert";
import { checkoutFields } from "../src/lib/storefront/checkout-fields";
import { normalizeOrderInput } from "../src/lib/orders/db-mapping";
import { buildCustomerLines } from "../src/lib/storefront/group-buy-report";
import { buildRoundOrderRows } from "../src/lib/storefront/group-buy-orders";
import { buildMemberOrders } from "../src/lib/storefront/gb-member-orders";
import { buildOrderMessage, EMPTY_CUSTOMER } from "../src/storefront/checkout";
import type { Brand } from "../src/storefront/types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const keys = (brand: Parameters<typeof checkoutFields>[0], market?: "local" | "international") =>
  checkoutFields(brand, market).map((f) => f.key);

console.log("checkout fields");
check("not asked unless the store switched it on", () => {
  assert.ok(!keys({}).includes("whatsapp"));
  assert.ok(!keys({ checkoutWhatsapp: false }).includes("whatsapp"));
});
check("switched on: a required tel field after Phone + WhatsApp name", () => {
  const fields = checkoutFields({ checkoutWhatsapp: true });
  const i = fields.findIndex((f) => f.key === "phone");
  assert.equal(fields[i + 2]?.key, "whatsapp");
  assert.equal(fields[i + 2]?.required, true);
  assert.equal(fields[i + 2]?.type, "tel");
});
check("switched on: a required WhatsApp NAME field sits right before the number", () => {
  const fields = checkoutFields({ checkoutWhatsapp: true });
  const i = fields.findIndex((f) => f.key === "whatsappName");
  assert.ok(i > 0, "whatsappName asked");
  assert.equal(fields[i - 1]?.key, "phone");
  assert.equal(fields[i + 1]?.key, "whatsapp");
  assert.equal(fields[i]?.required, true);
  assert.ok(!keys({}).includes("whatsappName"));
});
check("combines with a hidden Email and the International cart", () => {
  const k = keys({ checkoutWhatsapp: true, checkoutHideEmail: true });
  assert.ok(!k.includes("email") && k.includes("whatsapp"));
  assert.ok(keys({ checkoutWhatsapp: true }, "international").includes("whatsapp"));
});

console.log("order payload");
const base = { id: "o1", status: "new", items: [], shipping: {} };
check("a typed number is kept on the order", () => {
  const o = normalizeOrderInput({ ...base, customer: { name: "A", phone: "0917", whatsapp: "+63 917 555 0101" } });
  assert.equal(o.customer.whatsapp, "+63 917 555 0101");
});
check("a typed WhatsApp name is kept on the order, blank leaves no key", () => {
  const o = normalizeOrderInput({ ...base, customer: { name: "A", whatsappName: "  Erika M " } });
  assert.equal(o.customer.whatsappName, "Erika M");
  assert.ok(!("whatsappName" in normalizeOrderInput({ ...base, customer: { name: "A", whatsappName: " " } }).customer));
});
check("blank / absent leaves no whatsapp key (other stores' orders unchanged)", () => {
  assert.ok(!("whatsapp" in normalizeOrderInput({ ...base, customer: { name: "A" } }).customer));
  assert.ok(!("whatsapp" in normalizeOrderInput({ ...base, customer: { name: "A", whatsapp: "   " } }).customer));
});
check("the chat order message carries a WhatsApp line only when given", () => {
  const brand = { name: "MNM" } as Brand;
  const msg = (whatsapp?: string) =>
    buildOrderMessage(brand, [], { ...EMPTY_CUSTOMER, name: "A", phone: "0917", ...(whatsapp ? { whatsapp } : {}) });
  assert.ok(msg("+639175550101").includes("WhatsApp: +639175550101"));
  assert.ok(!msg().includes("WhatsApp:"));
});
check("the chat order message carries the WhatsApp name when given", () => {
  const brand = { name: "MNM" } as Brand;
  const msg = buildOrderMessage(brand, [], { ...EMPTY_CUSTOMER, name: "A", phone: "0917", whatsappName: "Erika M" });
  assert.ok(msg.includes("WhatsApp name: Erika M"));
});

console.log("group-buy report");
const orders = [
  {
    orderNumber: "MNM-1",
    date: "2026-10-01T00:00:00Z",
    status: "confirmed",
    customer: { name: "Erika", email: "e@x.com", phone: "0917" },
    items: [{ name: "TR30", qty: 2, price: 100 }],
  },
  {
    orderNumber: "MNM-2",
    date: "2026-10-02T00:00:00Z",
    status: "new",
    customer: { name: "Erika", email: "e@x.com", phone: "0917", whatsapp: "+639175550101", whatsappName: "Erika WA" },
    items: [{ name: "TR30", qty: 1, price: 100 }],
  },
];
check("Customers: the later order's WhatsApp fills the merged buyer row", () => {
  const [erika] = buildCustomerLines(orders);
  assert.equal(erika.orders, 2);
  assert.equal(erika.whatsapp, "+639175550101");
  assert.equal(erika.whatsappName, "Erika WA");
});
check("Order Details: per-order WhatsApp, blank when that order had none", () => {
  const rows = buildRoundOrderRows({ id: "r1", name: "R1", status: "open", startsAt: null, endsAt: null }, orders);
  assert.equal(rows.find((r) => r.orderNumber === "MNM-1")?.whatsapp, "");
  assert.equal(rows.find((r) => r.orderNumber === "MNM-2")?.whatsapp, "+639175550101");
  assert.equal(rows.find((r) => r.orderNumber === "MNM-1")?.whatsappName, "");
  assert.equal(rows.find((r) => r.orderNumber === "MNM-2")?.whatsappName, "Erika WA");
});
check("Orders per Customer: the member carries the newest WhatsApp", () => {
  const [m] = buildMemberOrders(orders);
  assert.equal(m.whatsapp, "+639175550101");
  assert.equal(m.whatsappName, "Erika WA");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
