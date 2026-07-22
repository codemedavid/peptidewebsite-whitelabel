// Owner-editable Group Buy storefront copy — the "How group buys work" section
// (title + numbered steps) and the live-round terms line ("Pay now to lock your
// slot. Ships {eta}. COA posted before shipping."). One content object, stored in
// branding.config.groupBuyContent and shared by BOTH surfaces that render this
// copy: the two-ways home (TwoWaysHome) and the dedicated group-buy page
// (GroupBuyPage) — so an edit shows up everywhere at once. Part of the Group Buy
// module: the editor lives in the store admin's Group Buys view and the save
// action sits behind the same groupbuy entitlement gate (actions/group-buys.ts).
//
// The `{eta}` placeholder is replaced at render time with the live round's
// customer-facing delivery ETA (GroupBuy.deliveryEta, e.g. "3–4 weeks after the
// group buy closes"), falling back to "after the round closes" when the round
// carries none — so the copy stays correct as rounds come and go.
//
// Pure + JSON-safe (no React, no DB) so page.tsx normalizes it server-side, the
// client just renders, and it's trivially testable (npm run test:gb-content).

/** The owner-editable copy block. Defaults reproduce today's hardcoded copy. */
export type GroupBuyContent = {
  /** Section heading — the "How group buys work" eyebrow on both surfaces. */
  howTitle: string;
  /** Ordered explainer steps; `{eta}` is replaced with the round's delivery ETA. */
  steps: string[];
  /** Live-round terms line (banner/card); `{eta}` behaves the same. */
  terms: string;
};

/** Input caps — generous for copy, tight enough to keep the config JSON sane. */
export const GB_CONTENT_LIMITS = {
  maxSteps: 6,
  maxTitleLen: 80,
  maxTextLen: 300,
} as const;

/** What renders when `{eta}` has no live round ETA to substitute. */
const ETA_FALLBACK = "after the round closes";

// Frozen so a caller mutating a (buggy) shared reference can't rewrite the
// defaults; normalizeGroupBuyContent always hands out fresh copies.
export const GB_CONTENT_DEFAULTS: Readonly<GroupBuyContent> = Object.freeze({
  howTitle: "How group buys work",
  steps: Object.freeze([
    "Browse what's on hand for instant shipping, or join the live group buy for a lower price.",
    "Pay to lock your slot at the group price while the round is open.",
    "When the round closes, we place one bulk order with the supplier.",
    "Your order ships {eta}, COA posted before shipping.",
  ]) as unknown as string[],
  terms: "Pay now to lock your slot. Ships {eta}. COA posted before shipping.",
});

/**
 * Normalize the stored (untrusted) config value into a complete GroupBuyContent.
 * Per-field fallback: a blank/invalid field gets its default while the others
 * keep the owner's text — clearing a field in the editor is "reset to default".
 * Steps are trimmed, non-strings/empties dropped, capped at maxSteps; every
 * string is length-capped. Never mutates the input; always returns fresh arrays.
 */
export function normalizeGroupBuyContent(input: unknown): GroupBuyContent {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const title =
    typeof raw.howTitle === "string"
      ? raw.howTitle.trim().slice(0, GB_CONTENT_LIMITS.maxTitleLen)
      : "";

  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, GB_CONTENT_LIMITS.maxTextLen))
    .filter((s) => s.length > 0)
    .slice(0, GB_CONTENT_LIMITS.maxSteps);

  const terms =
    typeof raw.terms === "string"
      ? raw.terms.trim().slice(0, GB_CONTENT_LIMITS.maxTextLen)
      : "";

  return {
    howTitle: title || GB_CONTENT_DEFAULTS.howTitle,
    steps: steps.length > 0 ? steps : [...GB_CONTENT_DEFAULTS.steps],
    terms: terms || GB_CONTENT_DEFAULTS.terms,
  };
}

/** Replace every `{eta}` with the round's delivery ETA (or the fallback). */
export function renderGbCopy(text: string, deliveryEta: string): string {
  return text.replaceAll("{eta}", deliveryEta || ETA_FALLBACK);
}
