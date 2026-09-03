/**
 * CHANNEL-LESS CHECKOUT — taking an order with no chat channel to hand it to.
 *
 * Grounding: the storefront has never had an in-app "place order" button. Every
 * order is placed BY a contact-channel button — the drawer's footer renders one
 * per active channel (WhatsApp / Viber / Messenger / Telegram / Instagram /
 * Gmail) and `placeOrder(channelType)` refuses to run without one. So a tenant
 * that has enabled NO channel gets, at the end of a filled-in checkout:
 *
 *     "Online checkout isn't set up yet — please contact the store directly."
 *
 * …and no button at all. The cart is a dead end. This is purely a CLIENT gate:
 * placeStorefrontOrderAction has never required a channel (it stores
 * `contactMethod` as a free string), so the server already accepts these orders.
 *
 * The fix gives such a store a DIRECT hand-off: place the order on the site, then
 * land on the confirmation screen as a thank-you — order received, wait for our
 * confirmation, track it by number — and remember that number in a cookie so the
 * Track page can look it up without the customer retyping it.
 *
 * What this suite locks:
 *   1. ENGINE      — resolveHandoffMode is the ONE predicate both screens branch
 *                    on, and it reads "active" exactly as activeChannels does
 *                    (enabled AND a non-blank destination).
 *   2. COOKIE      — the recent-order cookie round-trips, is name-exact, and
 *                    refuses junk (it is echoed into a lookup field).
 *   3. CART        — the drawer no longer dead-ends; a channel-free place-order
 *                    path exists and remembers the order number.
 *   4. CONFIRM     — the confirmation screen reads as a THANK-YOU in direct mode
 *                    (not "finalize your order"), and points at the tracker only
 *                    when the owner actually serves that page.
 *   5. TRACK       — the tracker seeds itself from the cookie.
 *   6. NO REGRESSION — a store WITH channels keeps the chat hand-off untouched.
 *
 * Run:
 *   npm run test:channelless-checkout
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Brand, ContactChannel } from "../src/storefront/types";
import { activeChannels } from "../src/storefront/checkout";
import { resolveHandoffMode, isDirectHandoff } from "../src/lib/storefront/checkout-handoff";
import {
  RECENT_ORDER_COOKIE,
  buildRecentOrderCookie,
  readRecentOrderCookie,
  sanitizeOrderNumber,
} from "../src/lib/storefront/recent-order";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name} — ${(err as Error).message}`);
  }
}

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** A Brand carrying only what the hand-off predicate reads. */
function brandWith(channels: ContactChannel[]): Brand {
  return { contactChannels: channels } as unknown as Brand;
}

const CH = (over: Partial<ContactChannel>): ContactChannel => ({
  type: "whatsapp",
  destination: "639171234567",
  enabled: true,
  ...over,
});

// ───────────────────────────── 1. ENGINE ─────────────────────────────────────
console.log("\nENGINE — which hand-off a store is in");

check("a store with no contactChannels field at all is direct", () => {
  assert.equal(resolveHandoffMode({} as Brand), "direct");
  assert.equal(isDirectHandoff({} as Brand), true);
});

check("an empty channel list is direct", () => {
  assert.equal(resolveHandoffMode(brandWith([])), "direct");
});

check("channels that all sit disabled are direct", () => {
  const b = brandWith([
    CH({ type: "whatsapp", enabled: false }),
    CH({ type: "viber", enabled: false, destination: "639170000000" }),
  ]);
  assert.equal(resolveHandoffMode(b), "direct");
});

check("an enabled channel with no destination is direct", () => {
  assert.equal(resolveHandoffMode(brandWith([CH({ destination: "" })])), "direct");
});

check("an enabled channel whose destination is only whitespace is direct", () => {
  assert.equal(resolveHandoffMode(brandWith([CH({ destination: "   " })])), "direct");
});

check("one genuinely active channel puts the store back in channel mode", () => {
  const b = brandWith([
    CH({ type: "whatsapp", enabled: false }),
    CH({ type: "gmail", destination: "store@gmail.com" }),
  ]);
  assert.equal(resolveHandoffMode(b), "channels");
  assert.equal(isDirectHandoff(b), false);
});

check("the predicate agrees with activeChannels on every shape", () => {
  // The two must never disagree: the drawer decides which footer to render from
  // one and which buttons to render from the other.
  const shapes: ContactChannel[][] = [
    [],
    [CH({ enabled: false })],
    [CH({ destination: "" })],
    [CH({ destination: " " })],
    [CH({})],
    [CH({ enabled: false }), CH({ type: "telegram", destination: "@store" })],
  ];
  for (const channels of shapes) {
    const b = brandWith(channels);
    const expected = activeChannels(b).length === 0 ? "direct" : "channels";
    assert.equal(resolveHandoffMode(b), expected, `disagreed on ${JSON.stringify(channels)}`);
  }
});

// ───────────────────────────── 2. COOKIE ─────────────────────────────────────
console.log("\nCOOKIE — remembering the customer's most recent order number");

check("the cookie is named sf_last_order", () => {
  assert.equal(RECENT_ORDER_COOKIE, "sf_last_order");
});

check("a built cookie carries the number, a path, a lifetime and SameSite=Lax", () => {
  const c = buildRecentOrderCookie("TBS-1234");
  assert.match(c, /^sf_last_order=TBS-1234;/);
  assert.match(c, /Path=\//);
  assert.match(c, /Max-Age=\d+/);
  assert.match(c, /SameSite=Lax/);
});

check("a built cookie is never a session cookie with a zero lifetime", () => {
  const age = Number(/Max-Age=(\d+)/.exec(buildRecentOrderCookie("TBS-1"))?.[1] ?? 0);
  assert.ok(age > 60 * 60 * 24, `expected a multi-day lifetime, got ${age}s`);
});

check("a number written is the number read back", () => {
  const c = buildRecentOrderCookie("HP-000482");
  assert.equal(readRecentOrderCookie(c.split(";")[0]), "HP-000482");
});

check("the number is found among other cookies, in any position", () => {
  assert.equal(readRecentOrderCookie("a=1; sf_last_order=NL-77; b=2"), "NL-77");
  assert.equal(readRecentOrderCookie("sf_last_order=NL-77; b=2"), "NL-77");
  assert.equal(readRecentOrderCookie("a=1;sf_last_order=NL-77"), "NL-77");
});

check("a missing / empty / malformed cookie header reads as nothing", () => {
  assert.equal(readRecentOrderCookie(""), "");
  assert.equal(readRecentOrderCookie("a=1; b=2"), "");
  assert.equal(readRecentOrderCookie("sf_last_order"), "");
  assert.equal(readRecentOrderCookie("sf_last_order="), "");
  assert.equal(readRecentOrderCookie(undefined as unknown as string), "");
});

check("a cookie whose name merely ENDS with the key is not mistaken for it", () => {
  // "xsf_last_order" and "my_sf_last_order" must not match — a naive
  // indexOf/includes scan would hand the tracker somebody else's value.
  assert.equal(readRecentOrderCookie("xsf_last_order=NOPE"), "");
  assert.equal(readRecentOrderCookie("my_sf_last_order=NOPE; a=1"), "");
  assert.equal(readRecentOrderCookie("xsf_last_order=NOPE; sf_last_order=YES-1"), "YES-1");
});

check("junk is refused rather than echoed into the lookup field", () => {
  // This value is written straight into a search input and a server lookup, so
  // it is sanitized on the way in AND on the way out.
  assert.equal(sanitizeOrderNumber("<script>alert(1)</script>"), "");
  assert.equal(sanitizeOrderNumber(""), "");
  assert.equal(sanitizeOrderNumber("   "), "");
  assert.equal(sanitizeOrderNumber(null), "");
  assert.equal(sanitizeOrderNumber(12345), "");
  assert.equal(readRecentOrderCookie("sf_last_order=%3Cscript%3E"), "");
});

check("an over-long value is refused", () => {
  assert.equal(sanitizeOrderNumber("A".repeat(200)), "");
  assert.equal(buildRecentOrderCookie("A".repeat(200)), "");
});

check("a real order number survives untouched", () => {
  for (const n of ["TBS-1234", "HP-000482", "NL_77", "ORDER.9", "abc-1"]) {
    assert.equal(sanitizeOrderNumber(n), n, `mangled ${n}`);
  }
});

// ───────────────────────────── 3. CART ───────────────────────────────────────
console.log("\nCART — the drawer can place an order with no channel");

const cart = src("src/storefront/components/CartCheckout.tsx");

check("the dead-end 'checkout isn't set up' branch is gone", () => {
  assert.ok(
    !/channels\.length === 0 \?[\s\S]{0,200}sf-cart__unavailable/.test(cart),
    "the drawer still short-circuits the whole footer when no channel is enabled",
  );
});

check("the drawer branches on the shared hand-off predicate", () => {
  assert.match(cart, /from "@\/lib\/storefront\/checkout-handoff"/);
  assert.match(cart, /resolveHandoffMode|isDirectHandoff/);
});

check("direct mode renders a place-order button", () => {
  assert.match(cart, /sf-cart__place/, "expected a dedicated place-order control");
});

check("placeOrder no longer requires a channel", () => {
  // It used to open `const channel = channels.find(...); if (!channel …) return;`
  assert.ok(
    !/if \(!channel \|\| placingRef\.current\) return;/.test(cart),
    "placeOrder still bails out when there is no channel",
  );
});

check("the order number is remembered after a successful placement", () => {
  assert.match(cart, /rememberRecentOrder\s*\(/);
  assert.match(cart, /from "@\/lib\/storefront\/recent-order"/);
});

// ───────────────────────────── 4. CONFIRM ────────────────────────────────────
console.log("\nCONFIRM — the thank-you screen");

const confirm = src("src/storefront/pages/OrderConfirmedPage.tsx");

check("the confirmation page branches on the same shared predicate", () => {
  assert.match(confirm, /from "@\/lib\/storefront\/checkout-handoff"/);
  assert.match(confirm, /resolveHandoffMode|isDirectHandoff/);
});

check("direct mode thanks the customer and asks them to await confirmation", () => {
  assert.match(confirm, /Thank you for placing your order/i);
  assert.match(confirm, /confirmation/i);
});

check("direct mode points at the order tracker", () => {
  assert.match(confirm, /#track/);
});

check("the tracker link is gated on the owner actually serving that page", () => {
  assert.match(confirm, /isPageVisible\s*\(\s*brand\s*,\s*"track"\s*\)/);
});

check("direct mode does not ask the customer to 'finalize' anything", () => {
  // The chat-hand-off headline and the copy-the-message fallback both imply the
  // order is unfinished. In direct mode it is already placed.
  assert.match(
    confirm,
    /!isDirect[\s\S]{0,600}Finalize your order/,
    "the 'Finalize your order' section must be suppressed in direct mode",
  );
});

// ───────────────────────────── 5. TRACK ──────────────────────────────────────
console.log("\nTRACK — the tracker knows the customer's last order");

const track = src("src/storefront/pages/TrackOrderPage.tsx");

check("the tracker recalls the remembered order number", () => {
  assert.match(track, /from "@\/lib\/storefront\/recent-order"/);
  assert.match(track, /recallRecentOrder\s*\(/);
});

check("the recalled number is looked up, not just typed into the box", () => {
  assert.match(track, /useEffect/, "expected a mount effect that seeds the lookup");
});

check("the local recent-orders list is kept as the fallback", () => {
  assert.match(track, /myOrders/);
});

// ───────────────────────── 6. NO REGRESSION ──────────────────────────────────
console.log("\nNO REGRESSION — stores WITH channels are untouched");

check("the drawer still renders one button per active channel", () => {
  assert.match(cart, /channels\.map\(/);
  assert.match(cart, /CHANNEL_LABELS\[c\.type\]/);
});

check("the confirmation page still hands off to every channel", () => {
  assert.match(confirm, /channels\.map\(/);
  assert.match(confirm, /channelUrl\(/);
  assert.match(confirm, /channelPrefills\(/);
});

check("the copy-order fallback survives for the channel hand-off", () => {
  assert.match(confirm, /Copy order details/);
});

check("the store open/closed switch remains the way to stop taking orders", () => {
  // Removing the 'not set up yet' guard must not remove the real one.
  assert.match(cart, /isStoreClosed\s*\(/);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
