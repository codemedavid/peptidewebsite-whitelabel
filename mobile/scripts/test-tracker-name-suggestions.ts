// Setup step 1: any name may be tracked; suggestions only save typing.
import assert from "node:assert/strict";
import { MAX_SHOP, nameSuggestions, normName } from "../src/features/tracker/lib/name-suggestions";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker name suggestions");

const SHOP = [
  { id: "p1", name: "BPC-157 10mg" },
  { id: "p2", name: "TB-500" },
  { id: "p3", name: "GHK-Cu" },
];
const MINE = [
  { name: "My compounded blend", catalogId: null },
  { name: "BPC-157 10mg", catalogId: "p1" },
  { name: "my compounded  BLEND ", catalogId: null },
];

test("a name that isn't in the shop is allowed and flagged as the person's own", () => {
  const s = nameSuggestions("Retatrutide", MINE, SHOP);
  assert.equal(s.isCustom, true);
  assert.deepEqual(s.shop, []);
});

test("typing a shop product's exact name (any case/spacing) is not custom", () => {
  assert.equal(nameSuggestions("  bpc-157   10MG ", MINE, SHOP).isCustom, false);
});

test("nothing typed: not custom; my names first, then the shop, no duplicates", () => {
  const s = nameSuggestions("", MINE, SHOP);
  assert.equal(s.isCustom, false);
  assert.deepEqual(s.mine.map((o) => o.name), ["My compounded blend", "BPC-157 10mg"]);
  assert.deepEqual(s.shop.map((o) => o.name), ["TB-500", "GHK-Cu"]);
});

test("my own names keep their product link; shop picks link the product", () => {
  const s = nameSuggestions("bpc", MINE, SHOP);
  assert.deepEqual(s.mine, [{ name: "BPC-157 10mg", catalogId: "p1" }]);
  assert.deepEqual(s.shop, []);
  assert.deepEqual(nameSuggestions("tb", [], SHOP).shop, [{ name: "TB-500", catalogId: "p2" }]);
});

test("the exact typed name is not suggested back", () => {
  assert.deepEqual(nameSuggestions("TB-500", [], SHOP).shop, []);
});

test("shop suggestions are capped", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `Peptide ${i}` }));
  assert.equal(nameSuggestions("peptide", [], many).shop.length, MAX_SHOP);
});

test("normName ignores case and extra spaces", () => {
  assert.equal(normName("  Ghk   CU "), "ghk cu");
});

done();
