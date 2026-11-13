// Gate for the category-sections catalog (src/lib/storefront/category-sections.ts):
// grouping, loose category matching, per-category order, Other section,
// search, moves, scroll-spy pick. Pure — no DB, no React.
//
//   npm run test:category-sections
import {
  buildCategorySections, categoryResolver, countByCategory, filterSections,
  isArrangeableCategory, moveToIndex, normalizeCategoryProductOrder, orderCategoryProducts,
  OTHER_SECTION_ID, pickActiveSection, withCategoryProductOrder,
  FEATURED_SECTION_ID, withFeaturedSection,
} from "../src/lib/storefront/category-sections";

let failures = 0;
let checks = 0;
function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const ids = (l: { id: string }[]) => l.map((p) => p.id).join(",");

const cats = [
  { id: "all", label: "All Products" },
  { id: "peptides", label: "Peptides" },
  { id: "beauty", label: "Beauty & Anti-Aging" },
  { id: "cat1_x", label: "MMG" },
  { id: "empty", label: "Empty" },
];
const P = (id: string, category: string | undefined, position?: number) => ({ id, name: id.toUpperCase(), category, position });
const products = [
  P("a", "peptides", 3), P("b", "Peptides", 0), P("c", "beauty", 1), P("d", "MMG"),
  P("e", "Other", 2), P("f", "cat1_x", 4), P("g", undefined), P("h", " BEAUTY ", 5),
];

console.log("category matching");
const r = categoryResolver(cats);
ok("exact id", r("peptides") === "peptides");
ok("case-insensitive id", r("Peptides") === "peptides");
ok("label match", r("MMG") === "cat1_x");
ok("trimmed + case", r(" BEAUTY ") === "beauty");
ok("unknown → null", r("Other") === null && r(undefined) === null && r("") === null);
ok("'all' is never a category", r("all") === null);

console.log("sections");
const s = buildCategorySections(products, cats, {});
ok("category order kept, empty dropped, Other last", s.map((x) => x.id).join(",") === `peptides,beauty,cat1_x,${OTHER_SECTION_ID}`, s.map((x) => x.id).join(","));
ok("each product exactly once", s.flatMap((x) => x.products).length === products.length);
ok("unarranged follow position then name", ids(s[0].products) === "b,a", ids(s[0].products));
ok("Other holds unmatched", ids(s[3].products) === "e,g", ids(s[3].products));
const s2 = buildCategorySections(products, cats, { peptides: ["a", "b"], beauty: ["h"] });
ok("stored per-category order wins", ids(s2[0].products) === "a,b");
ok("unlisted (new) product lands at the end", ids(s2[1].products) === "h,c", ids(s2[1].products));
ok("orders are independent per category", ids(s2[2].products) === "f,d", ids(s2[2].products));
ok("input never mutated", products[0].id === "a" && products[1].id === "b");
ok("stale ids in a list are ignored", ids(orderCategoryProducts([P("x", "p"), P("y", "p")], ["gone", "y"])) === "y,x");
ok("no categories → everything in Other", buildCategorySections(products, null, null).length === 1);

console.log("featured");
{
  const fp = [{ ...P("a", "peptides", 3), featured: true }, { ...P("b", "peptides", 0), featured: false }, { ...P("c", "beauty", 1), featured: true }, { ...P("z", "nope"), featured: true }];
  const fs = withFeaturedSection(buildCategorySections(fp, cats, { beauty: ["c"] }));
  ok("Featured leads", fs[0].id === FEATURED_SECTION_ID);
  ok("Featured follows category order + arrangement", ids(fs[0].products) === "a,c,z", ids(fs[0].products));
  ok("featured products stay in their own category", ids(fs.find((x) => x.id === "peptides")!.products) === "b,a" && ids(fs.find((x) => x.id === "beauty")!.products) === "c");
  ok("no featured → no Featured section", withFeaturedSection(buildCategorySections(products, cats, {}))[0].id === "peptides");
  ok("search keeps Featured only when it matches", filterSections(fs, "zz").length === 0 && filterSections(fs, "c")[0].id === FEATURED_SECTION_ID);
}

console.log("search");
const f = filterSections(buildCategorySections(products, cats, {}), "a");
ok("filters within sections, drops empty", f.map((x) => x.id).join(",") === "peptides", f.map((x) => x.id).join(","));
ok("blank query = all", filterSections(s, "  ").length === s.length);

console.log("stored map");
const n = normalizeCategoryProductOrder({ peptides: ["a", "a", " b ", 3], all: ["x"], "": ["y"], e: [], beauty: "nope" });
ok("normalize: dedupe/trim, drop all/blank/empty/invalid", JSON.stringify(n) === '{"peptides":["a","b"]}', JSON.stringify(n));
ok("normalize: junk → {}", JSON.stringify(normalizeCategoryProductOrder([1])) === "{}" && JSON.stringify(normalizeCategoryProductOrder(null)) === "{}");
const cur = { peptides: ["a"], gone: ["z"], beauty: ["c"] };
const w = withCategoryProductOrder(cur, "peptides", ["b", "a"], ["peptides", "beauty"]);
ok("merge replaces one key, keeps others, prunes deleted", JSON.stringify(w) === '{"beauty":["c"],"peptides":["b","a"]}', JSON.stringify(w));
ok("merge does not mutate", cur.peptides.join() === "a");
ok("empty list removes key", !("beauty" in withCategoryProductOrder(cur, "beauty", [], ["beauty"])));
ok("arrangeable: real + Other only", isArrangeableCategory("beauty", cats) && isArrangeableCategory(OTHER_SECTION_ID, cats) && !isArrangeableCategory("all", cats) && !isArrangeableCategory("nope", cats) && !isArrangeableCategory(5, cats));

console.log("counts + moves");
const c = countByCategory(products, cats);
ok("loose counts", c.get("peptides") === 2 && c.get("beauty") === 2 && c.get("cat1_x") === 2 && c.get(OTHER_SECTION_ID) === 2);
ok("move to top", moveToIndex(["a", "b", "c"], "c", 0).join() === "c,a,b");
ok("move to bottom (clamped)", moveToIndex(["a", "b", "c"], "a", 99).join() === "b,c,a");
ok("move to middle", moveToIndex(["a", "b", "c", "d"], "a", 2).join() === "b,c,a,d");
ok("unknown id is a copy", moveToIndex(["a"], "z", 0).join() === "a");

console.log("scroll spy");
const tops = [{ id: "p", top: -500 }, { id: "b", top: 100 }, { id: "m", top: 900 }];
ok("section under the line is active", pickActiveSection(tops, 120) === "b");
ok("above the catalog → first", pickActiveSection([{ id: "p", top: 400 }, { id: "b", top: 900 }], 120) === "p");
ok("exactly on the line counts", pickActiveSection(tops, 100) === "b");
ok("no sections → null", pickActiveSection([], 0) === null);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
