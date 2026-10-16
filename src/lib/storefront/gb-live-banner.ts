// The Pepweb app's live group-buy strip — the "LIVE · GB #5 is live" bar pinned
// above the customer app's tab bar on every tab while a round is open. The
// owner can switch it off and write its headline, message and button label;
// stored in branding.config.groupBuyLiveBanner, edited in the app's Manage →
// Group buys (saveGroupBuyLiveBannerAction, behind requireGroupBuyAdmin).
//
// A blank field is "automatic", not empty: the headline follows the live
// round's name, the message its description, so the owner never has to
// retype the strip for each new round. `{name}` and `{eta}` work in any field.
//
// Pure + JSON-safe (no React, no DB): the shop catalog renders it server-side
// and the app's admin preview runs the mirror in
// mobile/src/features/admin/group-buys/model.ts (npm run test:gb-live-banner
// pins the two together).

import { renderGbCopy } from "./gb-content";

/** What the owner stores. Blank strings = automatic text from the round. */
export type GroupBuyLiveBannerConfig = {
  enabled: boolean;
  headline: string;
  message: string;
  ctaLabel: string;
};

/** What the app shows: every field filled in. */
export type GroupBuyLiveBannerText = {
  headline: string;
  message: string;
  ctaLabel: string;
};

/** The round fields the strip draws on (GroupBuyBanner has them all). */
export type LiveBannerRound = {
  name: string;
  description: string;
  deliveryEta: string;
};

/** One-line strip: tight caps so it never wraps past two lines on a phone. */
export const GB_LIVE_BANNER_LIMITS = Object.freeze({ headline: 60, message: 140, ctaLabel: 20 });

export const GB_LIVE_BANNER_DEFAULTS: Readonly<GroupBuyLiveBannerConfig> = Object.freeze({
  enabled: true,
  headline: "",
  message: "",
  ctaLabel: "",
});

const FALLBACK_MESSAGE = "Lock your slot at the group price.";
const FALLBACK_CTA = "Join now";

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Normalize the stored (untrusted) config. On unless explicitly `false`, so a
 * store that never touched the setting gets the strip. Never mutates input.
 */
export function normalizeGroupBuyLiveBanner(input: unknown): GroupBuyLiveBannerConfig {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled !== false,
    headline: oneLine(raw.headline, GB_LIVE_BANNER_LIMITS.headline),
    message: oneLine(raw.message, GB_LIVE_BANNER_LIMITS.message),
    ctaLabel: oneLine(raw.ctaLabel, GB_LIVE_BANNER_LIMITS.ctaLabel),
  };
}

/** Fill `{eta}` first, then `{name}` — so a round NAME is never re-expanded. */
function fill(text: string, round: LiveBannerRound): string {
  return renderGbCopy(text, round.deliveryEta).replaceAll("{name}", round.name);
}

/** The strip's text for the live round, or null when the owner switched it off. */
export function renderGroupBuyLiveBanner(config: unknown, round: LiveBannerRound): GroupBuyLiveBannerText | null {
  const c = normalizeGroupBuyLiveBanner(config);
  if (!c.enabled) return null;
  return {
    headline: fill(c.headline, round) || `${round.name} is live`,
    message: fill(c.message, round) || round.description.trim() || FALLBACK_MESSAGE,
    ctaLabel: c.ctaLabel || FALLBACK_CTA,
  };
}
