// MCP product variations — RED/GREEN gate (npm run test:mcp-variations).
//
// The connector could add and edit products, but it could NOT touch a product's
// size/colorway options in any usable way. Two separate holes:
//
//   NO WAY TO ADD ONE OPTION. update_products replaces a product's whole
//   `variations` array, so "add a 10mg at ₱1,800" meant re-sending every option
//   the product already had — a list the agent cannot see and the operator does
//   not have. In practice that means silently deleting the other 80 colorways.
//
//   THE OPTION PHOTO NEVER SURVIVED THE SAVE. normalizeProductInput rebuilt each
//   variation as {name, price, stock?, gbPrice?} and dropped `image`. The MCP
//   schema advertised it, cleanVariations persisted it, the card's gallery read
//   it — but the one coercion step between the payload and the DB threw it away,
//   on the store-admin editor's save path too.
//
// The rules pinned here, rather than in the route:
//
//   ADD MEANS ADD. An "add" call touches only the options it names. Everything
//   else keeps its price, its stock, its photo and its POSITION in the picker.
//   Journeys 1, 2, 3.
//
//   NOTHING BECOMES FREE. A new option with no price is refused, never coerced
//   to 0 — a ₱0 option is a free checkout, not a choice. Same rule the editor
//   enforces with unpricedVariationNames. Journey 6.
//
//   IT FAILS LOUD, AND ALL-OR-NOTHING. One bad row applies nothing. A picker
//   half-rebuilt and reported as success is worse than an error, because the
//   agent cannot see the storefront to notice. Journeys 6, 7.
//
//   REPLACE IS OPT-IN. Wiping an option list is something an operator must ask
//   for by name, never the default the model falls into. Journey 5.
//
// Journeys covered:
//  1. Operator adds one option to a product that already has some → appended.
//  2. Operator corrects one option's price/stock by name → only that one moves.
//  3. Operator gives an option its own photo → it survives the whole save path.
//  4. Operator removes an option that is gone for good → the rest are untouched.
//  5. Operator genuinely wants a fresh list → replace, and only on request.
//  6. Operator forgets a price / sends a bad row → refused, nothing applied.
//  7. Operator names an option that does not exist → refused, named back.
//  8. The tool schema, the pure core and the route all agree.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildVariationPlan, MAX_VARIATIONS } from "../src/lib/storefront/variation-plan";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import { productToDbWrite, dbProductToStorefront, type DbProductRow } from "../src/lib/storefront/product-mapping";
import type { Variation } from "../src/lib/storefront/variations";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}`);
    if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

const isPlan = (r: ReturnType<typeof buildVariationPlan>): r is Exclude<typeof r, { error: string }> =>
  !("error" in r);
const names = (v: readonly Variation[]) => v.map((x) => x.name);
const IMG = (n: string) => `https://ik.imagekit.io/pepweb/${n}.jpg`;

/** A product that already sells three colorways — the shape "add one more" has
 *  to survive without the caller ever seeing the other two. */
const EXISTING: Variation[] = [
  { name: "Rosegold", price: 600, stock: 4, image: IMG("rosegold") },
  { name: "Roseberry", price: 650 },
  { name: "Silk Barbie", price: 700, gbPrice: 500, image: IMG("silk") },
];

// ── Journey 1: add one option, keep the rest ────────────────────────────────
section("Journey 1 — adding an option leaves every other option alone");
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Verdance", price: 720 }] });
  check("an add call succeeds", isPlan(plan), plan);
  if (isPlan(plan)) {
    check("the new option is appended last", names(plan.variations).join("|") ===
      "Rosegold|Roseberry|Silk Barbie|Verdance", names(plan.variations));
    check("it reports exactly what it added", plan.added.join("|") === "Verdance", plan.added);
    check("it claims no other change", plan.updated.length === 0 && plan.removed.length === 0, plan);
    check("an untouched option keeps its photo", plan.variations[0].image === IMG("rosegold"), plan.variations[0]);
    check("an untouched option keeps its per-option stock", plan.variations[0].stock === 4, plan.variations[0]);
    check("an untouched option keeps its group price", plan.variations[2].gbPrice === 500, plan.variations[2]);
  }
}
{
  const plan = buildVariationPlan([], { variations: [{ name: "5mg", price: 1099 }] });
  check("a product with no options yet gets its first one", isPlan(plan) && plan.variations.length === 1, plan);
}
{
  const plan = buildVariationPlan(EXISTING, { mode: "add", variations: [{ name: "10mg", price: 1800 }] });
  check("mode:add is the same as the default", isPlan(plan) && plan.variations.length === 4, plan);
}

// ── Journey 2: correct one option in place ──────────────────────────────────
section("Journey 2 — editing an existing option moves only that option");
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Roseberry", price: 675 }] });
  check("an add call naming an EXISTING option patches it", isPlan(plan) && plan.variations.length === 3, plan);
  if (isPlan(plan)) {
    check("it is reported as updated, not added", plan.updated.join("|") === "Roseberry" && plan.added.length === 0, plan);
    check("the new price took", plan.variations[1].price === 675, plan.variations[1]);
    check("it kept its POSITION in the picker", names(plan.variations)[1] === "Roseberry", names(plan.variations));
  }
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "rosegold", stock: 0 }] });
  check("an option is matched case-insensitively", isPlan(plan) && plan.updated.join("|") === "Rosegold", plan);
  if (isPlan(plan)) {
    check("a stock edit alone keeps the price", plan.variations[0].price === 600, plan.variations[0]);
    check("stock 0 is honoured, not treated as blank", plan.variations[0].stock === 0, plan.variations[0]);
    check("the saved name stays the seller's spelling", plan.variations[0].name === "Rosegold", plan.variations[0]);
  }
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Rosegold", stock: null }] });
  check("stock:null returns the option to shared base stock", isPlan(plan) && !("stock" in plan.variations[0]), plan);
}

// ── Journey 3: an option's own photo survives the whole save path ───────────
section("Journey 3 — a per-option photo survives the save it never used to");
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Roseberry", image: IMG("roseberry") }] });
  check("the plan attaches the photo", isPlan(plan) && plan.variations[1].image === IMG("roseberry"), plan);
}
{
  // The bug this file exists for: the coercion step between an MCP payload (or an
  // admin form post) and productToDbWrite silently rebuilt variations WITHOUT
  // `image`, so no per-option photo ever reached Postgres from either surface.
  const p = normalizeProductInput({
    name: "Vial case",
    category: "Cases",
    price: 600,
    variations: [{ name: "Roseberry", price: 650, image: IMG("roseberry") }],
  });
  check("normalizeProductInput keeps the option photo", p.variations?.[0]?.image === IMG("roseberry"), p.variations);

  const write = productToDbWrite(p, "PHP", "₱");
  const meta = write.metadata as { variations?: Variation[] };
  check("productToDbWrite persists it into metadata", meta.variations?.[0]?.image === IMG("roseberry"), meta.variations);

  const back = dbProductToStorefront(
    { id: "p1", sku: "s", slug: "vial-case", name: "Vial case", description: null, priceCents: 60000,
      currency: "PHP", stock: 0, status: "active", active: true, images: [], metadata: write.metadata } as unknown as DbProductRow,
    "₱",
  );
  check("and it reads back on the storefront", back.variations?.[0]?.image === IMG("roseberry"), back.variations);
}
{
  const p = normalizeProductInput({
    name: "Vial case", category: "Cases", price: 600,
    variations: [{ name: "Bad", price: 650, image: "javascript:alert(1)" }],
  });
  check("an un-hosted option photo is dropped, not stored", p.variations?.[0]?.image === undefined, p.variations);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Teal", price: 600, image: "data:image/png;base64,xx" }] });
  check("the connector is told its photo is not a public URL", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Rosegold", image: null }] });
  check("image:null clears an option's photo", isPlan(plan) && !("image" in plan.variations[0]), plan);
}

// ── Journey 4: remove one option ────────────────────────────────────────────
section("Journey 4 — removing an option leaves the rest intact");
{
  const plan = buildVariationPlan(EXISTING, { mode: "remove", remove: ["Roseberry"] });
  check("remove drops exactly one", isPlan(plan) && names(plan.variations).join("|") === "Rosegold|Silk Barbie", plan);
  check("it reports what it removed", isPlan(plan) && plan.removed.join("|") === "Roseberry", plan);
}
{
  const plan = buildVariationPlan(EXISTING, { mode: "remove", remove: ["Rosegold", "Roseberry", "Silk Barbie"] });
  check("removing every option is allowed and empties the picker", isPlan(plan) && plan.variations.length === 0, plan);
}

// ── Journey 5: replace is opt-in ────────────────────────────────────────────
section("Journey 5 — replacing the whole list is something you ask for by name");
{
  const plan = buildVariationPlan(EXISTING, { mode: "replace", variations: [{ name: "5mg", price: 1099 }, { name: "10mg", price: 1800 }] });
  check("replace installs exactly the sent list", isPlan(plan) && names(plan.variations).join("|") === "5mg|10mg", plan);
  check("the options it displaced are reported removed", isPlan(plan) && plan.removed.length === 3, plan);
}
{
  const plan = buildVariationPlan(EXISTING, { mode: "replace", variations: [{ name: "5mg" }] });
  check("replace still refuses a priceless option", !isPlan(plan), plan);
}

// ── Journey 6: nothing becomes free, nothing half-applies ───────────────────
section("Journey 6 — a bad row refuses the whole call");
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Verdance" }] });
  check("a NEW option with no price is refused", !isPlan(plan), plan);
  check("the refusal names the option", !isPlan(plan) && /Verdance/.test((plan as { error: string }).error), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Verdance", price: 0 }] });
  check("a new option priced at 0 is refused, not sold for free", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Verdance", price: "" }] });
  check("a blank price does not read as 0", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "  ", price: 700 }] });
  check("a nameless option is refused", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Teal", price: 700 }, { name: "teal", price: 800 }] });
  check("the same option twice in one call is refused", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Good", price: 700 }, { name: "Bad" }] });
  check("one bad row applies nothing at all", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [] });
  check("an empty call is refused, not a silent no-op success", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { mode: "shuffle", variations: [{ name: "X", price: 1 }] });
  check("an unknown mode is refused rather than guessed", !isPlan(plan), plan);
}
{
  const many = Array.from({ length: MAX_VARIATIONS + 1 }, (_, i) => ({ name: `c${i}`, price: 100 }));
  const plan = buildVariationPlan([], { variations: many });
  check("a list past the cap is refused", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { variations: [{ name: "Rosegold", price: -5 }] });
  check("a negative price is refused", !isPlan(plan), plan);
}

// ── Journey 7: an option that does not exist ────────────────────────────────
section("Journey 7 — removing something that is not there is an error, not a shrug");
{
  const plan = buildVariationPlan(EXISTING, { mode: "remove", remove: ["Chartreuse"] });
  check("an unknown option name is refused", !isPlan(plan), plan);
  check("the refusal names it back", !isPlan(plan) && /Chartreuse/.test((plan as { error: string }).error), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { mode: "remove", remove: ["Rosegold", "Chartreuse"] });
  check("one unknown name in a batch removes nothing", !isPlan(plan), plan);
}
{
  const plan = buildVariationPlan(EXISTING, { mode: "remove", remove: [] });
  check("remove with nothing to remove is refused", !isPlan(plan), plan);
}

// ── Journey 8: the tool is actually reachable from ChatGPT ──────────────────
section("Journey 8 — the schema, the core and the route agree");
{
  const route = readFileSync(join(process.cwd(), "src/app/api/mcp/route.ts"), "utf8");
  check("the route imports the pure plan core", route.includes("buildVariationPlan"), null);
  check("tools/list advertises the variation tool", /tools:\s*\[[^\]]*MANAGE_PRODUCT_VARIATIONS_TOOL/s.test(route), null);
  check("the route dispatches it", route.includes("callManageProductVariations"), null);
  check(
    "the tool is named for what an operator asks for",
    route.includes('name: "manage_product_variations"'),
    null,
  );
  check(
    "the server instructions tell the model options can be added",
    /variation/i.test(route.slice(route.indexOf("instructions:"), route.indexOf("instructions:") + 2200)),
    null,
  );
  check(
    "the tool declares add/replace/remove",
    /enum: \["add", "replace", "remove"\]/.test(route),
    null,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll MCP product variation checks passed");
