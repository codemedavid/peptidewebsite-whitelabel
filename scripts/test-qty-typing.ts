/**
 * Self-contained test for TYPING a quantity instead of tapping "+" once per
 * piece.
 *
 * The complaint: every quantity control on the storefront was a −/+ stepper
 * around a read-only <span>. A customer ordering 12 vials had to tap "+" eleven
 * times; a reseller with a 50-unit MOQ, forty-nine times. Nothing was broken —
 * it was just unusable in bulk, which is exactly how this catalog sells.
 *
 * User journeys
 *   1. As a shopper buying 12 vials, I want to TYPE 12 into the quantity box,
 *      so ordering in bulk is one action instead of eleven.
 *   2. As a reseller whose product has a 50-unit minimum, I want a typed
 *      quantity below the MOQ to snap back up to it, so I can never build a
 *      line the wholesale price refuses.
 *   3. As a shopper, I want a typed quantity above what is in stock to cap at
 *      the available units, so I am told before checkout, not after.
 *   4. As a shopper who cleared the box to retype it, I want the field to stay
 *      empty while I type and settle on the minimum when I leave it — never a
 *      0-unit add-to-cart.
 *   5. As a shopper editing a line already in the cart, I want typing 5 to SET
 *      that line to 5 units, not to add 5 more on top.
 *   6. As a shopper buying a made-to-order item (no stock to count), I want to
 *      type any sensible quantity without an invisible cap.
 *
 * Two layers are covered:
 *   1. The pure helpers that decide what a typed quantity means:
 *        src/lib/storefront/qty-input.ts
 *   2. Structural guards proving the six quantity surfaces actually consume the
 *      shared typable field (and the cart-backed ones set an ABSOLUTE quantity
 *      through the store instead of looping "+"):
 *        Catalog card + quick-view modal, MerchantPage (wholesale),
 *        CartCheckout lines, TwoWaysHome on-hand rows, GroupBuyPage cards.
 *
 *   npm run test:qty-typing
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  QTY_INPUT_MAX,
  clampQty,
  commitQtyDraft,
  qtyDelta,
  sanitizeQtyDraft,
} from "../src/lib/storefront/qty-input";

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

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("\nTyped quantity — type the number instead of tapping + per piece\n");

// ───────────────────────────────── clampQty ─────────────────────────────────
console.log("clampQty");

check("keeps a quantity that is already inside the bounds", () => {
  assert.equal(clampQty(12, { min: 1, max: 20 }), 12);
});

check("floors to a whole number of pieces (you cannot buy 2.7 vials)", () => {
  assert.equal(clampQty(2.7, { min: 1, max: 20 }), 2);
});

check("raises a below-minimum quantity to the minimum (journey 2 — reseller MOQ)", () => {
  assert.equal(clampQty(3, { min: 50 }), 50);
});

check("caps at available stock (journey 3)", () => {
  assert.equal(clampQty(999, { min: 1, max: 12 }), 12);
});

check("defaults the minimum to 1, so a 0 or negative never reaches the cart", () => {
  assert.equal(clampQty(0), 1);
  assert.equal(clampQty(-5), 1);
});

check("an uncapped (made-to-order) product accepts a large quantity (journey 6)", () => {
  assert.equal(clampQty(400, { min: 1, max: Infinity }), 400);
});

check("never returns Infinity, even with no cap — the box must hold a real number", () => {
  assert.equal(clampQty(Infinity, { min: 1, max: Infinity }), QTY_INPUT_MAX);
});

check("a max below the min still yields the max (a sold-down line cannot grow)", () => {
  assert.equal(clampQty(50, { min: 50, max: 3 }), 3);
});

// ───────────────────────────── sanitizeQtyDraft ─────────────────────────────
console.log("\nsanitizeQtyDraft (what the box shows WHILE typing)");

check("passes digits through (journey 1 — typing 12)", () => {
  assert.equal(sanitizeQtyDraft("12", { min: 1, max: 99 }), "12");
});

check("keeps an empty box empty mid-edit instead of snapping to 1 (journey 4)", () => {
  assert.equal(sanitizeQtyDraft("", { min: 1, max: 99 }), "");
});

check("drops non-digits — a pasted '1a2' or '-3' cannot corrupt the quantity", () => {
  assert.equal(sanitizeQtyDraft("1a2", { min: 1, max: 99 }), "12");
  assert.equal(sanitizeQtyDraft("-3", { min: 1, max: 99 }), "3");
  assert.equal(sanitizeQtyDraft("2.5", { min: 1, max: 99 }), "25");
});

check("strips leading zeros so typing over a value reads naturally", () => {
  assert.equal(sanitizeQtyDraft("0", { min: 1, max: 99 }), "");
  assert.equal(sanitizeQtyDraft("07", { min: 1, max: 99 }), "7");
});

check("clamps to the cap as it is typed, so an impossible number never sits in the box", () => {
  assert.equal(sanitizeQtyDraft("99", { min: 1, max: 12 }), "12");
});

check("does NOT raise to the minimum while typing — 1 is a legal prefix of 12", () => {
  assert.equal(sanitizeQtyDraft("1", { min: 50 }), "1");
});

check("a pasted novel is truncated to the largest orderable quantity", () => {
  assert.equal(sanitizeQtyDraft("123456789", { min: 1 }), String(QTY_INPUT_MAX));
});

// ────────────────────────────── commitQtyDraft ──────────────────────────────
console.log("\ncommitQtyDraft (the number the cart is given on blur / Enter / Add)");

check("commits a typed quantity (journey 1)", () => {
  assert.equal(commitQtyDraft("12", { min: 1, max: 99 }), 12);
});

check("an empty box settles on the minimum, never 0 (journey 4)", () => {
  assert.equal(commitQtyDraft("", { min: 1 }), 1);
  assert.equal(commitQtyDraft("", { min: 50 }), 50);
});

check("all-garbage input settles on the minimum rather than NaN", () => {
  assert.equal(commitQtyDraft("abc", { min: 1 }), 1);
});

check("raises a below-MOQ commit to the minimum (journey 2)", () => {
  assert.equal(commitQtyDraft("3", { min: 50 }), 50);
});

check("caps a commit at available stock (journey 3)", () => {
  assert.equal(commitQtyDraft("999", { min: 1, max: 12 }), 12);
});

// ─────────────────────────────────── qtyDelta ───────────────────────────────
console.log("\nqtyDelta (cart-backed lines: SET the line, don't stack onto it — journey 5)");

check("typing a bigger number adds only the difference", () => {
  assert.equal(qtyDelta(2, 5), 3);
});

check("typing a smaller number removes the surplus", () => {
  assert.equal(qtyDelta(5, 2), -3);
});

check("retyping the same number is a no-op (no cart churn, no toast)", () => {
  assert.equal(qtyDelta(3, 3), 0);
});

check("typing 0 clears the whole line", () => {
  assert.equal(qtyDelta(4, 0), -4);
});

// ──────────────────────── the shared typable field ──────────────────────────
console.log("\nQtyField component");

const qtyField = read("src/storefront/components/QtyField.tsx");

check("renders a real text input, not a read-only span", () => {
  assert.ok(qtyField.includes("<input"), "QtyField renders no <input> — the quantity is still untypable");
});

check("asks phones for the numeric keypad", () => {
  assert.ok(
    qtyField.includes('inputMode="numeric"'),
    "no inputMode=numeric — mobile shoppers get the full QWERTY keyboard for a number",
  );
});

check("keeps the − / + buttons beside the box (typing is added, not swapped in)", () => {
  assert.ok(qtyField.includes("−") && qtyField.includes("+"), "the stepper buttons are gone");
});

check("commits on Enter as well as blur, so a keyboard shopper is never stranded", () => {
  assert.ok(qtyField.includes('"Enter"'), "no Enter handler — typing 12 then pressing Enter does nothing");
});

check("routes every edit through the shared helpers", () => {
  assert.ok(
    qtyField.includes("sanitizeQtyDraft") && qtyField.includes("commitQtyDraft"),
    "QtyField hand-rolls its own parsing instead of using qty-input.ts",
  );
});

// ─────────────────────── the six quantity surfaces ──────────────────────────
console.log("\nEvery quantity surface consumes the typable field");

const surfaces: { path: string; label: string; expected: number }[] = [
  // The catalog card AND its quick-view modal — two steppers in one file.
  { path: "src/storefront/components/Catalog.tsx", label: "catalog card + quick-view modal", expected: 2 },
  { path: "src/storefront/pages/MerchantPage.tsx", label: "wholesale / reseller page", expected: 1 },
  { path: "src/storefront/components/CartCheckout.tsx", label: "cart drawer lines", expected: 1 },
  { path: "src/storefront/components/TwoWaysHome.tsx", label: "two-ways on-hand rows", expected: 1 },
  { path: "src/storefront/pages/GroupBuyPage.tsx", label: "group-buy cards", expected: 1 },
];

for (const s of surfaces) {
  const src = read(s.path);
  check(`${s.label} renders QtyField ×${s.expected}`, () => {
    const uses = src.match(/<QtyField/g) ?? [];
    assert.equal(
      uses.length,
      s.expected,
      `${s.path} renders <QtyField> ${uses.length} time(s), expected ${s.expected}`,
    );
    assert.ok(src.includes("QtyField"), `${s.path} does not import QtyField`);
  });
}

check("the catalog's hand-rolled +1/−1 stepper closures are gone", () => {
  const catalog = read("src/storefront/components/Catalog.tsx");
  assert.ok(
    !/setQty\(\s*\(q\)\s*=>/.test(catalog),
    "Catalog.tsx still holds setQty((q) => …) increment closures — the old tap-per-piece stepper survives",
  );
});

check("the reseller page's hand-rolled stepper closures are gone", () => {
  const merchant = read("src/storefront/pages/MerchantPage.tsx");
  assert.ok(
    !/setQty\(\s*\(q\)\s*=>/.test(merchant),
    "MerchantPage.tsx still holds setQty((q) => …) increment closures",
  );
});

// ──────────────── cart-backed lines set an absolute quantity ────────────────
console.log("\nCart-backed lines set an absolute quantity through the store");

const store = read("src/storefront/store.tsx");

check("the store exposes setLineQty on its context type", () => {
  assert.ok(
    /setLineQty:\s*\(/.test(store),
    "store.tsx declares no setLineQty — a typed cart quantity would have to loop addToCart per unit",
  );
});

check("setLineQty is implemented and published on the context value", () => {
  assert.ok(
    store.includes("const setLineQty = useCallback"),
    "no setLineQty implementation in store.tsx",
  );
  assert.ok(
    /\bsetLineQty,/.test(store.slice(store.indexOf("cart, addToCart"))),
    "setLineQty is never put on the context value, so no surface can call it",
  );
});

check("increases still route through addToCart, keeping every add-to-cart gate", () => {
  const body = store.slice(store.indexOf("const setLineQty = useCallback"));
  assert.ok(
    body.slice(0, 1600).includes("addToCart("),
    "setLineQty does not delegate the increase to addToCart — the stock cap, store-closed, " +
      "two-ways-mix and ratio guards would all be bypassed by a typed quantity",
  );
});

for (const path of [
  "src/storefront/components/CartCheckout.tsx",
  "src/storefront/components/TwoWaysHome.tsx",
  "src/storefront/pages/GroupBuyPage.tsx",
]) {
  const src = read(path);
  check(`${path.split("/").pop()} sets the line quantity instead of stacking adds`, () => {
    assert.ok(
      src.includes("setLineQty"),
      `${path} does not call setLineQty — typing 5 would add 5 MORE units (journey 5)`,
    );
  });
}

// ───────────────────────────────── styling ──────────────────────────────────
console.log("\nStyling");

check("the shared .sf-qty control styles its input (not just its old span)", () => {
  const css = read("src/storefront/storefront.css");
  assert.ok(
    css.includes(".sf-qty input"),
    "storefront.css has no .sf-qty input rule — the typable box would inherit the raw browser field",
  );
});

check("the two-ways and group-buy steppers style their input too", () => {
  const twh = read("src/storefront/components/TwoWaysHome.tsx");
  const gb = read("src/storefront/pages/GroupBuyPage.tsx");
  assert.ok(twh.includes("sf-twh__stepper input"), "TwoWaysHome's inline CSS has no input rule");
  assert.ok(gb.includes("gbpage__stepper input"), "GroupBuyPage's inline CSS has no input rule");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
