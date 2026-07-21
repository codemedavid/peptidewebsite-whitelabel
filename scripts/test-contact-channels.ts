/**
 * Self-contained test for the storefront order contact channels (no DB, no
 * Next). Focus: Instagram is a first-class order channel alongside WhatsApp /
 * Telegram / Messenger / Viber / Gmail.
 *
 *   - CONTACT_CHANNEL_META lists Instagram (drives admin form + normalization)
 *   - normalizeContactChannels([]) back-fills a disabled Instagram entry
 *   - CHANNEL_LABELS.instagram is the customer-facing button label
 *   - channelUrl() builds the ig.me/m DM deep link (strips a leading "@")
 *   - channelPrefills("instagram") is false (IG can't carry a prefilled DM)
 *   - buildEmailBrand() surfaces Instagram as the email support link
 *
 *   npm run test:contact-channels
 */

import assert from "node:assert";

import {
  CHANNEL_LABELS,
  channelUrl,
  channelPrefills,
} from "../src/storefront/checkout";
import {
  CONTACT_CHANNEL_META,
  normalizeContactChannels,
} from "../src/lib/storefront/contact-channels";
import { buildEmailBrand } from "../src/lib/analytics/events";
import type { ContactChannel, ContactChannelType } from "../src/storefront/types";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

const ig = (destination: string, enabled = true): ContactChannel => ({
  type: "instagram" as ContactChannelType,
  destination,
  enabled,
});

console.log("\nContact channels — Instagram order channel\n");

check("CONTACT_CHANNEL_META includes Instagram with a label", () => {
  const meta = CONTACT_CHANNEL_META.find((m) => m.type === "instagram");
  assert.ok(meta, "Instagram missing from CONTACT_CHANNEL_META");
  assert.strictEqual(meta!.label, "Instagram");
  assert.ok(meta!.placeholder.length > 0, "Instagram needs a placeholder");
  assert.ok(meta!.hint.length > 0, "Instagram needs a hint");
});

check("normalizeContactChannels([]) back-fills a disabled Instagram entry", () => {
  const channels = normalizeContactChannels([]);
  const found = channels.find((c) => c.type === "instagram");
  assert.ok(found, "Instagram not back-filled by normalizer");
  assert.strictEqual(found!.enabled, false);
  assert.strictEqual(found!.destination, "");
});

check("normalizeContactChannels preserves a saved Instagram destination", () => {
  const channels = normalizeContactChannels([
    { type: "instagram", destination: "  @mystore ", enabled: true },
  ]);
  const found = channels.find((c) => c.type === "instagram");
  assert.strictEqual(found!.destination, "@mystore"); // trimmed
  assert.strictEqual(found!.enabled, true);
});

check("CHANNEL_LABELS.instagram is 'Instagram'", () => {
  assert.strictEqual(CHANNEL_LABELS.instagram, "Instagram");
});

check("channelUrl builds an ig.me/m DM link", () => {
  assert.strictEqual(channelUrl(ig("mystore"), "New order"), "https://ig.me/m/mystore");
});

check("channelUrl strips a leading @ from the handle", () => {
  assert.strictEqual(channelUrl(ig("@mystore"), "New order"), "https://ig.me/m/mystore");
});

check("channelUrl trims surrounding whitespace", () => {
  assert.strictEqual(channelUrl(ig("  mystore  "), "New order"), "https://ig.me/m/mystore");
});

check("channelPrefills('instagram') is false (no prefilled DM)", () => {
  assert.strictEqual(channelPrefills("instagram"), false);
});

check("buildEmailBrand surfaces Instagram as the support link", () => {
  const brand = buildEmailBrand({
    name: "My Store",
    contactChannels: [ig("@mystore")],
  });
  assert.ok(brand, "expected an EmailBrand");
  assert.strictEqual(brand!.supportUrl, "https://ig.me/m/mystore");
  assert.strictEqual(brand!.supportLabel, "Instagram");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
