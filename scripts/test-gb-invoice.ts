// Self-contained test gate for group-buy invoices (src/lib/storefront/gb-invoice.ts):
// the owner's settings, the once-per-round shipping fee, the invoice text the
// customer gets in chat when a round closes, and the chat idempotency keys.
// Pure — no DB, no React.
//
//   npm run test:gb-invoice
//
// Also pins the app's copy (mobile/src/features/admin/group-buys/invoice.ts),
// which the admin editor's preview renders with, to this file byte for byte.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_INVOICE_TEMPLATE,
  buildGroupBuyInvoice,
  invoiceClientId,
  invoiceClientPrefix,
  invoiceShippingFee,
  invoiceShortName,
  mergeGroupBuyInvoiceSave,
  normalizeGroupBuyInvoice,
  renderInvoiceTemplate,
  shouldAutoInvoice,
  type InvoiceOrder,
} from "../src/lib/storefront/gb-invoice";

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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const peso = (n: number) => `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function order(over: Partial<InvoiceOrder> & Pick<InvoiceOrder, "id" | "orderNumber" | "placedAt">): InvoiceOrder {
  return {
    customer: { name: "admin jonina", phone: "9928214519", email: "" },
    shipping: {
      address: "ibabang dupay site p4 switzerland street hannah apartment room 4",
      barangay: "",
      city: "lucena city",
      province: "",
      postal: "4301",
      fee: 0,
    },
    courier: "J&T Express (include Province, City and Brgy or District)",
    items: [],
    adminFee: null,
    paymentFee: null,
    discount: null,
    ...over,
  };
}

const TMB = "MICABLEND 2.0 - 30mg of Tirzepatide and 5mg of Cagrilintide (TMB 2.0)";
const RT = "Retatrutide 30 MG (RT30)";

console.log("\nsettings");
{
  const d = normalizeGroupBuyInvoice(undefined);
  eq("missing config = off, no fee, default template", [d.enabled, d.shippingFee, d.template, d.unit], [false, 0, "", "vial"]);
  eq("garbage config = defaults", normalizeGroupBuyInvoice("nope").enabled, false);
  eq("fee from a typed string", normalizeGroupBuyInvoice({ shippingFee: "250" }).shippingFee, 250);
  eq("negative fee = 0", normalizeGroupBuyInvoice({ shippingFee: -5 }).shippingFee, 0);
  eq("fee is capped", normalizeGroupBuyInvoice({ shippingFee: 9e9 }).shippingFee, 100_000);
  eq("the default template is stored as blank", normalizeGroupBuyInvoice({ template: DEFAULT_INVOICE_TEMPLATE }).template, "");
  const pm = normalizeGroupBuyInvoice({
    paymentMethods: [
      { id: "a", name: "GoTyme", details: "016793762828 - Niegel Belependio", imageUrl: "https://ik.imagekit.io/x/qr.png" },
      { id: "a", name: "UnionBank", details: "109322081163", imageUrl: "data:image/png;base64,AAAA" },
      { name: "", details: "", imageUrl: "" },
      null,
    ],
  }).paymentMethods;
  eq("empty/garbage methods dropped", pm.length, 2);
  eq("an inline data image is never stored", pm[1].imageUrl, "");
  ok("duplicate ids are made unique", pm[0].id !== pm[1].id);
  eq("blank unit stays blank", normalizeGroupBuyInvoice({ unit: "" }).unit, "");
}

console.log("\nenabledAt (server-owned)");
{
  const now = new Date("2026-10-08T10:00:00Z");
  const on = mergeGroupBuyInvoiceSave(undefined, { enabled: true, enabledAt: "2020-01-01T00:00:00Z" }, now);
  eq("turning on stamps now — a client can't back-date it", on.enabledAt, now.toISOString());
  const later = mergeGroupBuyInvoiceSave(on, { enabled: true, shippingFee: 300 }, new Date("2026-10-09T00:00:00Z"));
  eq("editing while on keeps the original stamp", later.enabledAt, now.toISOString());
  const off = mergeGroupBuyInvoiceSave(later, { enabled: false }, new Date("2026-10-10T00:00:00Z"));
  eq("turning off keeps the stamp", off.enabledAt, now.toISOString());
  const again = mergeGroupBuyInvoiceSave(off, { enabled: true }, new Date("2026-10-11T00:00:00Z"));
  eq("turning back on re-stamps", again.enabledAt, "2026-10-11T00:00:00.000Z");
}

console.log("\nshipping fee + auto send");
{
  const cfg = normalizeGroupBuyInvoice({ enabled: true, shippingFee: 250, enabledAt: "2026-10-01T00:00:00Z" });
  eq("first order in the round pays the fee", invoiceShippingFee(cfg, false), 250);
  eq("an add-on pays none", invoiceShippingFee(cfg, true), 0);
  eq("a round closed after switching on is invoiced", shouldAutoInvoice(cfg, "2026-10-02T00:00:00Z"), true);
  eq("a round closed before is not", shouldAutoInvoice(cfg, "2026-09-30T00:00:00Z"), false);
  eq("switched off = never", shouldAutoInvoice({ ...cfg, enabled: false }, "2026-10-02T00:00:00Z"), false);
  eq("no close time = no", shouldAutoInvoice(cfg, null), false);
}

console.log("\ntemplate");
{
  eq("placeholders filled", renderInvoiceTemplate("Hi {name}", { name: "Ana" }), "Hi Ana");
  eq("a line whose placeholders are all empty is dropped", renderInvoiceTemplate("A\nTG: {tg}\nB", { tg: "" }), "A\nB");
  eq("a line with one filled placeholder stays", renderInvoiceTemplate("{a} {b}", { a: "x", b: "" }), "x");
  eq("unknown keys stay visible", renderInvoiceTemplate("{nope}", {}), "{nope}");
  eq("blank-line runs collapse", renderInvoiceTemplate("A\n\n\n\nB", {}), "A\n\nB");
  eq("short code from the trailing parentheses", invoiceShortName(TMB), "TMB 2.0");
  eq("no parentheses = the full name", invoiceShortName("BPC-157 10mg"), "BPC-157 10mg");
}

console.log("\nthe owner's sample invoice");
{
  const cfg = normalizeGroupBuyInvoice({
    enabled: true,
    shippingFee: 250,
    paymentMethods: [
      { name: "GoTyme", details: "016793762828 - Niegel Belependio", imageUrl: "https://ik.imagekit.io/x/gotyme.png" },
      { name: "UnionBank", details: "109322081163 – Niegel Belependio" },
    ],
  });
  const base = order({ id: "", orderNumber: "", placedAt: "" });
  const first = order({
    id: "o1",
    orderNumber: "PEP095",
    placedAt: "2026-10-01T01:00:00Z",
    shipping: { ...base.shipping, fee: 250 },
    items: [{ name: TMB, qty: 2, price: 1690 }],
  });
  const addOn = order({ id: "o2", orderNumber: "PEP101", placedAt: "2026-10-01T05:00:00Z", items: [{ name: RT, qty: 1, price: 1495 }] });
  const inv = buildGroupBuyInvoice({ orders: [addOn, first], roundName: "GB 10/2/2026", closedAt: "2026-10-02T12:00:00Z", config: cfg, money: peso })!;
  const expected = [
    "PEP095",
    "👤 Name: admin jonina",
    "🏠 Address: ibabang dupay site p4 switzerland street hannah apartment room 4, lucena city, 4301",
    "💬 WhatsApp #: 9928214519",
    "📞 Delivery Contact #: 9928214519",
    "🚚 Mode of Delivery: J&T Express (include Province, City and Brgy or District)",
    "💸 Shipping Fee: ₱250.00",
    "🗓 GB Date: GB 10/2/2026",
    "",
    "📦 List of Orders",
    `${TMB} - 2 vials`,
    `${RT} - 1 vial`,
    "💵 Breakdown of Cost",
    "TMB 2.0 - 2 vials = ₱3,380.00",
    "RT30 - 1 vial = ₱1,495.00",
    "Total w/ SF: ₱5,125.00",
    "📝 ORDER & PAYMENT",
    "",
    "✅ All orders received are FINAL.",
    "",
    "⚠️ Payment should be settled within 24 hours after we send the invoice.",
    "",
    "⚠️ Payment confirmation will be done within 24–48 hours after the invoice settlement schedule is completed.",
    "",
    "💳 PAYMENT OPTIONS:",
    "",
    "🏦 GoTyme",
    "016793762828 - Niegel Belependio",
    "",
    "🏦 UnionBank",
    "109322081163 – Niegel Belependio",
    "",
    "🙏 Thank you for prompt payments.",
    "",
    "NOTE: Send your proof of payment here in this chat.",
  ].join("\n");
  eq("an add-on joins the first order's invoice with ONE fee", inv.text, expected);
  eq("total = items + one fee", inv.total, 5125);
  eq("invoice number = the first order", inv.orderNumber, "PEP095");
  eq("only hosted images are sent", inv.images, ["https://ik.imagekit.io/x/gotyme.png"]);

  const raced = buildGroupBuyInvoice({
    orders: [first, { ...addOn, shipping: { ...addOn.shipping, fee: 250 } }],
    roundName: "GB",
    closedAt: null,
    config: cfg,
    money: peso,
  })!;
  eq("two racing first checkouts still bill one fee", raced.total, 5125);

  const onlyAddOn = buildGroupBuyInvoice({ orders: [addOn], roundName: "GB", closedAt: null, config: cfg, money: peso })!;
  eq("fee-bearing order cancelled → the configured fee still applies once", onlyAddOn.total, 1495 + 250);

  const merged = buildGroupBuyInvoice({
    orders: [first, { ...addOn, items: [{ name: TMB, qty: 1, price: 1690 }] }],
    roundName: "GB",
    closedAt: null,
    config: cfg,
    money: peso,
  })!;
  ok("the same product across orders merges into one line", merged.text.includes("TMB 2.0 - 3 vials = ₱5,070.00"), merged.text);

  const fees = buildGroupBuyInvoice({
    orders: [{ ...first, adminFee: { label: "Service fee", amount: 50 }, discount: { code: "X", label: "", amount: 100 } }],
    roundName: "GB",
    closedAt: null,
    config: cfg,
    money: peso,
  })!;
  ok("fees and discounts appear in the breakdown", fees.text.includes("Service fee = ₱50.00") && fees.text.includes("Discount = -₱100.00"));
  eq("…and in the total", fees.total, 3380 + 50 - 100 + 250);
  eq("no orders = no invoice", buildGroupBuyInvoice({ orders: [], roundName: "", closedAt: null, config: cfg, money: peso }), null);
}

console.log("\nchat keys");
{
  const id = invoiceClientId("o1", "gb1", "text");
  ok("keeps the order bot prefix (View order links the first order)", id.startsWith("bot:order:o1:"));
  ok("every send of this round's invoice shares a prefix", id.startsWith(invoiceClientPrefix("o1", "gb1")));
  ok("identical text = identical key (a re-send is a no-op)", id === invoiceClientId("o1", "gb1", "text"));
  ok("edited text = a new key", id !== invoiceClientId("o1", "gb1", "text 2"));
  ok("another round = another prefix", invoiceClientPrefix("o1", "gb2") !== invoiceClientPrefix("o1", "gb1"));
}

console.log("\napp copy");
{
  const root = join(__dirname, "..");
  const server = readFileSync(join(root, "src/lib/storefront/gb-invoice.ts"), "utf8");
  let app = "";
  try {
    app = readFileSync(join(root, "mobile/src/features/admin/group-buys/invoice.ts"), "utf8");
  } catch {
    /* missing copy fails below */
  }
  ok("mobile/src/features/admin/group-buys/invoice.ts is a byte-identical copy", server === app, "re-copy src/lib/storefront/gb-invoice.ts");
}

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
