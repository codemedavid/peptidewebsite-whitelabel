/**
 * Self-contained test for the pure core behind the storefront Announcement
 * Pop-up (src/lib/storefront/announcement-popup.ts): sanitizing untrusted
 * branding.config, the save shape + content version, validation, the schedule
 * window and the once / every-visit display rules.
 *
 *   npm run test:announcement-popup
 */

import assert from "node:assert";

import {
  DEFAULT_ANNOUNCEMENT_POPUP,
  normalizeAnnouncementPopup,
  preparePopupForSave,
  validatePopup,
  shouldShowPopup,
  isWithinSchedule,
  rememberSeen,
  parseSeenVersions,
  isSafeImageUrl,
  MAX_SEEN_VERSIONS,
  POPUP_LIMITS,
  type StoredPopup,
} from "../src/lib/storefront/announcement-popup";

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

const TODAY = "2026-10-30";
const NOT_SEEN = { seenVersions: [], shownThisVisit: false };

function live(over: Partial<StoredPopup> = {}): StoredPopup {
  return preparePopupForSave(
    { ...DEFAULT_ANNOUNCEMENT_POPUP, enabled: true, title: "GHK-Cu is back", ...over },
    new Date("2026-10-30T00:00:00Z"),
  );
}

console.log("\nnormalizeAnnouncementPopup");
check("garbage → the everything-off default, never throws", () => {
  for (const raw of [null, undefined, 42, "x", [], { enabled: "yes" }]) {
    const p = normalizeAnnouncementPopup(raw);
    assert.equal(p.enabled, false);
    assert.equal(p.kind, "announcement");
    assert.equal(p.layout, "stacked");
  }
});
check("unknown enums fall back; text is clamped", () => {
  const p = normalizeAnnouncementPopup({
    kind: "spam", layout: "huge", frequency: "always",
    title: "t".repeat(500), message: "m".repeat(5000),
  });
  assert.equal(p.kind, "announcement");
  assert.equal(p.layout, "stacked");
  assert.equal(p.frequency, "once");
  assert.equal(p.title.length, POPUP_LIMITS.title);
  assert.equal(p.message.length, POPUP_LIMITS.message);
});
check("unsafe link / missing product degrade the button to close", () => {
  assert.equal(normalizeAnnouncementPopup({ action: "link", linkUrl: "javascript:alert(1)" }).action, "close");
  assert.equal(normalizeAnnouncementPopup({ action: "link", linkUrl: "http://x.com" }).action, "close");
  assert.equal(normalizeAnnouncementPopup({ action: "link", linkUrl: "https://x.com" }).action, "link");
  assert.equal(normalizeAnnouncementPopup({ action: "product", productId: "" }).action, "close");
  assert.equal(normalizeAnnouncementPopup({ action: "product", productId: "p1" }).action, "product");
});
check("unknown page falls back to the catalog", () => {
  assert.equal(normalizeAnnouncementPopup({ action: "page", linkPage: "admin" }).linkPage, "catalog");
  assert.equal(normalizeAnnouncementPopup({ action: "page", linkPage: "coa" }).linkPage, "coa");
});
check("images: https or small inline image only; aspect clamped", () => {
  assert.equal(normalizeAnnouncementPopup({ image: { url: "javascript:x" } }).image, null);
  assert.equal(normalizeAnnouncementPopup({ image: { url: "data:text/html;base64,AAAA" } }).image, null);
  assert.equal(isSafeImageUrl("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(isSafeImageUrl(`data:image/png;base64,${"A".repeat(2_000_000)}`), false);
  const img = normalizeAnnouncementPopup({ image: { url: "https://ik.imagekit.io/a.jpg", aspect: 99 } }).image;
  assert.deepEqual(img, { url: "https://ik.imagekit.io/a.jpg", aspect: 2.5 });
});
check("dates must be real calendar days; delay is clamped", () => {
  const p = normalizeAnnouncementPopup({ startDate: "2026-02-30", endDate: "2026-11-05", delaySeconds: 999 });
  assert.equal(p.startDate, "");
  assert.equal(p.endDate, "2026-11-05");
  assert.equal(p.delaySeconds, 30);
  assert.equal(normalizeAnnouncementPopup({ delaySeconds: -4 }).delaySeconds, 0);
});

console.log("\npreparePopupForSave + version");
check("fills the kind's default button and trims text", () => {
  const p = preparePopupForSave({ ...DEFAULT_ANNOUNCEMENT_POPUP, kind: "drop", title: "  New  " });
  assert.equal(p.title, "New");
  assert.equal(p.buttonLabel, "Shop the drop");
  assert.ok(p.version.startsWith("v"));
  assert.ok(p.updatedAt);
});
check("drops target fields the action does not use", () => {
  const p = preparePopupForSave({
    ...DEFAULT_ANNOUNCEMENT_POPUP, title: "x", action: "page", linkUrl: "https://x.com", productId: "p1",
  });
  assert.equal(p.linkUrl, "");
  assert.equal(p.productId, "");
});
check("version changes with content, not with the switch / frequency / schedule", () => {
  const a = live();
  assert.equal(live({ enabled: false }).version, a.version);
  assert.equal(live({ frequency: "every_visit" }).version, a.version);
  assert.equal(live({ endDate: "2026-12-01", delaySeconds: 3 }).version, a.version);
  assert.notEqual(live({ title: "GHK-Cu is back!" }).version, a.version);
  assert.notEqual(live({ code: "SLIM10" }).version, a.version);
});

console.log("\nvalidatePopup");
check("an enabled pop-up needs a title or an image", () => {
  assert.equal(validatePopup({ ...DEFAULT_ANNOUNCEMENT_POPUP, enabled: true })[0]?.field, "title");
  assert.equal(validatePopup({ ...DEFAULT_ANNOUNCEMENT_POPUP, enabled: false }).length, 0);
  const withImage = { ...DEFAULT_ANNOUNCEMENT_POPUP, enabled: true, image: { url: "https://a.b/c.jpg", aspect: 1 } };
  assert.equal(validatePopup(withImage).length, 0);
});
check("flags a bad link, a missing product and a backwards schedule", () => {
  const fields = (over: object) => validatePopup({ ...DEFAULT_ANNOUNCEMENT_POPUP, ...over }).map((e) => e.field);
  assert.deepEqual(fields({ action: "link", linkUrl: "x" }), ["linkUrl"]);
  assert.deepEqual(fields({ action: "product" }), ["productId"]);
  assert.deepEqual(fields({ startDate: "2026-11-05", endDate: "2026-11-01" }), ["endDate"]);
});

console.log("\nshouldShowPopup");
check("off, empty or out of schedule never shows", () => {
  assert.equal(shouldShowPopup(live({ enabled: false }), NOT_SEEN, TODAY), false);
  assert.equal(shouldShowPopup(live({ title: "" }), NOT_SEEN, TODAY), false);
  assert.equal(shouldShowPopup(live({ startDate: "2026-11-01" }), NOT_SEEN, TODAY), false);
  assert.equal(shouldShowPopup(live({ endDate: "2026-10-29" }), NOT_SEEN, TODAY), false);
});
check("schedule ends are inclusive", () => {
  assert.equal(isWithinSchedule({ startDate: TODAY, endDate: TODAY }, TODAY), true);
});
check("once: hidden after this version is closed, back when the content changes", () => {
  const p = live();
  assert.equal(shouldShowPopup(p, NOT_SEEN, TODAY), true);
  const seen = { seenVersions: [p.version], shownThisVisit: false };
  assert.equal(shouldShowPopup(p, seen, TODAY), false);
  assert.equal(shouldShowPopup(live({ title: "Another drop" }), seen, TODAY), true);
});
check("every visit: shows despite the seen list, once per visit", () => {
  const p = live({ frequency: "every_visit" });
  assert.equal(shouldShowPopup(p, { seenVersions: [p.version], shownThisVisit: false }, TODAY), true);
  assert.equal(shouldShowPopup(p, { seenVersions: [], shownThisVisit: true }, TODAY), false);
});

console.log("\nseen-list storage");
check("rememberSeen de-dupes and caps the list", () => {
  let seen: string[] = [];
  for (let i = 0; i < MAX_SEEN_VERSIONS + 5; i++) seen = rememberSeen(seen, `v${i}`);
  seen = rememberSeen(seen, "v24");
  assert.equal(seen.length, MAX_SEEN_VERSIONS);
  assert.equal(seen[seen.length - 1], "v24");
  assert.equal(seen.filter((v) => v === "v24").length, 1);
});
check("parseSeenVersions survives junk", () => {
  assert.deepEqual(parseSeenVersions(null), []);
  assert.deepEqual(parseSeenVersions("{oops"), []);
  assert.deepEqual(parseSeenVersions('["a",1,"b"]'), ["a", "b"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
