// Unit tests for features/tracker/components/vial-model.ts. Run: npm run test:tracker
import assert from "node:assert/strict";
import { defaultExpiry, expiryText, lineDetail, protocolForLine, vialLeftText, vialPhase, vialSections, vialsFromLine, MAX_VIALS_PER_LINE } from "../src/features/tracker/components/vial-model";
import { makeTest, oct, protocol, vial } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker vial model");

const item = (over: Parameters<typeof vial>[0], pct = 50, isExpired = false) => ({ vial: vial(over), pct, isExpired });

test("what's left: one phrasing — empty, doses before %, never 'runs out' once expired", () => {
  const now = oct(10, 12);
  const base = { pct: 40, dosesLeft: 3, runOutDate: oct(12, 8), isExpired: false };
  assert.equal(vialLeftText(base, now), "3 doses left · runs out Mon");
  assert.equal(vialLeftText({ ...base, runOutDate: oct(10, 20) }, now), "3 doses left · runs out today");
  assert.equal(vialLeftText({ ...base, dosesLeft: null, runOutDate: null }, now), "40% left");
  assert.equal(vialLeftText({ ...base, dosesLeft: 0, pct: 0 }, now), "Empty");
  assert.equal(vialLeftText({ ...base, isExpired: true }, now), "3 doses left");
});

test("phases: in use, sealed (unopened), done (finished)", () => {
  assert.equal(vialPhase(vial()), "inUse");
  assert.equal(vialPhase(vial({ unopened: true })), "sealed");
  assert.equal(vialPhase(vial({ status: "finished" })), "done");
  assert.equal(vialPhase(vial({ status: "finished", unopened: true })), "done");
});

test("sections come in order, drop empties, and put expired in-use vials last", () => {
  const s = vialSections([item({ id: "a", status: "finished" }), item({ id: "b" }, 80), item({ id: "c" }, 20), item({ id: "d" }, 60, true)]);
  assert.deepEqual(s.map((x) => x.phase), ["inUse", "done"]);
  assert.deepEqual(s[0].items.map((x) => x.vial.id), ["c", "b"]);
  assert.deepEqual(s[1].items.map((x) => x.vial.id), ["a", "d"]);
  assert.equal(s[1].title, "Finished & expired");
});

test("expiry wording counts calendar days", () => {
  const now = oct(12, 22);
  assert.equal(expiryText(null, now), null);
  assert.deepEqual(expiryText("2026-10-12", now), { text: "Expires today", tone: "soon" });
  assert.deepEqual(expiryText("2026-10-13", now), { text: "Expires tomorrow", tone: "soon" });
  assert.equal(expiryText("2026-10-15", now)?.tone, "soon");
  assert.equal(expiryText("2026-10-30", now)?.tone, "ok");
  assert.ok(/18 days/.test(expiryText("2026-10-30", now)?.text ?? ""));
  assert.deepEqual(expiryText("2026-10-11", now), { text: "Expired yesterday", tone: "expired" });
  assert.deepEqual(expiryText("2026-10-09", now), { text: "Expired 3 days ago", tone: "expired" });
});

test("default expiry is mixed + 28 days", () => {
  assert.equal(defaultExpiry("2026-10-01"), "2026-10-29");
});

test("an order line matches its protocol by product, then by name; ambiguity matches nothing", () => {
  const a = protocol({ id: "a", name: "BPC-157", catalogId: "prod1" });
  const b = protocol({ id: "b", name: "TB-500", catalogId: null });
  assert.equal(protocolForLine({ productId: "prod1", name: "Anything" }, [a, b])?.id, "a");
  assert.equal(protocolForLine({ productId: "x", name: "tb 500" }, [a, b])?.id, "b");
  assert.equal(protocolForLine({ productId: "x", name: "TB-500 10mg" }, [a, b])?.id, "b");
  assert.equal(protocolForLine({ productId: "x", name: "GHK-Cu" }, [a, b]), null);
  const a2 = protocol({ id: "a2", name: "BPC-157 (2)", catalogId: "prod1" });
  assert.equal(protocolForLine({ productId: "prod1", name: "BPC-157" }, [a, a2]), null);
  assert.equal(protocolForLine({ productId: "prod1", name: "BPC-157" }, [protocol({ id: "z", catalogId: "prod1", status: "archived" })]), null);
});

test("one sealed vial per unit bought, capped; none without a strength", () => {
  const line = { key: "k1", strength: { value: 10, unit: "mg" as const }, quantity: 3 };
  const vials = vialsFromLine(line, "p1");
  assert.equal(vials.length, 3);
  assert.ok(vials.every((v) => v?.unopened === true && v.amount === 10 && v.source?.kind === "order"));
  assert.equal(vialsFromLine({ ...line, quantity: 999 }, "p1").length, MAX_VIALS_PER_LINE);
  assert.equal(vialsFromLine({ ...line, quantity: 0 }, "p1").length, 1);
  assert.equal(vialsFromLine({ ...line, strength: null }, "p1").length, 0);
});

test("line detail reads variation, quantity and order", () => {
  assert.equal(lineDetail({ variation: "10mg", quantity: 2, orderNumber: "1042" }), "10mg × 2 · Order 1042");
  assert.equal(lineDetail({ variation: null, quantity: 1, orderNumber: "7" }), "Order 7");
});

done();
