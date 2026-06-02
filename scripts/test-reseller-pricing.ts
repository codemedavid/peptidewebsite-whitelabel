/**
 * Pure-function test for the reseller (wholesale) pricing rules in
 * src/storefront/checkout.ts. No DB / React — just the pricing math.
 *
 *   npx tsx scripts/test-reseller-pricing.ts
 */
import {
  cartLines,
  cartTotal,
  isResellerQty,
  resellerTierLabel,
  unitPrice,
  buildOrderMessage,
  type CartLine,
} from "../src/storefront/checkout";
import type { Brand, Product } from "../src/storefront/types";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : `  (expected ${JSON.stringify(want)})`}`);
  if (!ok) failures++;
}

function product(over: Partial<Product>): Product {
  return {
    id: over.name ?? "p", name: "P", description: "", price: 0, currency: "₱",
    category: "", featured: false, image: null, ...over,
  } as Product;
}

const tirz15 = product({ id: "t15", name: "Tirzepatide 15 mg", price: 1800, reseller: { vialsOnly: 1200, completeSet: 1450 } });
const tirz30 = product({ id: "t30", name: "Tirzepatide 30 mg", price: 2450, reseller: { vialsOnly: 1600, completeSet: 1850 } });
const nad = product({ id: "nad", name: "NAD+ 500 mg", price: 1700, reseller: { vialsOnly: 1300 } });
const ghk = product({ id: "ghk", name: "GHK-Cu 100 mg", price: 1500, reseller: { vialsOnly: 1150 } });
const lemon = product({ id: "lemon", name: "Lemon Bottle 10 ml", price: 850 }); // excluded — no reseller
const promo = product({ id: "promo", name: "Promo item", price: 1700, discountEnabled: true, discountPrice: 999, reseller: { vialsOnly: 1300 } });

console.log("── unit price: threshold is per-product, kicks in at 10 ──");
eq("Tirz15 qty 1", unitPrice(tirz15, 1), 1800);
eq("Tirz15 qty 9 (below)", unitPrice(tirz15, 9), 1800);
eq("Tirz15 qty 10 → Complete Set", unitPrice(tirz15, 10), 1450);
eq("Tirz30 qty 10 → Complete Set", unitPrice(tirz30, 10), 1850);
eq("NAD qty 10 → Vials Only", unitPrice(nad, 10), 1300);
eq("GHK qty 10 → Vials Only", unitPrice(ghk, 10), 1150);
eq("Lemon qty 10 → retail (excluded)", unitPrice(lemon, 10), 850);
eq("default qty (no arg) → retail", unitPrice(tirz15), 1800);

console.log("\n── discount vs reseller precedence ──");
eq("Promo qty 1 → discount", unitPrice(promo, 1), 999);
eq("Promo qty 10 → reseller wins", unitPrice(promo, 10), 1300);

console.log("\n── tier labels ──");
eq("Tirz tier", resellerTierLabel(tirz15), "Complete set");
eq("NAD tier", resellerTierLabel(nad), "Vials only");
eq("Lemon tier", resellerTierLabel(lemon), null);

console.log("\n── isResellerQty ──");
eq("Tirz 9 active?", isResellerQty(tirz15, 9), false);
eq("Tirz 10 active?", isResellerQty(tirz15, 10), true);
eq("Lemon 10 active?", isResellerQty(lemon, 10), false);

console.log("\n── cartTotal: mixed cart, per-product threshold ──");
const mixed: CartLine[] = [
  { product: tirz15, qty: 10 }, // 10 × 1450 = 14500 (wholesale)
  { product: nad, qty: 5 },     //  5 × 1700 =  8500 (retail — below threshold)
];
eq("mixed total (15 items, only Tirz qualifies)", cartTotal(mixed), 14500 + 8500);

console.log("\n── cartLines grouping then pricing ──");
const flat = [tirz15, tirz15, tirz15]; // 3 units → still retail
eq("cartLines groups 3 → one line qty 3", cartLines(flat).map((l) => l.qty), [3]);
eq("3-unit line total = retail", cartTotal(cartLines(flat)), 3 * 1800);

console.log("\n── order message annotates wholesale lines ──");
const brand = { name: "Peppies Intl", currency: "₱", contactChannels: [] } as unknown as Brand;
const msg = buildOrderMessage(
  brand,
  [{ product: tirz15, qty: 10 }, { product: nad, qty: 5 }],
  { name: "A", email: "a@b.c", phone: "1", address: "x", city: "y", province: "z", postal: "", country: "PH" },
);
const hasResellerTag = msg.includes("Tirzepatide 15 mg ×10") && msg.includes("reseller — complete set @ ₱1,450/ea");
const nadNoTag = msg.includes("NAD+ 500 mg ×5") && !/NAD\+ 500 mg ×5.*reseller/.test(msg);
const totalLine = msg.includes("Total: ₱23,000");
eq("message: Tirz line tagged reseller", hasResellerTag, true);
eq("message: NAD line NOT tagged", nadNoTag, true);
eq("message: total = 23,000", totalLine, true);

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : `${failures} FAILED ❌`}`);
process.exit(failures === 0 ? 0 : 1);
