/**
 * Self-contained gate for OWNER DATA EXPORT — "if I ever leave Pepweb, can I
 * take my products, customers and order history with me?".
 *
 * The answer has to be yes, in writing and in code: a store owner's catalog,
 * customer relationships and sales records are their business, not the
 * platform's lock-in. Before this there was no way out — the only export in the
 * product was the group-buy supplier report, which covers ONE round and omits
 * the catalog entirely.
 *
 * User journeys this proves:
 *   J1  As an owner, I download my full product catalog as CSV, one row per
 *       sellable option (variations included), so another platform can import it.
 *   J2  As an owner, I download my customer list — deduplicated across repeat
 *       orders, with contact details, order counts and lifetime spend.
 *   J3  As an owner, I download my complete order history: one file of orders
 *       with money that reconciles to the admin, one of line items.
 *   J4  As an owner, I get the same data as machine-readable JSON so a developer
 *       can migrate it without parsing spreadsheets.
 *   J5  Only the OWNER can pull the export — a staff member with every module
 *       granted cannot walk out with the customer list.
 *   J6  The files are safe and lossless in Excel: addresses with commas, quotes
 *       and newlines survive, and no cell executes as a formula.
 *   J7  Nothing is silently dropped — trashed orders are exported too, flagged,
 *       and an empty store still yields header rows rather than empty files.
 *
 * Runs the REAL pure core (no DB, no React, no browser):
 *
 *   src/lib/storefront/data-export.ts
 *     csvCell / toCsv          — the escaping + CSV-injection trust boundary
 *     buildProductRows         — catalog, one row per sellable option
 *     buildOrderRows           — order history, money identical to orderTotal()
 *     buildOrderItemRows       — line items
 *     buildCustomerRecords     — dedupe/rollup of customers across orders
 *     buildDataExport          — the 5-file bundle the admin downloads
 *
 * Plus structural checks that the wiring is real (a pure core that type-checks
 * is not proof any surface calls it):
 *
 *   - src/actions/storefront-export.ts is OWNER-ONLY and tenant-scoped
 *   - the export view is registered in the sidebar as ownerOnly
 *   - AdminPage routes the view to the panel
 *   - the export is NOT a staff-grantable module
 *
 *   npm run test:data-export
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CUSTOMER_COLUMNS,
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  PRODUCT_COLUMNS,
  buildCustomerRecords,
  buildDataExport,
  buildOrderItemRows,
  buildOrderRows,
  buildProductRows,
  csvCell,
  toCsv,
} from "../src/lib/storefront/data-export";
import { orderTotal } from "../src/lib/storefront/admin-dashboard";
import type { Order, Product } from "../src/storefront/types";

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

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Parse one CSV line back into cells — enough to prove round-tripping. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "BPC-157",
    description: "Research peptide",
    price: 1200,
    currency: "₱",
    category: "Peptides",
    featured: false,
    image: null,
    stock: 8,
    ...over,
  } as Product;
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    orderNumber: "ABC-1001",
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: "GCash",
    date: "2026-03-01T08:00:00.000Z",
    customer: { name: "Ana Cruz", email: "ana@example.com", phone: "09171234567", contactMethod: "messenger" },
    shipping: {
      address: "12 Mabini St",
      barangay: "Poblacion",
      city: "Davao",
      province: "Davao del Sur",
      postal: "8000",
      country: "PH",
      region: "XI",
      fee: 150,
    },
    courier: "J&T",
    trackingNumber: "JT123",
    shippingNote: "",
    items: [{ name: "BPC-157", qty: 2, price: 1200, productId: "p1" }],
    ...over,
  } as Order;
}

const STORE = { name: "HP Glow", slug: "hpglow", currency: "₱" };
const AT = "2026-08-19T02:30:00.000Z";

console.log("\nOwner data export — take your products, customers and orders with you\n");

// ───────────────────────────── csvCell / toCsv ──────────────────────────────
console.log("csvCell / toCsv (J6 — safe and lossless in Excel)");

check("a plain value passes through unquoted", () => {
  assert.equal(csvCell("BPC-157"), "BPC-157");
  assert.equal(csvCell(1200), "1200");
});

check("null and undefined become an empty cell, never the string 'undefined'", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

check("commas, quotes and newlines are quoted and escaped, not dropped", () => {
  assert.equal(csvCell("12 Mabini St, Poblacion"), '"12 Mabini St, Poblacion"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

check("an address with a comma round-trips back to the same string", () => {
  const address = 'Blk 5, Lot 2 "Green" Village\nDavao';
  const [back] = parseCsvLine(csvCell(address));
  assert.equal(back, address);
});

check("a formula-looking cell is neutralized (CSV injection)", () => {
  // The owner opens these in Excel/Sheets. A customer who typed
  // =HYPERLINK(...) as their name must not execute there.
  for (const evil of ["=1+1", "+1", "-1+1", "@SUM(A1)", "=cmd|'/c calc'!A0"]) {
    const cell = csvCell(evil);
    assert.ok(cell.startsWith("'") || cell.startsWith("\"'"), `not neutralized: ${evil} → ${cell}`);
  }
});

check("a negative NUMBER is still a number, not a quoted apostrophe string", () => {
  // The injection guard must not corrupt real money: -150 is data, not a formula.
  assert.equal(csvCell(-150), "-150");
});

check("toCsv joins rows with CRLF-safe newlines and keeps the header first", () => {
  const csv = toCsv([["A", "B"], [1, "x,y"]]);
  const lines = csv.split("\n");
  assert.equal(lines[0], "A,B");
  assert.equal(lines[1], '1,"x,y"');
});

// ──────────────────────────────── products ──────────────────────────────────
console.log("\nbuildProductRows (J1 — the catalog)");

check("every product becomes a row under the shared header", () => {
  const rows = buildProductRows([product(), product({ id: "p2", name: "TB-500" })], STORE.currency);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, PRODUCT_COLUMNS.length, "row width matches the header");
});

check("a product's name, price, stock and category all reach the row", () => {
  const [row] = buildProductRows([product()], STORE.currency);
  const cells = Object.fromEntries(PRODUCT_COLUMNS.map((c, i) => [c, row[i]]));
  assert.equal(cells["Name"], "BPC-157");
  assert.equal(cells["Price"], 1200);
  assert.equal(cells["Stock"], 8);
  assert.equal(cells["Category"], "Peptides");
});

check("a product with variations exports ONE ROW PER OPTION with its own price", () => {
  // A single row per product would lose the per-size prices the store actually
  // sells at — the importing platform needs each sellable option.
  const rows = buildProductRows(
    [
      product({
        variations: [
          { name: "5mg", price: 700, stock: 3 },
          { name: "10mg", price: 1200 },
        ],
      } as Partial<Product>),
    ],
    STORE.currency,
  );
  assert.equal(rows.length, 2);
  const idx = (c: string) => PRODUCT_COLUMNS.indexOf(c);
  assert.equal(rows[0][idx("Variation")], "5mg");
  assert.equal(rows[0][idx("Price")], 700);
  assert.equal(rows[0][idx("Stock")], 3);
  assert.equal(rows[1][idx("Variation")], "10mg");
  assert.equal(rows[1][idx("Price")], 1200);
  // Both rows carry the same product id so the importer can regroup them.
  assert.equal(rows[0][idx("Product ID")], rows[1][idx("Product ID")]);
});

check("an option with no stock of its own falls back to the product's stock", () => {
  const rows = buildProductRows(
    [product({ stock: 8, variations: [{ name: "10mg", price: 1200 }] } as Partial<Product>)],
    STORE.currency,
  );
  assert.equal(rows[0][PRODUCT_COLUMNS.indexOf("Stock")], 8);
});

// ────────────────────────────── order history ───────────────────────────────
console.log("\nbuildOrderRows (J3 — order history that reconciles)");

check("the exported total is the SAME number the admin shows", () => {
  const o = order({
    items: [{ name: "BPC-157", qty: 2, price: 1200 }],
    discount: { code: "SAVE", label: "Save 100", amount: 100 },
    adminFee: { label: "Service fee", amount: 50 },
  });
  const [row] = buildOrderRows([o]);
  assert.equal(row[ORDER_COLUMNS.indexOf("Total")], orderTotal(o));
  assert.equal(row[ORDER_COLUMNS.indexOf("Total")], 2400 - 100 + 150 + 50);
});

check("discount, shipping and admin fee are broken out as their own columns", () => {
  const [row] = buildOrderRows([
    order({
      discount: { code: "SAVE", label: "Save 100", amount: 100 },
      adminFee: { label: "Service fee", amount: 50 },
    }),
  ]);
  const cells = Object.fromEntries(ORDER_COLUMNS.map((c, i) => [c, row[i]]));
  assert.equal(cells["Discount Code"], "SAVE");
  assert.equal(cells["Discount Amount"], 100);
  assert.equal(cells["Shipping Fee"], 150);
  assert.equal(cells["Admin Fee"], 50);
  assert.equal(cells["Items Subtotal"], 2400);
});

check("the customer and full shipping address ride with the order", () => {
  const [row] = buildOrderRows([order()]);
  const cells = Object.fromEntries(ORDER_COLUMNS.map((c, i) => [c, row[i]]));
  assert.equal(cells["Customer Name"], "Ana Cruz");
  assert.equal(cells["Email"], "ana@example.com");
  assert.equal(cells["Phone"], "09171234567");
  assert.equal(cells["Address"], "12 Mabini St");
  assert.equal(cells["City"], "Davao");
});

check("a trashed order is exported and FLAGGED, never silently dropped (J7)", () => {
  const rows = buildOrderRows([order(), order({ id: "o2", orderNumber: "ABC-1002", deletedAt: AT })]);
  const idx = ORDER_COLUMNS.indexOf("Deleted");
  assert.ok(idx >= 0, "there is a Deleted column");
  assert.equal(rows.length, 2);
  assert.equal(rows[0][idx], "No");
  assert.equal(rows[1][idx], "Yes");
});

check("buildOrderItemRows emits one row per LINE with its line total", () => {
  const rows = buildOrderItemRows([
    order({
      items: [
        { name: "BPC-157 10mg", qty: 2, price: 1200, productId: "p1", variation: "10mg" },
        { name: "TB-500", qty: 1, price: 900, productId: "p2" },
      ],
    }),
  ]);
  assert.equal(rows.length, 2);
  const idx = (c: string) => ORDER_ITEM_COLUMNS.indexOf(c);
  assert.equal(rows[0][idx("Qty")], 2);
  assert.equal(rows[0][idx("Unit Price")], 1200);
  assert.equal(rows[0][idx("Line Total")], 2400);
  assert.equal(rows[0][idx("Variation")], "10mg");
  assert.equal(rows[0][idx("Order Number")], "ABC-1001");
});

// ──────────────────────────────── customers ─────────────────────────────────
console.log("\nbuildCustomerRecords (J2 — the customer relationships)");

check("repeat orders from one email collapse into ONE customer", () => {
  const records = buildCustomerRecords([
    order({ id: "a", date: "2026-01-05T00:00:00.000Z" }),
    order({ id: "b", date: "2026-03-01T00:00:00.000Z" }),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].orders, 2);
});

check("email matching ignores case and surrounding space", () => {
  const records = buildCustomerRecords([
    order({ id: "a", customer: { name: "Ana", email: "ANA@example.com ", phone: "", contactMethod: "" } }),
    order({ id: "b", customer: { name: "Ana Cruz", email: "ana@example.com", phone: "", contactMethod: "" } }),
  ]);
  assert.equal(records.length, 1, "one person, not two");
});

check("lifetime spend sums the order totals and EXCLUDES cancelled orders", () => {
  const records = buildCustomerRecords([
    order({ id: "a" }),
    order({ id: "b", status: "cancelled" }),
  ]);
  const [c] = records;
  assert.equal(c.orders, 2, "the cancelled order is still part of their history");
  assert.equal(c.cancelledOrders, 1);
  assert.equal(c.totalSpent, 2400 + 150, "only the live order's money counts");
});

check("first and last order dates bracket the relationship", () => {
  const [c] = buildCustomerRecords([
    order({ id: "b", date: "2026-03-01T00:00:00.000Z" }),
    order({ id: "a", date: "2026-01-05T00:00:00.000Z" }),
  ]);
  assert.equal(c.firstOrderAt, "2026-01-05T00:00:00.000Z");
  assert.equal(c.lastOrderAt, "2026-03-01T00:00:00.000Z");
});

check("a customer with no email is keyed on their phone, then their name", () => {
  const byPhone = buildCustomerRecords([
    order({ id: "a", customer: { name: "Walk In", email: "", phone: "0917 123 4567", contactMethod: "" } }),
    order({ id: "b", customer: { name: "walk in", email: "", phone: "09171234567", contactMethod: "" } }),
  ]);
  assert.equal(byPhone.length, 1, "same phone, punctuation aside, is one person");

  const byName = buildCustomerRecords([
    order({ id: "a", customer: { name: "Jun", email: "", phone: "", contactMethod: "" } }),
    order({ id: "b", customer: { name: "Jun", email: "", phone: "", contactMethod: "" } }),
  ]);
  assert.equal(byName.length, 1);
});

check("two different people are never merged", () => {
  const records = buildCustomerRecords([
    order({ id: "a", customer: { name: "Ana", email: "ana@example.com", phone: "", contactMethod: "" } }),
    order({ id: "b", customer: { name: "Ben", email: "ben@example.com", phone: "", contactMethod: "" } }),
  ]);
  assert.equal(records.length, 2);
});

check("an order with no identifiable customer is skipped, not exported as a blank row", () => {
  const records = buildCustomerRecords([
    order({ id: "a", customer: { name: "", email: "", phone: "", contactMethod: "" } }),
  ]);
  assert.deepEqual(records, []);
});

check("the customer's latest known address and contact method are kept", () => {
  const [c] = buildCustomerRecords([
    order({ id: "a", date: "2026-01-05T00:00:00.000Z" }),
    order({
      id: "b",
      date: "2026-03-01T00:00:00.000Z",
      shipping: { ...order().shipping, address: "99 New Rd", city: "Cebu" },
    }),
  ]);
  assert.equal(c.address, "99 New Rd", "the newest address wins");
  assert.equal(c.city, "Cebu");
  assert.equal(c.contactMethod, "messenger");
});

// ───────────────────────────────── the bundle ───────────────────────────────
console.log("\nbuildDataExport (J4/J7 — the downloadable bundle)");

const BUNDLE = buildDataExport({
  store: STORE,
  products: [product(), product({ id: "p2", name: "TB-500", price: 900 })],
  orders: [order()],
  trashedOrders: [order({ id: "o2", orderNumber: "ABC-1002", deletedAt: AT })],
  generatedAt: AT,
});

check("the bundle ships products, orders, order items, customers and a JSON dump", () => {
  const names = BUNDLE.files.map((f) => f.filename);
  for (const part of ["products", "orders", "order-items", "customers", "store-data"]) {
    assert.ok(names.some((n) => n.includes(part)), `missing ${part}: ${names.join(", ")}`);
  }
  assert.equal(BUNDLE.files.length, 5);
});

check("filenames carry the store slug and the export date", () => {
  for (const f of BUNDLE.files) {
    assert.ok(f.filename.startsWith("hpglow-"), `not slugged: ${f.filename}`);
    assert.ok(f.filename.includes("2026-08-19"), `not dated: ${f.filename}`);
  }
});

check("every CSV starts with its header row", () => {
  const header = (part: string) =>
    BUNDLE.files.find((f) => f.filename.includes(part))!.content.split("\n")[0];
  assert.equal(header("-products-"), PRODUCT_COLUMNS.join(","));
  assert.equal(header("-orders-"), ORDER_COLUMNS.join(","));
  assert.equal(header("-order-items-"), ORDER_ITEM_COLUMNS.join(","));
  assert.equal(header("-customers-"), CUSTOMER_COLUMNS.join(","));
});

check("trashed orders are included in the export, so nothing is left behind", () => {
  const orders = BUNDLE.files.find((f) => f.filename.includes("-orders-"))!.content;
  assert.ok(orders.includes("ABC-1002"), "the trashed order is exported");
  assert.equal(BUNDLE.counts.orders, 2);
});

check("the JSON dump parses and mirrors the CSVs", () => {
  const json = BUNDLE.files.find((f) => f.filename.includes("store-data"))!;
  assert.equal(json.mime, "application/json");
  const data = JSON.parse(json.content);
  assert.equal(data.store.slug, "hpglow");
  assert.equal(data.exportedAt, AT);
  assert.equal(data.products.length, 2);
  assert.equal(data.orders.length, 2);
  assert.equal(data.customers.length, BUNDLE.counts.customers);
});

check("the CSV files declare a CSV mime type so the browser saves them as files", () => {
  for (const f of BUNDLE.files.filter((x) => x.filename.endsWith(".csv"))) {
    assert.ok(f.mime.startsWith("text/csv"), `${f.filename} → ${f.mime}`);
  }
});

check("an empty store still produces header-only files, never zero-byte ones (J7)", () => {
  const empty = buildDataExport({ store: STORE, products: [], orders: [], generatedAt: AT });
  assert.equal(empty.files.length, 5);
  for (const f of empty.files) assert.ok(f.content.length > 0, `${f.filename} is empty`);
  const products = empty.files.find((f) => f.filename.includes("products"))!;
  assert.equal(products.content, PRODUCT_COLUMNS.join(","));
  assert.equal(empty.counts.orders, 0);
});

check("a hostile product name cannot smuggle a formula into the owner's spreadsheet", () => {
  const bundle = buildDataExport({
    store: STORE,
    products: [product({ name: "=HYPERLINK(\"http://evil\",\"click\")" })],
    orders: [],
    generatedAt: AT,
  });
  const csv = bundle.files.find((f) => f.filename.includes("products"))!.content;
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv), "a raw formula reached the CSV");
});

// ─────────────────────────── wiring (not just types) ────────────────────────
console.log("\nWiring — the surfaces actually call the core");

check("the export action exists and is OWNER-ONLY (J5)", () => {
  const a = src("src/actions/storefront-export.ts");
  assert.ok(/requireStoreOwner\(\)/.test(a), "guards with requireStoreOwner, so staff cannot export");
  assert.ok(!/requireStaffPermission\(/.test(a), "must not fall back to a staff-grantable module");
  assert.ok(/buildDataExport/.test(a), "returns the shared bundle, not a second implementation");
});

check("the export action is tenant-scoped", () => {
  const a = src("src/actions/storefront-export.ts");
  assert.ok(
    /listProductsAction|withTenant\(/.test(a),
    "reads through the tenant-scoped path, never a bare prisma.findMany",
  );
  assert.ok(!/prisma\.(product|storefrontOrder)\.findMany/.test(a), "no unscoped cross-tenant read");
});

check("export is NOT a staff-grantable module", () => {
  const p = src("src/storefront/admin/staff-permissions.ts");
  assert.ok(!/key: "export"/.test(p), "granting a staffer must never hand over the customer list");
});

check("the sidebar registers Export My Data as owner-only", () => {
  const nav = src("src/storefront/admin/admin-nav.ts");
  const line = nav.split("\n").find((l) => /view: "export"/.test(l));
  assert.ok(line, "no export entry in ADMIN_NAV");
  assert.ok(/ownerOnly: true/.test(line!), "the export entry must be ownerOnly");
});

check("AdminPage routes the export view to its panel", () => {
  const p = src("src/storefront/admin/AdminPage.tsx");
  assert.ok(/\| "export"/.test(p), "the View union knows the view");
  assert.ok(/AdminDataExport/.test(p), "the panel is rendered");
});

check("the export panel downloads through the action, not a client-side re-query", () => {
  const c = src("src/storefront/admin/AdminDataExport.tsx");
  assert.ok(/exportStoreDataAction/.test(c), "calls the server action");
  assert.ok(/download/.test(c), "triggers a real file download");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
