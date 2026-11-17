// Contact Methods (owner path): destination validation + the public channel list
// the app's "Forgot password?" screen and checkout read. Pure — no DB.
import assert from "node:assert/strict";
import { cleanContactDestination, parseOwnerContactChannels, publicContactChannels } from "../src/lib/storefront/contact-methods";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
const ok = (r: ReturnType<typeof cleanContactDestination>) => (r.ok ? r.value : `ERR:${r.error}`);

check("WhatsApp / Viber become bare international digits", () => {
  assert.equal(ok(cleanContactDestination("whatsapp", "+63 917-123-4567")), "639171234567");
  assert.equal(ok(cleanContactDestination("viber", "(63) 917 123 4567")), "639171234567");
});
check("a too-short or lettered phone is refused with a fix-it message", () => {
  assert.match(ok(cleanContactDestination("whatsapp", "12345")), /^ERR:.*country code/);
  assert.match(ok(cleanContactDestination("viber", "call me")), /^ERR:/);
});
check("Telegram takes a username or a phone, and unwraps t.me links", () => {
  assert.equal(ok(cleanContactDestination("telegram", "@MyStore")), "MyStore");
  assert.equal(ok(cleanContactDestination("telegram", "https://t.me/mystore")), "mystore");
  assert.equal(ok(cleanContactDestination("telegram", "+63 917 123 4567")), "+639171234567");
});
check("Messenger and Instagram strip pasted profile URLs", () => {
  assert.equal(ok(cleanContactDestination("messenger", "https://www.facebook.com/mystore/")), "mystore");
  assert.equal(ok(cleanContactDestination("messenger", "m.me/my.store")), "my.store");
  assert.equal(ok(cleanContactDestination("instagram", "https://instagram.com/my_store?igsh=x")), "my_store");
  assert.match(ok(cleanContactDestination("instagram", "my store")), /^ERR:/);
});
check("email must look like an address and is lower-cased", () => {
  assert.equal(ok(cleanContactDestination("gmail", "Store@Gmail.com")), "store@gmail.com");
  assert.match(ok(cleanContactDestination("gmail", "store@gmail")), /^ERR:/);
});
check("an enabled channel with no details is refused", () => {
  const r = parseOwnerContactChannels([{ type: "whatsapp", destination: "  ", enabled: true }]);
  assert.equal(r.ok, false);
});
check("disabled channels keep what was typed (one tap to turn back on)", () => {
  const r = parseOwnerContactChannels([{ type: "viber", destination: "not a number", enabled: false }]);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.channels.find((c) => c.type === "viber")?.destination, "not a number");
});
check("the saved set is always all six channels in canonical order", () => {
  const r = parseOwnerContactChannels([{ type: "gmail", destination: "a@b.co", enabled: true }, { type: "bogus", destination: "x", enabled: true }]);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.channels.map((c) => c.type), ["whatsapp", "telegram", "messenger", "viber", "gmail", "instagram"]);
});
check("non-array input is refused", () => {
  assert.equal(parseOwnerContactChannels("whatsapp").ok, false);
  assert.equal(parseOwnerContactChannels(null).ok, false);
});
check("public list = enabled with a destination only, labelled", () => {
  const list = publicContactChannels([
    { type: "whatsapp", destination: "639171234567", enabled: true },
    { type: "messenger", destination: "mystore", enabled: false },
    { type: "gmail", destination: "", enabled: true },
  ]);
  assert.deepEqual(list, [{ type: "whatsapp", label: "WhatsApp", destination: "639171234567" }]);
  assert.deepEqual(publicContactChannels(undefined), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
