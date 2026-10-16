// Self-contained test gate for the app's live group-buy strip
// (src/lib/storefront/gb-live-banner.ts): the owner's on/off switch + headline,
// message and button label, stored in branding.config.groupBuyLiveBanner and
// rendered against the live round. Pure — no DB, no React.
//
//   npm run test:gb-live-banner
//
// Covers: defaults for missing/garbage config, the switch, trimming + one-line
// collapsing, length caps, blank-field → automatic text from the round,
// {name}/{eta} placeholders, immutability, and parity with the app's mirror
// (mobile/src/features/admin/group-buys/model.ts), which the admin preview uses.

import {
  GB_LIVE_BANNER_DEFAULTS,
  GB_LIVE_BANNER_LIMITS,
  normalizeGroupBuyLiveBanner,
  renderGroupBuyLiveBanner,
} from "../src/lib/storefront/gb-live-banner";
import {
  GB_LIVE_BANNER_LIMITS as APP_LIMITS,
  normalizeGroupBuyLiveBanner as appNormalize,
  renderGroupBuyLiveBanner as appRender,
} from "../mobile/src/features/admin/group-buys/model";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const round = { name: "GB #5", description: "October round", deliveryEta: "3–4 weeks after close" };

// ── normalize ────────────────────────────────────────────────────────────────
console.log("normalize");
eq("undefined → defaults (on, every field automatic)", normalizeGroupBuyLiveBanner(undefined), {
  enabled: true,
  headline: "",
  message: "",
  ctaLabel: "",
});
eq("garbage → defaults", normalizeGroupBuyLiveBanner("nope"), normalizeGroupBuyLiveBanner(undefined));
eq("array → defaults", normalizeGroupBuyLiveBanner([1, 2]), normalizeGroupBuyLiveBanner(undefined));
eq("only an explicit false turns it off", normalizeGroupBuyLiveBanner({ enabled: false }).enabled, false);
eq("a truthy non-boolean stays on", normalizeGroupBuyLiveBanner({ enabled: "no" }).enabled, true);
eq(
  "trims and collapses to one line",
  normalizeGroupBuyLiveBanner({ headline: "  GB  is\n live ", message: "Lock\n\nyour slot ", ctaLabel: " Join " }),
  { enabled: true, headline: "GB is live", message: "Lock your slot", ctaLabel: "Join" },
);
eq("non-strings → blank", normalizeGroupBuyLiveBanner({ headline: 5, message: {}, ctaLabel: null }).headline, "");
{
  const long = normalizeGroupBuyLiveBanner({ headline: "h".repeat(500), message: "m".repeat(500), ctaLabel: "c".repeat(500) });
  eq("headline capped", long.headline.length, GB_LIVE_BANNER_LIMITS.headline);
  eq("message capped", long.message.length, GB_LIVE_BANNER_LIMITS.message);
  eq("button label capped", long.ctaLabel.length, GB_LIVE_BANNER_LIMITS.ctaLabel);
}

// ── render ───────────────────────────────────────────────────────────────────
console.log("\nrender");
eq("switched off → null", renderGroupBuyLiveBanner({ enabled: false }, round), null);
eq("blank fields → automatic text from the round", renderGroupBuyLiveBanner(undefined, round), {
  headline: "GB #5 is live",
  message: "October round",
  ctaLabel: "Join now",
});
eq(
  "no round description → the built-in invitation",
  renderGroupBuyLiveBanner(undefined, { ...round, description: "  " })?.message,
  "Lock your slot at the group price.",
);
eq(
  "owner text wins, with {name} and {eta} filled in",
  renderGroupBuyLiveBanner({ headline: "{name} is OPEN", message: "Ships {eta}.", ctaLabel: "Grab a slot" }, round),
  { headline: "GB #5 is OPEN", message: "Ships 3–4 weeks after close.", ctaLabel: "Grab a slot" },
);
eq(
  "{eta} with no ETA uses the shared fallback",
  renderGroupBuyLiveBanner({ message: "Ships {eta}." }, { ...round, deliveryEta: "" })?.message,
  "Ships after the round closes.",
);
eq(
  "a round name holding a placeholder is not re-expanded",
  renderGroupBuyLiveBanner({ headline: "{name}" }, { ...round, name: "Round {eta}" })?.headline,
  "Round {eta}",
);
eq("raw (un-normalized) config is normalized first", renderGroupBuyLiveBanner({ headline: "   " }, round)?.headline, "GB #5 is live");

// ── immutability ─────────────────────────────────────────────────────────────
console.log("\nimmutability");
{
  const a = normalizeGroupBuyLiveBanner(undefined);
  (a as { headline: string }).headline = "mutated";
  eq("defaults survive result mutation", normalizeGroupBuyLiveBanner(undefined).headline, "");
  eq("exported defaults untouched", GB_LIVE_BANNER_DEFAULTS.enabled, true);
  const frozen = Object.freeze({ enabled: true, headline: " x " });
  let threw = false;
  try {
    normalizeGroupBuyLiveBanner(frozen);
    renderGroupBuyLiveBanner(frozen, Object.freeze({ ...round }));
  } catch {
    threw = true;
  }
  ok("never writes to its input", !threw);
}

// ── app mirror parity ────────────────────────────────────────────────────────
console.log("\napp mirror parity");
eq("same limits", APP_LIMITS, GB_LIVE_BANNER_LIMITS);
const bare = { ...round, deliveryEta: "", description: "" };
const samples: unknown[] = [
  undefined,
  null,
  "x",
  { enabled: false },
  { enabled: "no", headline: "  a\n b ", message: 3, ctaLabel: " Go " },
  { headline: "h".repeat(200), message: "m".repeat(200), ctaLabel: "c".repeat(200) },
  { headline: "{name} live", message: "Ships {eta}", ctaLabel: "" },
];
for (const [i, s] of samples.entries()) {
  eq(`normalize sample ${i}`, appNormalize(s), normalizeGroupBuyLiveBanner(s));
  eq(`render sample ${i}`, appRender(s, round), renderGroupBuyLiveBanner(s, round));
  eq(`render sample ${i} (no ETA, no description)`, appRender(s, bare), renderGroupBuyLiveBanner(s, bare));
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("PASS: gb-live-banner");
