/**
 * END-TO-END: every product in a live group-buy round is added to the cart from
 * the group-buy PAGE, and every resulting cart / order line names the dose.
 *
 * WHY (k-glow, 2026-08-04): the card heading was fixed to carry the dose
 * (gbDisplayName), but the page had no option picker — "Join GB" added the raw
 * catalog row. cartDisplayName only appends a dose when exactly one option
 * exists, so 26 of the round's 36 products landed in the cart as a bare
 * "Tirzepatide" / "Retatrutide", at the BASE gbPrice, with no dose recorded on
 * the order the seller reads.
 *
 * This walks the real chain, product by product, in the order a customer does:
 *
 *   1. PAGE      buildGroupBuyPageView  → the round's cards, each with options
 *   2. PICK      defaultGbOptionIndex   → what the card has selected on load
 *   3. JOIN GB   gbCardAddition         → the exact addToCart(product, 1, variation) call
 *   4. CART      makeVariationEntry     → the entry the store pushes
 *   5. DRAWER    liveCartLines          → re-hydrated from the live catalog
 *   6. NAME      cartDisplayName        → what checkout shows AND persists
 *   7. PRICE     unitPrice              → what the cart charges
 *   8. SERVER    authoritativeItemPrice → what placement re-derives
 *
 * Fixtures are the real k-glow shapes (see scripts/inspect-kglow-gb-names.ts):
 * multi-dose rows, a single-variation row, a row whose NAME already carries the
 * dose, a doseless row, a row with a distinct base price ("Standard" leads the
 * option list), and a variation with no gbPrice of its own.
 *
 *   npm run test:gb-cart-doses
 */

import assert from "node:assert";

import {
  buildGroupBuyPageView,
  defaultGbOptionIndex,
  gbCardAddition,
  gbPageOptions,
} from "../src/lib/storefront/group-buy-page";
import {
  authoritativeItemPrice,
  baseProductId,
  buildOrderMessage,
  cartDisplayName,
  liveCartLines,
  makeVariationEntry,
  unitPrice,
} from "../src/storefront/checkout";
import { gbScopeFromBanner } from "../src/lib/storefront/two-ways-cart";
import { hasDoseToken } from "../src/lib/storefront/variations";
import type { GroupBuyBanner } from "../src/lib/storefront/group-buy-banner";
import type { Brand, Product } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A catalog row carrying the fields the page + cart read; the rest is filler. */
function product(over: Partial<Product> & { name: string; price: number }): Product {
  return {
    id: over.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: "",
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    stock: 0, // group-buy lines are pre-orders — stock never gates them
    productType: "gb",
    ...over,
  } as Product;
}

// ───────────────────────── the round's catalog ───────────────────────────────

/** Several doses, priced per size. The base price equals the first variation, so
 *  no "Standard" option is offered (the k-glow shape). */
const tirzepatide = product({
  name: "Tirzepatide",
  price: 5000,
  gbPrice: 3866,
  variations: [
    { name: "5mg × 10 vials", price: 5000, gbPrice: 3866 },
    { name: "10mg × 10 vials", price: 7000, gbPrice: 5500 },
    { name: "60mg × 10 vials", price: 14000, gbPrice: 11800 },
  ],
});

/** The live undercharge that started this: the 30mg option carries NO gbPrice,
 *  so it must sell at its own price, never at the base option's group price. */
const retatrutide = product({
  name: "Retatrutide",
  price: 4000,
  gbPrice: 3866,
  variations: [
    { name: "5mg × 10 vials", price: 4000, gbPrice: 3866 },
    { name: "30mg × 10 vials", price: 9924 },
  ],
});

/** One variation only, priced at the base — the card shows one option. */
const semaglutide = product({
  name: "Semaglutide",
  price: 4340,
  gbPrice: 3900,
  variations: [{ name: "5mg × 10 vials", price: 4340, gbPrice: 3900 }],
});

/** A DISTINCT base price, so buildProductOptions leads with "Standard" — the
 *  trap: a card defaulting to option 0 would add a doseless entry. */
const semax = product({
  name: "Semax",
  price: 3000,
  gbPrice: 2600,
  variations: [
    { name: "5mg × 10 vials", price: 3500, gbPrice: 3000 },
    { name: "10mg × 10 vials", price: 4500, gbPrice: 4000 },
  ],
});

/** The name already carries its dose — nothing may be appended twice. */
const lemonBottle = product({
  name: "Lemon Bottle 10ml",
  price: 1200,
  gbPrice: 1000,
  variations: [
    { name: "10ml", price: 1200, gbPrice: 1000 },
    { name: "50ml", price: 3000, gbPrice: 2600 },
  ],
});

/** An option with no dose at all — the option name must still survive. */
const kpv = product({
  name: "KPV",
  price: 2000,
  gbPrice: 1800,
  variations: [{ name: "5 vials", price: 2000, gbPrice: 1800 }],
});

/** No variations and no dose anywhere — there is nothing to display. */
const bbg70 = product({ name: "BBG70 klow", price: 1500, gbPrice: 1300 });

/** Paused by the owner (Group Buys → Pricing): listed, not joinable. */
const pinealon = product({
  name: "Pinealon",
  price: 2200,
  gbPrice: 2000,
  purchasable: false,
  variations: [{ name: "10mg × 10 vials", price: 2200, gbPrice: 2000 }],
});

const CATALOG: Product[] = [
  tirzepatide,
  retatrutide,
  semaglutide,
  semax,
  lemonBottle,
  kpv,
  bbg70,
  pinealon,
];

const BANNER: GroupBuyBanner = {
  id: "gb-round-1",
  name: "check out now",
  description: "",
  deliveryEta: "3–4 weeks",
  endsAt: null,
  slotGoal: 0,
  filled: 0,
  coversAll: false,
  productIds: CATALOG.map((p) => p.id),
} as GroupBuyBanner;

const SCOPE = gbScopeFromBanner(BANNER);
const CURRENCY = "₱";

const view = buildGroupBuyPageView(CATALOG, BANNER, CURRENCY);
type PageLine = (typeof view)["lines"][number];

/** The card's "Join GB" click: take the option the card has selected and hand it
 *  to addToCart exactly as the component does (store.addToCart then clones it
 *  through makeVariationEntry). */
function joinGb(line: PageLine): Product {
  const add = gbCardAddition(line, line.defaultOptionIndex);
  return add.variation ? makeVariationEntry(add.product, add.variation) : add.product;
}

function main() {
  console.log("\nthe round lists every assigned product\n");

  check("all 8 assigned products are on the page", () => {
    assert.equal(view.live, true);
    assert.equal(view.count, CATALOG.length);
  });

  console.log("\nADD ALL — every joinable product's cart line names its dose\n");

  const joinable = view.lines.filter((l) => l.product.purchasable !== false);

  check("every joinable product carries a dose into the cart when the seller recorded one", () => {
    const missing: string[] = [];
    for (const line of joinable) {
      const p = line.product;
      const sellerHasDose =
        hasDoseToken(p.name) || (p.variations ?? []).some((v) => hasDoseToken(v.name));
      if (!sellerHasDose) continue;
      const name = cartDisplayName(joinGb(line));
      if (!hasDoseToken(name)) missing.push(`${p.name} → "${name}"`);
    }
    assert.deepEqual(missing, [], `cart lines with the mg missing: ${missing.join(", ")}`);
  });

  check("the only doseless cart lines are the products the seller gave no dose", () => {
    const doseless = joinable
      .map((line) => cartDisplayName(joinGb(line)))
      .filter((name) => !hasDoseToken(name));
    assert.deepEqual(doseless, ["KPV — 5 vials", "BBG70 klow"]);
  });

  check("every cart line names the option the card had selected", () => {
    for (const line of joinable) {
      const entry = joinGb(line);
      if (!entry.variantName) continue;
      const name = cartDisplayName(entry);
      assert.ok(
        name.includes(entry.variantName),
        `"${name}" does not name the chosen option "${entry.variantName}"`,
      );
    }
  });

  console.log("\nper product — the exact name checkout shows and persists\n");

  const nameOf = (p: Product) =>
    cartDisplayName(joinGb(view.lines.find((l) => l.product.id === p.id)!));

  check("multi-dose Tirzepatide → the first dose, not a bare name", () => {
    assert.equal(nameOf(tirzepatide), "Tirzepatide — 5mg × 10 vials");
  });
  check("Retatrutide → its first dose", () => {
    assert.equal(nameOf(retatrutide), "Retatrutide — 5mg × 10 vials");
  });
  check("single-variation Semaglutide → one line, dose appended once", () => {
    assert.equal(nameOf(semaglutide), "Semaglutide — 5mg × 10 vials");
  });
  check("a distinct base price does NOT default the card to doseless 'Standard'", () => {
    assert.equal(nameOf(semax), "Semax — 5mg × 10 vials");
  });
  check("a name that already carries its dose is not doubled", () => {
    assert.equal(nameOf(lemonBottle), "Lemon Bottle 10ml — 10ml");
  });
  check("a doseless option still names itself", () => {
    assert.equal(nameOf(kpv), "KPV — 5 vials");
  });
  check("a product with no options at all is added bare", () => {
    assert.equal(nameOf(bbg70), "BBG70 klow");
  });

  console.log("\nthe picked option is what the customer is CHARGED\n");

  check("each cart line is charged its own option's group-buy price", () => {
    for (const line of joinable) {
      const entry = joinGb(line);
      const option = gbPageOptions(line.product, CURRENCY)[line.defaultOptionIndex];
      const charged = unitPrice(entry, 1, SCOPE);
      assert.equal(
        charged,
        option ? option.price : line.price,
        `${line.product.name} charged ${charged}, card advertised ${option?.price ?? line.price}`,
      );
    }
  });

  check("a variation with no gbPrice sells at its own price, not the base group price", () => {
    const line = view.lines.find((l) => l.product.id === retatrutide.id)!;
    const add = gbCardAddition(line, 1); // the 30mg option
    const entry = makeVariationEntry(add.product, add.variation!);
    assert.equal(cartDisplayName(entry), "Retatrutide — 30mg × 10 vials");
    assert.equal(unitPrice(entry, 1, SCOPE), 9924);
  });

  check("the server re-derives the same price for every line", () => {
    for (const line of joinable) {
      const entry = joinGb(line);
      const server = authoritativeItemPrice(
        {
          productId: baseProductId(entry),
          name: cartDisplayName(entry),
          qty: 1,
          variation: entry.variantName,
        },
        CATALOG,
        SCOPE,
      );
      assert.equal(server, unitPrice(entry, 1, SCOPE), `${line.product.name} price disagreed`);
    }
  });

  console.log("\nthe checkout drawer + the order the seller reads\n");

  const cart = joinable.map(joinGb);

  check("re-hydrating the cart from the live catalog keeps every dose", () => {
    const lines = liveCartLines(cart, CATALOG);
    assert.equal(lines.length, joinable.length);
    for (const l of lines) {
      const p = l.product;
      const sellerHasDose =
        hasDoseToken(p.name) || (p.variations ?? []).some((v) => hasDoseToken(v.name));
      if (!sellerHasDose) continue;
      assert.ok(hasDoseToken(cartDisplayName(p)), `${p.name} lost its dose on re-hydration`);
    }
  });

  check("the order message names each dose", () => {
    const brand = { currency: CURRENCY, contactChannels: [] } as unknown as Brand;
    const message = buildOrderMessage(brand, liveCartLines(cart, CATALOG), {
      name: "Test Buyer",
      email: "",
      phone: "",
      address: "",
      barangay: "",
      city: "",
      province: "",
      postal: "",
    });
    for (const expected of [
      "Tirzepatide — 5mg × 10 vials",
      "Retatrutide — 5mg × 10 vials",
      "Semaglutide — 5mg × 10 vials",
      "Semax — 5mg × 10 vials",
    ]) {
      assert.ok(message.includes(expected), `order message is missing "${expected}"`);
    }
  });

  console.log("\nthe card's option list + default pick\n");

  check("a paused product is still listed but offers no join", () => {
    const line = view.lines.find((l) => l.product.id === pinealon.id)!;
    assert.equal(line.product.purchasable, false);
  });

  check("options are priced at the group-buy price, not the regular one", () => {
    const options = gbPageOptions(tirzepatide, CURRENCY);
    assert.deepEqual(
      options.map((o) => [o.name, o.price, o.priceLabel]),
      [
        ["5mg × 10 vials", 3866, "₱3,866"],
        ["10mg × 10 vials", 5500, "₱5,500"],
        ["60mg × 10 vials", 11800, "₱11,800"],
      ],
    );
  });

  check("a product with no variations offers no options", () => {
    assert.deepEqual(gbPageOptions(bbg70, CURRENCY), []);
  });

  check("the default pick is the first option carrying a dose", () => {
    assert.equal(defaultGbOptionIndex(gbPageOptions(semax, CURRENCY)), 1); // skips "Standard"
    assert.equal(defaultGbOptionIndex(gbPageOptions(tirzepatide, CURRENCY)), 0);
  });

  check("with no dosed option anywhere the default is the first option", () => {
    assert.equal(defaultGbOptionIndex(gbPageOptions(kpv, CURRENCY)), 0);
    assert.equal(defaultGbOptionIndex([]), 0);
  });

  check("an out-of-range pick falls back to the default option, never crashes", () => {
    const line = view.lines.find((l) => l.product.id === tirzepatide.id)!;
    assert.equal(gbCardAddition(line, 99).variation?.name, "5mg × 10 vials");
    assert.equal(gbCardAddition(line, -1).variation?.name, "5mg × 10 vials");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
