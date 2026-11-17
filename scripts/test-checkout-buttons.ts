/**
 * Self-contained test for the editable checkout button wording
 * (src/lib/storefront/checkout-buttons.ts). No DB, no Next.
 *
 *   npm run test:checkout-buttons
 */

import assert from "node:assert";

import {
  CHECKOUT_BUTTON_DEFAULTS,
  CHECKOUT_BUTTON_MAX,
  CHECKOUT_NUDGE_MAX,
  channelButtonLabel,
  checkoutButtonLabel,
  normalizeCheckoutButtons,
} from "../src/lib/storefront/checkout-buttons";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

console.log("checkout buttons");

check("absent config → every button keeps its built-in wording", () => {
  const b = normalizeCheckoutButtons(undefined);
  assert.equal(checkoutButtonLabel(b, "cart"), "Checkout");
  assert.equal(checkoutButtonLabel(b, "payment"), "Continue to payment");
  assert.equal(checkoutButtonLabel(b, "place"), "Place order");
  assert.equal(checkoutButtonLabel(b, "channelsHeading"), "Send your order via");
});

check("owner wording replaces the default", () => {
  const b = normalizeCheckoutButtons({ cart: "Deserve ko 'to!" });
  assert.equal(checkoutButtonLabel(b, "cart"), "Deserve ko 'to!");
  assert.equal(checkoutButtonLabel(b, "place"), "Place order");
});

check("whitespace-only reads as unset, inner runs collapse", () => {
  const b = normalizeCheckoutButtons({ cart: "   ", place: "  Order   na  " });
  assert.equal(checkoutButtonLabel(b, "cart"), CHECKOUT_BUTTON_DEFAULTS.cart);
  assert.equal(checkoutButtonLabel(b, "place"), "Order na");
});

check("non-strings and junk keys are dropped; long text is capped", () => {
  const b = normalizeCheckoutButtons({ cart: 42, evil: "<script>", payment: "x".repeat(200) });
  assert.equal(b.cart, "");
  assert.equal("evil" in b, false);
  assert.equal(b.payment.length, CHECKOUT_BUTTON_MAX);
});

check("normalizing never mutates the input", () => {
  const input = { cart: "  Hi  " };
  normalizeCheckoutButtons(input);
  assert.deepEqual(input, { cart: "  Hi  " });
});

check("channel button defaults to the channel name", () => {
  const b = normalizeCheckoutButtons({});
  assert.equal(channelButtonLabel(b, "WhatsApp", 2), "WhatsApp");
});

check("{channel} token interpolates", () => {
  const b = normalizeCheckoutButtons({ channel: "Order via {channel}" });
  assert.equal(channelButtonLabel(b, "Telegram", 2), "Order via Telegram");
});

check("token-less text: alone with one channel, suffixed with several", () => {
  const b = normalizeCheckoutButtons({ channel: "Deserve ko 'to" });
  assert.equal(channelButtonLabel(b, "WhatsApp", 1), "Deserve ko 'to");
  assert.equal(channelButtonLabel(b, "WhatsApp", 2), "Deserve ko 'to · WhatsApp");
});

check("nudges default to no line, keep owner text, cap at the longer limit", () => {
  const b = normalizeCheckoutButtons({ cartNudge: "Ilang tap na lang, deserve mo 'to.", paymentNudge: "y".repeat(400) });
  assert.equal(checkoutButtonLabel(b, "detailsNudge"), "");
  assert.equal(checkoutButtonLabel(b, "cartNudge"), "Ilang tap na lang, deserve mo 'to.");
  assert.equal(b.paymentNudge.length, CHECKOUT_NUDGE_MAX);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
