/**
 * Self-contained test for the classic-home trust strip core (no DOM, no DB).
 *
 *   npm run test:trust-strip
 */

import assert from "node:assert";

import { buildTrustStrip, trustIcon } from "../src/lib/storefront/trust-strip";

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

console.log("\nTrust strip\n");

check("icons follow the owner's own words", () => {
  assert.strictEqual(trustIcon("Lab Verified"), "shield");
  assert.strictEqual(trustIcon("99% purity guaranteed"), "shield");
  assert.strictEqual(trustIcon("Premium Quality"), "sparkle");
  assert.strictEqual(trustIcon("Real-World Tested"), "flask");
  assert.strictEqual(trustIcon("Nationwide shipping"), "truck");
  assert.strictEqual(trustIcon("Same-day delivery"), "truck");
  assert.strictEqual(trustIcon("Made with love"), "heart");
});

check("the label decides the icon; the note only breaks a tie", () => {
  const strip = buildTrustStrip({
    showTrustStrip: true,
    boutique: { assurances: [{ id: "a", label: "Real-World Tested", note: "Verified by our team" }, { id: "b", label: "Our promise", note: "Lab verified" }] },
  });
  assert.deepStrictEqual(strip!.items.map((i) => i.icon), ["flask", "shield"]);
});

check("an unrecognised promise still gets a neutral icon", () => {
  assert.strictEqual(trustIcon("Something else"), "check");
});

check("off unless the store opts in", () => {
  const items = [{ id: "a", label: "Lab Verified" }];
  assert.strictEqual(buildTrustStrip({ showTrustStrip: false, boutique: { assurances: items } }), null);
  assert.strictEqual(buildTrustStrip({ boutique: { assurances: items } }), null);
});

check("on with no promises → nothing to show", () => {
  assert.strictEqual(buildTrustStrip({ showTrustStrip: true, boutique: { assurances: [] } }), null);
  assert.strictEqual(buildTrustStrip({ showTrustStrip: true }), null);
});

check("on with promises → items with icons, title and quote", () => {
  const strip = buildTrustStrip({
    showTrustStrip: true,
    trustStripTitle: "  Why us  ",
    trustStripQuote: "Quality you can feel.",
    boutique: { assurances: [{ id: "a", label: "Lab Verified", note: "Purity Guaranteed" }, { label: "  " }] },
  });
  assert.ok(strip);
  assert.strictEqual(strip!.title, "Why us");
  assert.strictEqual(strip!.quote, "Quality you can feel.");
  assert.deepStrictEqual(strip!.items, [{ id: "a", label: "Lab Verified", note: "Purity Guaranteed", icon: "shield" }]);
});

check("blank title falls back; blank quote is omitted", () => {
  const strip = buildTrustStrip({ showTrustStrip: true, trustStripQuote: "  ", boutique: { assurances: [{ id: "a", label: "Premium Quality" }] } });
  assert.strictEqual(strip!.title, "Why shop with us");
  assert.strictEqual(strip!.quote, "");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
