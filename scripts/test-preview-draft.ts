/**
 * Tests for the branding editor's live preview (src/lib/admin/preview-draft.ts):
 * how an unsaved draft lands on the tenant's real storefront Brand, and which
 * frame messages are trusted.
 *
 *   npm run test:preview-draft
 *
 * Pure: no DB, no browser.
 */

import assert from "node:assert";
import { BRAND } from "../src/storefront/data";
import type { Brand } from "../src/storefront/types";
import { mergePreviewDraft, readPreviewMessage } from "../src/lib/admin/preview-draft";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const base: Brand = { ...BRAND, name: "Real Store", logoUrl: "https://e.test/logo.png", homeLayout: "classic", showPageArticles: true };

console.log("\npreview-draft — the draft over the real store");

check("server-resolved fields survive a draft that doesn't mention them", () => {
  const b = mergePreviewDraft(base, { heroLine1: "Hello" });
  assert.equal(b.heroLine1, "Hello");
  assert.equal(b.showPageArticles, true);
  assert.equal(b.name, "Real Store");
});

check("name / logo: draft, then the editor's columns, then the store's own", () => {
  assert.equal(mergePreviewDraft(base, {}, { name: "Editor Name" }).name, "Editor Name");
  assert.equal(mergePreviewDraft(base, { name: "Draft Name" }, { name: "Editor Name" }).name, "Draft Name");
  assert.equal(mergePreviewDraft(base, {}, { logoUrl: null }).logoUrl, "https://e.test/logo.png");
});

check("a draft can't conjure a sold or module-gated layout", () => {
  assert.equal(mergePreviewDraft(base, { homeLayout: "two-ways" }).homeLayout, "classic");
  assert.equal(mergePreviewDraft(base, { homeLayout: "groupbuy" }).homeLayout, "classic");
  assert.equal(mergePreviewDraft({ ...base, homeLayout: "two-ways" }, { homeLayout: "two-ways" }).homeLayout, "two-ways");
  assert.equal(mergePreviewDraft(base, { homeLayout: "intl-local" }).homeLayout, "intl-local");
});

check("Intl & Local: config normalized, dual market re-derived from the draft", () => {
  const on = mergePreviewDraft(base, { homeLayout: "intl-local" });
  assert.equal(on.intlLocal?.hero.title, "Discover. Understand. Choose.");
  assert.equal(on.dualMarket, true);
  const off = mergePreviewDraft(base, { homeLayout: "intl-local", intlMarket: { enabled: false } });
  assert.equal(off.dualMarket, false);
  assert.equal(mergePreviewDraft(base, {}).dualMarket, false);
});

check("the preview never places orders and never pops the owner's notice", () => {
  const b = mergePreviewDraft({ ...base, noticeModal: { enabled: true } as never }, {});
  assert.equal(b.checkoutPreviewOnly, true);
  assert.equal(b.noticeModal, undefined);
});

check("the inputs are never mutated", () => {
  const draft = { heroLine1: "x" };
  mergePreviewDraft(base, draft);
  assert.equal(base.checkoutPreviewOnly, undefined);
  assert.deepEqual(draft, { heroLine1: "x" });
});

console.log("\npreview-draft — frame messages");

check("only same-origin messages of a known type are read", () => {
  const origin = "https://app.pepweb.store";
  assert.deepEqual(readPreviewMessage({ origin, data: { type: "sf-preview:ready" } }, origin), { type: "sf-preview:ready" });
  assert.equal(readPreviewMessage({ origin: "https://evil.test", data: { type: "sf-preview:ready" } }, origin), null);
  assert.equal(readPreviewMessage({ origin, data: { type: "sf-preview:wipe" } }, origin), null);
  assert.equal(readPreviewMessage({ origin, data: "sf-preview:ready" }, origin), null);
  assert.equal(readPreviewMessage({ origin, data: null }, origin), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
