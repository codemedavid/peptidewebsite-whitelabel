/**
 * Gate for "where the buyer contacted you" + the per-status buyer message
 * (src/lib/orders/buyer-contact.ts, src/lib/orders/buyer-update-message.ts).
 *
 *   npm run test:buyer-contact
 */
import assert from "node:assert";

import {
  buyerChannelLink,
  internationalDigits,
  linkCarriesText,
  normalizeBuyerChannel,
  parseBuyerChannelInput,
  resolveBuyerChannel,
  withBuyerChannel,
} from "../src/lib/orders/buyer-contact";
import { buildBuyerUpdateMessage, firstName } from "../src/lib/orders/buyer-update-message";
import { normalizeOrderInput } from "../src/lib/orders/db-mapping";
import type { Order } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const ok = (input: unknown) => {
  const r = parseBuyerChannelInput(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};
const bad = (input: unknown) => {
  const r = parseBuyerChannelInput(input);
  assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(input)}`);
};

console.log("\nphone numbers");
test("PH local 09… widens to +63", () => assert.equal(internationalDigits("0917 123 4567"), "639171234567"));
test("PH 9… without the 0 widens to +63", () => assert.equal(internationalDigits("917-123-4567"), "639171234567"));
test("+63 kept as typed", () => assert.equal(internationalDigits("+63 (917) 123 4567"), "639171234567"));
test("00 international prefix dropped", () => assert.equal(internationalDigits("0044 20 7946 0958"), "442079460958"));
test("letters are not a phone number", () => assert.equal(internationalDigits("call me"), null));
test("too short / too long refused", () => {
  assert.equal(internationalDigits("12345"), null);
  assert.equal(internationalDigits("+1234567890123456"), null);
});

console.log("\nadmin input");
test("WhatsApp number → canonical +digits", () =>
  assert.deepEqual(ok({ app: "whatsapp", handle: "0917 123 4567" }), { app: "whatsapp", handle: "+639171234567" }));
test("WhatsApp refuses a username", () => bad({ app: "whatsapp", handle: "@maria_s" }));
test("Telegram @username kept", () =>
  assert.deepEqual(ok({ app: "telegram", handle: "@Maria_S" }), { app: "telegram", handle: "@Maria_S" }));
test("Telegram username without @ gets one", () =>
  assert.deepEqual(ok({ app: "telegram", handle: "maria_s" }), { app: "telegram", handle: "@maria_s" }));
test("Telegram t.me link reduces to the username", () =>
  assert.deepEqual(ok({ app: "telegram", handle: "https://t.me/maria_s" }), { app: "telegram", handle: "@maria_s" }));
test("Telegram t.me/+phone link → +digits", () =>
  assert.deepEqual(ok({ app: "telegram", handle: "https://t.me/+639171234567" }), { app: "telegram", handle: "+639171234567" }));
test("Telegram phone number → +digits", () =>
  assert.deepEqual(ok({ app: "telegram", handle: "09171234567" }), { app: "telegram", handle: "+639171234567" }));
test("Telegram refuses a too-short username", () => bad({ app: "telegram", handle: "@ab" }));
test("unknown app refused", () => bad({ app: "viber", handle: "0917 123 4567" }));
test("null or blank handle clears", () => {
  assert.equal(ok(null), null);
  assert.equal(ok({ app: "whatsapp", handle: "   " }), null);
});

console.log("\nlinks");
test("WhatsApp link carries the message", () => {
  const ch = { app: "whatsapp" as const, handle: "+639171234567" };
  assert.equal(buyerChannelLink(ch, "Hi & bye"), "https://wa.me/639171234567?text=Hi%20%26%20bye");
  assert.equal(linkCarriesText(ch), true);
});
test("Telegram username / phone links (text must be pasted)", () => {
  assert.equal(buyerChannelLink({ app: "telegram", handle: "@maria_s" }, "x"), "https://t.me/maria_s");
  assert.equal(buyerChannelLink({ app: "telegram", handle: "+639171234567" }), "https://t.me/+639171234567");
  assert.equal(linkCarriesText({ app: "telegram", handle: "@maria_s" }), false);
});

console.log("\nstorage");
test("withBuyerChannel sets, replaces and removes without touching buyer fields", () => {
  const c = { name: "Maria", email: "m@x.com", phone: "0917", contactMethod: "WhatsApp" };
  const set = withBuyerChannel(c, { app: "telegram", handle: "@maria_s" });
  assert.deepEqual(set, { ...c, reachedVia: { app: "telegram", handle: "@maria_s" } });
  assert.deepEqual(withBuyerChannel(set, null), c);
  assert.equal("reachedVia" in c, false, "input not mutated");
});
test("a stored channel survives the row → Order mapping", () => {
  const o = normalizeOrderInput({ items: [], customer: { name: "M", reachedVia: { app: "whatsapp", handle: "+639171234567" } } });
  assert.deepEqual(o.customer.reachedVia, { app: "whatsapp", handle: "+639171234567" });
});
test("a garbage stored channel is dropped, not trusted", () => {
  const o = normalizeOrderInput({ items: [], customer: { name: "M", reachedVia: { app: "sms", handle: "<script>" } } });
  assert.equal(o.customer.reachedVia, undefined);
  assert.equal(normalizeBuyerChannel("whatsapp"), null);
});

console.log("\nremembering a repeat buyer");
const mk = (id: string, date: string, customer: Partial<Order["customer"]>): Order =>
  normalizeOrderInput({ id, date, items: [], customer: { name: "Maria Santos", email: "", phone: "", contactMethod: "", ...customer } });
test("the order's own channel wins", () => {
  const o = mk("a", "2026-11-10", { email: "m@x.com", reachedVia: { app: "telegram", handle: "@mine1" } });
  assert.deepEqual(resolveBuyerChannel(o, []), { channel: { app: "telegram", handle: "@mine1" }, source: "order" });
});
test("else the newest one from the same customer's other orders", () => {
  const o = mk("a", "2026-11-10", { email: "M@x.com" });
  const older = mk("b", "2026-10-01", { email: "m@x.com", reachedVia: { app: "whatsapp", handle: "+639170000001" } });
  const newer = mk("c", "2026-11-01", { email: "m@x.com", reachedVia: { app: "telegram", handle: "@newer" } });
  const stranger = mk("d", "2026-11-09", { email: "other@x.com", reachedVia: { app: "telegram", handle: "@nope1" } });
  assert.deepEqual(resolveBuyerChannel(o, [older, newer, stranger]), {
    channel: { app: "telegram", handle: "@newer" },
    source: "customer",
  });
});
test("else the WhatsApp number typed at checkout, as a suggestion", () => {
  const o = mk("a", "2026-11-10", { email: "m@x.com", whatsapp: "0917 123 4567" });
  assert.deepEqual(resolveBuyerChannel(o, []), { channel: { app: "whatsapp", handle: "+639171234567" }, source: "checkout" });
});
test("nothing known → null", () => assert.equal(resolveBuyerChannel(mk("a", "2026-11-10", { email: "m@x.com" }), []), null));

console.log("\nthe message per status");
const facts = { orderNumber: "HPG-1042", buyerName: "Maria Santos", storeName: "HP Glow", courier: "J&T Express", trackingNumber: "" };
const msg = (status: string, extra: Partial<typeof facts> = {}) => buildBuyerUpdateMessage({ ...facts, ...extra, status });
test("every status has its own message", () => {
  const all = ["new", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled"].map((s) => msg(s));
  assert.equal(new Set(all).size, all.length);
  for (const m of all) {
    assert.ok(m.startsWith("Hi Maria!"), m);
    assert.ok(m.includes("#HPG-1042"), m);
    assert.ok(m.endsWith("— HP Glow"), m);
  }
});
test("shipped carries courier + tracking number", () => {
  const m = msg("shipped", { trackingNumber: "JT0001234567" });
  assert.ok(m.includes("Courier: J&T Express"));
  assert.ok(m.includes("Tracking number: JT0001234567"));
});
test("shipped without a tracking number promises one, never prints a blank", () => {
  const m = msg("shipped");
  assert.ok(!m.includes("Tracking number:"));
  assert.ok(m.includes("We'll send you the tracking number"));
});
test("tracking number is only in the shipped message", () => {
  for (const s of ["confirmed", "processing", "delivered", "cancelled"]) {
    assert.ok(!msg(s, { trackingNumber: "JT0001234567" }).includes("JT0001234567"), s);
  }
});
test("no name → 'Hi there!'; no store → no sign-off", () => {
  assert.equal(firstName("   "), "there");
  const m = msg("confirmed", { buyerName: "", storeName: "" });
  assert.ok(m.startsWith("Hi there!"));
  assert.ok(!m.includes("—  "));
  assert.ok(!/\n\n\n/.test(m));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
