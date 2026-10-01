// Self-contained test gate for the admin-arranged product order
// (src/lib/storefront/product-order.ts + its use in sort-categories.ts): the
// owner drags products into the order they want, it is stored as a list of ids
// in branding.config.productOrder, and the catalog's default "Featured" view
// follows it. Pure — no DB, no React.
//
//   npm run test:product-order

import {
  normalizeProductOrder,
  applyProductOrder,
  moveProduct,
  MAX_PRODUCT_ORDER,
} from "../src/lib/storefront/product-order";
import {
  DEFAULT_SORT_CATEGORIES,
  orderCatalogByCategories,
  sortByCategory,
  type SortCategory,
} from "../src/lib/storefront/sort-categories";

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

const ids = (list: { id: string }[]) => list.map((p) => p.id).join(",");

type P = { id: string; name: string; price: number; featured?: boolean; sortCategory?: string; position?: number };
const mk = (id: string, name: string, extra: Partial<P> = {}): P => ({ id, name, price: 100, ...extra });

console.log("normalizeProductOrder");
ok("non-array → empty", normalizeProductOrder("x").length === 0 && normalizeProductOrder(null).length === 0);
ok(
  "keeps strings, trims, drops blanks/non-strings, keeps first duplicate",
  normalizeProductOrder([" a ", "", 3, null, "b", "a", "c"]).join(",") === "a,b,c",
);
ok(
  "caps the list length",
  normalizeProductOrder(Array.from({ length: MAX_PRODUCT_ORDER + 50 }, (_, i) => `p${i}`)).length ===
    MAX_PRODUCT_ORDER,
);
ok("drops absurdly long ids", normalizeProductOrder(["x".repeat(200), "ok"]).join(",") === "ok");

console.log("applyProductOrder");
{
  const list = [mk("a", "Alpha"), mk("b", "Beta"), mk("c", "Gamma"), mk("d", "Delta")];
  const snapshot = JSON.stringify(list);
  const out = applyProductOrder(list, ["c", "a", "zzz"]);
  ok("listed products lead in the owner's order", ids(out).startsWith("c,a"));
  ok("unlisted (new) products follow in their incoming order", ids(out) === "c,a,b,d");
  ok("listed products carry their position", out[0].position === 0 && out[1].position === 1);
  ok("unlisted products have no position", out[2].position === undefined && out[3].position === undefined);
  ok("input is not mutated", JSON.stringify(list) === snapshot);
  ok("empty order = same order, no positions", ids(applyProductOrder(list, [])) === "a,b,c,d" &&
    applyProductOrder(list, []).every((p) => p.position === undefined));
  const stale = applyProductOrder([{ ...mk("a", "Alpha"), position: 7 }], []);
  ok("a stale position is cleared when no longer listed", stale[0].position === undefined);
}

console.log("moveProduct");
ok("moves down", moveProduct(["a", "b", "c"], "a", 1).join(",") === "b,a,c");
ok("moves up", moveProduct(["a", "b", "c"], "c", -1).join(",") === "a,c,b");
ok("clamps at the top", moveProduct(["a", "b", "c"], "a", -1).join(",") === "a,b,c");
ok("clamps at the bottom", moveProduct(["a", "b", "c"], "c", 5).join(",") === "a,b,c");
ok("unknown id is a no-op", moveProduct(["a", "b"], "z", 1).join(",") === "a,b");
{
  const src = ["a", "b", "c"];
  moveProduct(src, "a", 2);
  ok("does not mutate the input", src.join(",") === "a,b,c");
}

console.log("catalog default view follows the arrangement");
{
  const cats: SortCategory[] = DEFAULT_SORT_CATEGORIES.map((c) => ({ ...c }));
  const arranged = applyProductOrder(
    [mk("a", "Alpha"), mk("b", "Beta"), mk("c", "Gamma"), mk("n", "Newbie")],
    ["c", "a", "b"],
  );
  ok(
    "orderCatalogByCategories keeps the owner's order (not alphabetical)",
    ids(orderCatalogByCategories(arranged, cats)) === "c,a,b,n",
  );
  ok(
    "the Featured pick follows it too",
    ids(sortByCategory(arranged, "featured", cats)) === "c,a,b,n",
  );
  const withFeatured = arranged.map((p) => (p.id === "b" ? { ...p, featured: true } : p));
  ok(
    "featured still pins above the arrangement",
    ids(sortByCategory(withFeatured, "featured", cats)) === "b,c,a,n",
  );
  ok(
    "an explicit Name pick is still alphabetical",
    ids(sortByCategory(arranged, "name", cats)) === "a,b,c,n",
  );
  const unarranged = [mk("c", "Gamma"), mk("a", "Alpha"), mk("b", "Beta")];
  ok(
    "a store that never arranged keeps alphabetical order",
    ids(orderCatalogByCategories(unarranged, cats)) === "a,b,c",
  );
  const grouped: SortCategory[] = [...cats, { id: "wl", label: "Weight Loss", kind: "group", enabled: true }];
  const inGroups = applyProductOrder(
    [mk("a", "Alpha", { sortCategory: "wl" }), mk("b", "Beta"), mk("c", "Gamma", { sortCategory: "wl" })],
    ["b", "c", "a"],
  );
  ok(
    "within a group block the arrangement holds",
    ids(orderCatalogByCategories(inGroups, grouped)) === "c,a,b",
  );
  ok("a group pick floats members in arranged order", ids(sortByCategory(inGroups, "wl", grouped)) === "c,a,b");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
