// Responsive layout rules (src/ui/responsive.ts): the app is phone-first, and on
// a tablet or a desktop browser it stays a centred frame with a wider product
// grid instead of stretching edge to edge. Run: npm run test:responsive
import assert from "node:assert/strict";
import {
  APP_MAX_WIDTH,
  READING_MAX_WIDTH,
  appWidth,
  gridColumns,
  isReadingRoute,
  tileWidth,
} from "../src/ui/responsive-rules";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("responsive layout");

test("phones are untouched: the app is as wide as the window", () => {
  assert.equal(appWidth(320), 320);
  assert.equal(appWidth(390), 390);
  assert.equal(appWidth(430), 430);
});

test("big screens: the app frame stops at APP_MAX_WIDTH", () => {
  assert.equal(appWidth(2000), APP_MAX_WIDTH);
  assert.equal(appWidth(APP_MAX_WIDTH + 1), APP_MAX_WIDTH);
});

test("grid: 2 columns on phones, more as the frame widens, never more than 4", () => {
  assert.equal(gridColumns(320), 2);
  assert.equal(gridColumns(430), 2);
  assert.equal(gridColumns(599), 2);
  assert.equal(gridColumns(600), 3); // small tablet / narrow window
  assert.equal(gridColumns(899), 3);
  assert.equal(gridColumns(900), 4);
  assert.equal(gridColumns(APP_MAX_WIDTH), 4);
});

test("tiles fill the row exactly (gutters + gaps) and are whole pixels", () => {
  const tile = tileWidth(390, 2, 16, 12);
  assert.equal(tile, Math.floor((390 - 32 - 12) / 2));
  const wide = tileWidth(APP_MAX_WIDTH, 4, 16, 12);
  assert.ok(wide * 4 + 12 * 3 + 32 <= APP_MAX_WIDTH);
  assert.equal(wide, Math.floor(wide));
});

test("a reading column is narrower than the frame, for forms and lists", () => {
  assert.ok(READING_MAX_WIDTH < APP_MAX_WIDTH);
  assert.ok(READING_MAX_WIDTH >= 560);
});

test("reading column: Chats, Orders and Me tabs (customer + store team) and the screens they open", () => {
  for (const r of ["community", "my-orders", "me", "chats", "orders", "more"]) assert.ok(isReadingRoute(r), r);
  for (const r of [
    "community/channel/[id]",
    "community/dm/[id]",
    "community/topic/[id]",
    "community/members",
    "order/[id]/index",
    "order/[id]/status",
    "my-order/[number]",
    "profile",
    "password",
    "change-password",
    "notifications",
    "delete-account",
    "customers",
    "customer/[key]",
    "customer-account/[id]",
  ])
    assert.ok(isReadingRoute(r), r);
});

test("full width stays full width: grids, charts, the tracker (self-sized) and full-screen media", () => {
  for (const r of ["shop", "products", "insights", "index", "tracker", "storefront", "group-buy", "community/media/[type]/[id]", "tracker/log", "manage/products"])
    assert.equal(isReadingRoute(r), false, r);
});

console.log(`\n${passed} passed`);
