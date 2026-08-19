/**
 * Combined-variant wholesale (MOQ) pricing.
 *
 * BUSINESS RULE
 *   Wholesale MOQ + wholesale unit price are configured ONCE on the PARENT
 *   product. Every variation shares them, and the quantities of all variations
 *   COMBINE toward the one MOQ. Once the combined quantity reaches the MOQ, the
 *   wholesale unit price applies to the whole quantity.
 *
 *     Vial Caps — retail P10, wholesale P7, MOQ 1,000
 *       Red 250 + Black 250 + Blue 250 + Yellow 250 = 1,000  ->  all at P7
 *
 * WHAT THIS FILE PINS
 *   - the combined-variant rule itself (the five cases that were RED)
 *   - the MOQ as a floor, never a cap
 *   - parents evaluated independently — quantities never pool across products
 *   - bulk can never RAISE a per-unit price
 *   - the entitlement gate: no wholesale entitlement, no scope, no wholesale
 *   - the LEGACY `reseller` leg still prices live stores exactly as it does
 *     today, and still never reaches a variation
 *
 * The cases were first written against the legacy `reseller` leg (the only shape
 * the Product type carried at the time) and failed 5/8. They are now expressed
 * through `wholesale`, the config Product Management actually writes; every
 * assertion and every expected number is unchanged from the RED run.
 *
 *   npx tsx scripts/test-wholesale-pricing.ts
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_CUSTOMER,
  buildOrderMessage,
  cartLines,
  cartTotal,
  makeVariationEntry,
  unitPrice,
  type CartLine,
} from "../src/storefront/checkout";
import {
  buildWholesaleScope,
  wholesaleRemaining,
  type WholesaleScope,
} from "../src/lib/storefront/wholesale";
import type { Brand, Product } from "../src/storefront/types";

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

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Product",
    description: "",
    price: 10,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 100000,
    ...p,
  };
}

// ── The scenario ─────────────────────────────────────────────────────────────
// One parent product, four colour variations, one wholesale rule on the parent.
const VIAL_CAPS = product({
  id: "vial-caps",
  name: "Vial Caps",
  price: 10,
  wholesale: { enabled: true, moq: 1000, price: 7 },
  variations: [
    { name: "Red", price: 10 },
    { name: "Black", price: 10 },
    { name: "Blue", price: 10 },
    { name: "Yellow", price: 10 },
  ],
});

// A second parent with its OWN, independent rule (§13).
const SYRINGES = product({
  id: "syringes",
  name: "Syringes",
  price: 5,
  wholesale: { enabled: true, moq: 500, price: 3.5 },
});

/** The cart entry for one chosen colour, exactly as the storefront builds it. */
function pick(parent: Product, variation: string): Product {
  const v = (parent.variations ?? []).find((x) => x.name === variation);
  assert.ok(v, `no such variation: ${variation}`);
  return makeVariationEntry(parent, v);
}

/** A cart of { variation → qty } for one parent, as deduplicated cart lines. */
function cart(parent: Product, picks: Record<string, number>): CartLine[] {
  const flat: Product[] = [];
  for (const [name, qty] of Object.entries(picks)) {
    const entry = pick(parent, name);
    for (let i = 0; i < qty; i++) flat.push(entry);
  }
  return cartLines(flat);
}

/** The cart-level wholesale context, as an entitled storefront builds it. */
function scope(lines: CartLine[], entitled = true): WholesaleScope | null {
  return buildWholesaleScope(lines, entitled);
}

// ── Control: the harness is sound ────────────────────────────────────────────
// A product with NO variations prices at wholesale on a single line, with no
// cart scope at all — the per-line path every existing caller still uses.

check("control: a single line of a no-variation product prices at wholesale", () => {
  assert.strictEqual(unitPrice(SYRINGES, 500), 3.5);
  assert.strictEqual(unitPrice(SYRINGES, 499), 5, "below MOQ stays retail");
});

// ── The rule: combined variant quantities reach one parent MOQ ───────────────

check("4 × 250 colours = 1,000 → every line prices at the ₱7 wholesale price", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250, Yellow: 250 });
  const ws = scope(lines);
  assert.strictEqual(lines.length, 4, "one line per colour");
  for (const l of lines) {
    assert.strictEqual(
      unitPrice(l.product, l.qty, null, ws),
      7,
      `${l.product.name} should price at wholesale (combined qty is 1,000)`,
    );
  }
});

check("4 × 250 colours = 1,000 → cart total is 1,000 × ₱7", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250, Yellow: 250 });
  assert.strictEqual(cartTotal(lines, null, scope(lines)), 7000);
});

check("uneven split still combines: 100 + 400 + 300 + 200 = 1,000 → ₱7", () => {
  const lines = cart(VIAL_CAPS, { Red: 100, Black: 400, Blue: 300, Yellow: 200 });
  assert.strictEqual(cartTotal(lines, null, scope(lines)), 7000);
});

// ── §12: the MOQ is a floor, never a cap ─────────────────────────────────────

check("above MOQ: 1,250 combined units ALL price at ₱7 (not just the first 1,000)", () => {
  const lines = cart(VIAL_CAPS, { Red: 500, Black: 500, Blue: 250 });
  assert.strictEqual(cartTotal(lines, null, scope(lines)), 1250 * 7);
});

// ── §13: parents are evaluated independently ─────────────────────────────────

check("below MOQ stays retail: 250 + 250 + 250 = 750 of 1,000", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250 });
  assert.strictEqual(cartTotal(lines, null, scope(lines)), 750 * 10, "750 short of the MOQ → retail");
});

check("quantities NEVER pool across different parent products", () => {
  // Vial Caps 800/1,000 and Syringes 300/500 — neither qualifies, and their
  // 1,100 combined units must not unlock either rule.
  const caps = cart(VIAL_CAPS, { Red: 400, Black: 400 });
  const syringes: CartLine[] = [{ product: SYRINGES, qty: 300 }];
  const ws = scope([...caps, ...syringes]);
  assert.strictEqual(cartTotal(caps, null, ws), 800 * 10, "Vial Caps stays retail");
  assert.strictEqual(cartTotal(syringes, null, ws), 300 * 5, "Syringes stays retail");
});

// ── Option A: bulk can never RAISE a per-unit price ──────────────────────────

check("a variation priced below the wholesale price keeps its cheaper price", () => {
  const mixed = product({
    ...VIAL_CAPS,
    id: "vial-caps-mixed",
    variations: [
      { name: "Red", price: 10 },
      { name: "Black", price: 10 },
      { name: "Yellow", price: 6 }, // already cheaper than the ₱7 wholesale price
    ],
  });
  const lines = cart(mixed, { Red: 400, Black: 400, Yellow: 200 });
  const ws = scope(lines);
  const priceOf = (name: string) => {
    const l = lines.find((x) => x.product.variantName === name);
    assert.ok(l, `missing line: ${name}`);
    return unitPrice(l.product, l.qty, null, ws);
  };
  assert.strictEqual(priceOf("Red"), 7, "₱10 → ₱7");
  assert.strictEqual(priceOf("Black"), 7, "₱10 → ₱7");
  assert.strictEqual(priceOf("Yellow"), 6, "₱6 stays ₱6 — bulk must never raise a price");
});

// ── §16 / §17: the two gates ─────────────────────────────────────────────────

check("no wholesale entitlement → no scope → the cart stays at retail", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250, Yellow: 250 });
  assert.strictEqual(buildWholesaleScope(lines, false), null, "an unentitled tenant builds no scope");
  assert.strictEqual(cartTotal(lines, null, scope(lines, false)), 1000 * 10);
});

check("wholesale disabled on the product → retail at every quantity", () => {
  const off = product({
    ...VIAL_CAPS,
    id: "vial-caps-off",
    wholesale: { enabled: false, moq: 1000, price: 7 },
  });
  const lines = cart(off, { Red: 500, Black: 500 });
  assert.strictEqual(cartTotal(lines, null, scope(lines)), 1000 * 10);
});

check("an incomplete config is not a rule: MOQ 0 and price 0 both stay at retail", () => {
  const noMoq = product({ id: "no-moq", price: 10, wholesale: { enabled: true, moq: 0, price: 7 } });
  const noPrice = product({ id: "no-price", price: 10, wholesale: { enabled: true, moq: 100, price: 0 } });
  assert.strictEqual(unitPrice(noMoq, 5000), 10, "MOQ 0 must not price everything at wholesale");
  assert.strictEqual(unitPrice(noPrice, 5000), 10, "a price of 0 is not a wholesale tier");
});

// ── Regression: the legacy `reseller` leg is untouched ───────────────────────
// Live stores (peppies-intl) price off the old two-tier leg. Their behavior must
// be byte-identical: per-line MOQ, complete-set preferred, and NO wholesale on a
// variation (makeVariationEntry drops `reseller`, and always has).

check("legacy reseller leg: per-line MOQ and complete-set price still apply", () => {
  const legacy = product({
    id: "legacy",
    price: 100,
    reseller: { vialsOnly: 80, completeSet: 70, minQty: 10 },
  });
  assert.strictEqual(unitPrice(legacy, 9), 100, "below minQty → retail");
  assert.strictEqual(unitPrice(legacy, 10), 70, "complete set wins over vials only");
});

check("legacy reseller leg: minQty defaults to 10 when unset", () => {
  const legacy = product({ id: "legacy-default", price: 100, reseller: { completeSet: 70 } });
  assert.strictEqual(unitPrice(legacy, 9), 100);
  assert.strictEqual(unitPrice(legacy, 10), 70);
});

check("legacy reseller leg never reaches a variation, scope or no scope", () => {
  const legacy = product({
    id: "legacy-variants",
    price: 100,
    reseller: { completeSet: 70, minQty: 10 },
    variations: [
      { name: "5mg", price: 100 },
      { name: "10mg", price: 150 },
    ],
  });
  const lines = cart(legacy, { "5mg": 40, "10mg": 40 });
  assert.strictEqual(
    cartTotal(lines, null, scope(lines)),
    40 * 100 + 40 * 150,
    "a legacy product's options price at their own price, exactly as today",
  );
});

// ── The cart's "buy N more" nudge counts the COMBINED quantity ───────────────

check("the nudge counts every option toward the same MOQ", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250 });
  const ws = scope(lines);
  // 750 of 1,000 — every line reports the same 250 remaining, because they all
  // count toward one number. Reporting per line (1,000 - 250 = 750) would tell
  // the customer to buy three times what they actually need.
  for (const l of lines) {
    assert.strictEqual(wholesaleRemaining(l.product, l.qty, ws), 250, l.product.name);
  }
});

check("the nudge is zero once the MOQ is reached, and for products with no rule", () => {
  const lines = cart(VIAL_CAPS, { Red: 500, Black: 500 });
  assert.strictEqual(wholesaleRemaining(lines[0].product, lines[0].qty, scope(lines)), 0);
  const plain = product({ id: "plain", price: 10 });
  assert.strictEqual(wholesaleRemaining(plain, 5, null), 0, "no rule, nothing to nudge");
});

check("the nudge never appears when wholesale would not actually be cheaper", () => {
  // A product whose wholesale price is not below its retail price can never
  // apply, so telling the customer to buy more would be a lie.
  const p = product({ id: "no-saving", price: 5, wholesale: { enabled: true, moq: 100, price: 9 } });
  assert.strictEqual(wholesaleRemaining(p, 10, null), 0);
});

// ── The cart component prices through the same scope ─────────────────────────

const cartSrc = readFileSync(
  join(process.cwd(), "src/storefront/components/CartCheckout.tsx"),
  "utf8",
);

check("CartCheckout builds one wholesale scope from the whole cart", () => {
  assert.match(cartSrc, /buildWholesaleScope\(\s*lines,/, "the scope must be built from the cart lines");
  assert.match(
    cartSrc,
    /brand\.wholesalePricing/,
    "and gated on the tenant's wholesale entitlement",
  );
});

check("every cart pricing call receives the wholesale scope", () => {
  const totals = cartSrc.match(/cartTotal\([^;]*?wholesaleScope/g) ?? [];
  assert.strictEqual(totals.length, 2, "both the live and snapshot totals");
  const units = cartSrc.match(/unitPrice\([^;]*?wholesaleScope/g) ?? [];
  assert.strictEqual(units.length, 2, "the stored order price AND the displayed price");
  assert.match(
    cartSrc,
    /isResellerQty\(l\.product, l\.qty, wholesaleScope\)/,
    "the wholesale badge must reflect the combined quantity too",
  );
});

// ── Review findings, 2026-08-19 ──────────────────────────────────────────────

check("the order message the SELLER receives quotes the wholesale price", () => {
  // buildOrderMessage writes the text that lands in sessionStorage and is sent
  // verbatim to the seller. Priced without the scope it quotes RETAIL line
  // totals while the cart, the stored order and the confirmation table all
  // charge wholesale — seller and system disagreeing on what is owed.
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250, Yellow: 250 });
  const ws = scope(lines);
  const msg = buildOrderMessage(
    { currency: "₱" } as Brand,
    lines,
    EMPTY_CUSTOMER,
    undefined,
    undefined,
    null,
    null,
    null,
    ws,
  );
  assert.ok(msg.includes("7,000"), `message must total 1,000 x P7; got:\n${msg}`);
  assert.ok(!msg.includes("10,000"), `message must not quote the retail total:\n${msg}`);
});

check("the order message never prints 'reseller — undefined'", () => {
  // isResellerQty resolves through resolveWholesale, so it is true for a product
  // configured only with the new block; resellerTierLabel reads p.reseller and
  // returns null for it, which rendered as the literal string "undefined".
  const p = product({ id: "solo", price: 10, wholesale: { enabled: true, moq: 100, price: 7 } });
  const lines: CartLine[] = [{ product: p, qty: 100 }];
  const msg = buildOrderMessage(
    { currency: "₱" } as Brand,
    lines,
    EMPTY_CUSTOMER,
    undefined,
    undefined,
    null,
    null,
    null,
    scope(lines),
  );
  // Assert on the ITEMS block: the message header separately interpolates the
  // order number, which this fixture does not supply.
  const itemLine = msg.split("\n").find((l) => l.startsWith("•")) ?? "";
  assert.ok(!itemLine.includes("undefined"), `no placeholder may leak into a line:\n${itemLine}`);
  assert.ok(itemLine.toLowerCase().includes("wholesale"), `the saving should be named:\n${itemLine}`);
});

check("turning the NEW wholesale block off does not kill LEGACY reseller pricing", () => {
  // cleanWholesale persists {enabled:false, moq, price} so the owner's numbers
  // survive the toggle. If resolveWholesale short-circuits on the disabled block
  // it never reaches the legacy leg, so an owner who enables wholesale on a
  // legacy product, saves, unchecks it and saves again silently destroys that
  // product's existing wholesale pricing.
  const p = product({
    id: "legacy-plus-disabled",
    price: 100,
    reseller: { completeSet: 70, minQty: 20 },
    wholesale: { enabled: false, moq: 1000, price: 7 },
  });
  assert.strictEqual(unitPrice(p, 20), 70, "the legacy tier must still apply");
  assert.strictEqual(unitPrice(p, 19), 100, "at the product's OWN minQty, not the global default");
});

check("an ENABLED new config still wins over a legacy leg", () => {
  const p = product({
    id: "both-live",
    price: 100,
    reseller: { completeSet: 70, minQty: 20 },
    wholesale: { enabled: true, moq: 50, price: 60 },
  });
  assert.strictEqual(unitPrice(p, 20), 100, "the new config's MOQ governs, not the legacy one");
  assert.strictEqual(unitPrice(p, 50), 60);
});

// ── The reseller page lists products on EITHER config ────────────────────────

const merchantSrc = readFileSync(
  join(process.cwd(), "src/storefront/pages/MerchantPage.tsx"),
  "utf8",
);

check("the reseller page lists wholesale-only products, not just legacy ones", () => {
  const flat = merchantSrc.replace(/\s+/g, " ");
  assert.ok(
    !flat.includes(".filter((p) => p.reseller && (p.reseller.vialsOnly || p.reseller.completeSet))"),
    "the row filter must not be legacy-only — a wholesale-only product never reaches the card",
  );
  assert.match(merchantSrc, /rows[\s\S]{0,400}resolveWholesale/, "rows must filter through the shared resolver");
});

check("the reseller page shows a wholesale price for the new config", () => {
  assert.match(
    merchantSrc,
    /merchant-card__tier[\s\S]{0,600}wholesale/i,
    "a product on the new config must render its wholesale price, not two blank legacy tiers",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
