// Hero group-buy countdown — a live "closes in / opens in" timer inside the
// storefront hero. The owner switches it on/off and may put a line of text on
// top of it; stored in branding.config.heroCountdown, edited in the store
// admin's Group Buys screen (saveHeroCountdownAction, behind
// requireGroupBuyAdmin).
//
// What it counts down to is derived from the rounds, never typed in:
//   • a live round with an end date  → "closing" to its endsAt
//   • otherwise, the next scheduled round that will auto-open → "opening" to
//     its startsAt (only with groupbuy.scheduled — without it a scheduled
//     round never opens by itself, so a countdown to it would lie)
//
// It is tied to the round's LISTING too, not just its dates: a "closes in"
// timer only runs while the group-buy page has something to order
// (countdownForListing), so the hero can never tick above "No group buy right
// now" (mnm-pepsabuy, 2026-10-29).
//
// Pure + JSON-safe (no React, no DB): storefront-brand.ts resolves it
// server-side and the hero just ticks the clock.

import { effectiveGroupBuyStatus, liveGroupBuys, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import type { GroupBuyBanner } from "./group-buy-banner";

type RoundScope = Pick<GroupBuyBanner, "coversAll" | "productIds">;
type ListedProduct = { id: string; available?: boolean };

/** What the owner stores. Blank heading = the automatic text for the phase. */
export type HeroCountdownConfig = {
  enabled: boolean;
  showHeading: boolean;
  closingHeading: string;
  openingHeading: string;
};

export type HeroCountdownPhase = "closing" | "opening";

/** What the hero renders: the target instant + the resolved heading. */
export type HeroCountdown = {
  phase: HeroCountdownPhase;
  target: string; // ISO
  roundName: string;
  heading: string | null; // null = the owner turned the heading off
};

export const HERO_COUNTDOWN_LIMITS = Object.freeze({ heading: 80 });

export const HERO_COUNTDOWN_DEFAULTS: Readonly<HeroCountdownConfig> = Object.freeze({
  enabled: false,
  showHeading: true,
  closingHeading: "",
  openingHeading: "",
});

export const HERO_COUNTDOWN_AUTO_HEADING: Readonly<Record<HeroCountdownPhase, string>> = Object.freeze({
  closing: "{name} closes in",
  opening: "{name} opens in",
});

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Normalize the stored (untrusted) config. OFF unless explicitly `true`, so no
 * existing store grows a timer it never asked for; the heading shows unless
 * explicitly `false`. Never mutates input.
 */
export function normalizeHeroCountdown(input: unknown): HeroCountdownConfig {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled === true,
    showHeading: raw.showHeading !== false,
    closingHeading: oneLine(raw.closingHeading, HERO_COUNTDOWN_LIMITS.heading),
    openingHeading: oneLine(raw.openingHeading, HERO_COUNTDOWN_LIMITS.heading),
  };
}

/** The heading for a phase: the owner's text (or the automatic one), `{name}` filled. */
export function heroCountdownHeading(config: HeroCountdownConfig, phase: HeroCountdownPhase, roundName: string): string {
  const typed = phase === "closing" ? config.closingHeading : config.openingHeading;
  return (typed || HERO_COUNTDOWN_AUTO_HEADING[phase]).replaceAll("{name}", roundName || "Group buy");
}

/** Which round to count toward, and to which instant. null = nothing to count. */
export function pickCountdownTarget(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled">,
  now: Date = new Date(),
): { phase: HeroCountdownPhase; target: string; roundName: string } | null {
  const live = liveGroupBuys(list, caps, now)[0];
  if (live) {
    // An open-ended live round has no close to count to. It also blocks an
    // "opening" countdown: the next round can't open while this one runs.
    return live.endsAt ? { phase: "closing", target: live.endsAt, roundName: live.name } : null;
  }
  if (!caps.scheduled) return null;
  const t = now.getTime();
  const next = list
    .filter(
      (gb) =>
        gb.startsAt !== null &&
        new Date(gb.startsAt).getTime() > t &&
        effectiveGroupBuyStatus(gb, caps.scheduled, now) === "scheduled",
    )
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!))[0];
  return next ? { phase: "opening", target: next.startsAt!, roundName: next.name } : null;
}

/** The hero's countdown, or null when it's switched off or nothing is coming up. */
export function resolveHeroCountdown(
  config: unknown,
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled">,
  now: Date = new Date(),
): HeroCountdown | null {
  const c = normalizeHeroCountdown(config);
  if (!c.enabled) return null;
  const pick = pickCountdownTarget(list, caps, now);
  if (!pick) return null;
  return {
    ...pick,
    heading: c.showHeading ? heroCountdownHeading(c, pick.phase, pick.roundName) : null,
  };
}

/**
 * Keep a "closing" countdown only while the live round lists something a
 * shopper can order — the same membership + availability rule the group-buy
 * page applies (buildGroupBuyPageView). An "opening" timer has no listing yet,
 * and with no banner (a paid-access teaser hides it) the timer is left as is.
 */
export function countdownForListing(
  countdown: HeroCountdown | null,
  banner: RoundScope | null | undefined,
  products: readonly ListedProduct[],
): HeroCountdown | null {
  if (!countdown || countdown.phase !== "closing" || !banner) return countdown;
  const inRound = banner.coversAll ? null : new Set(banner.productIds);
  const listed = products.some((p) => p.available !== false && (inRound?.has(p.id) ?? true));
  return listed ? countdown : null;
}

/**
 * The rounds and the catalog are cached separately, so a direct-DB catalog swap
 * can leave the rounds pointing at products the cached catalog has never seen
 * — the round renders empty while its countdown runs. True when the live round
 * names products and NONE of them is in the catalog: the caller then re-reads
 * the catalog live.
 */
export function catalogMissesRound(banner: RoundScope | null | undefined, catalogIds: readonly string[]): boolean {
  if (!banner || banner.coversAll || banner.productIds.length === 0) return false;
  const ids = new Set(catalogIds);
  return !banner.productIds.some((id) => ids.has(id));
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number; done: boolean };

/** Split the time left into clock parts. Never negative; `done` once it hits zero. */
export function countdownParts(targetIso: string, nowMs: number): CountdownParts {
  const left = Math.max(0, new Date(targetIso).getTime() - nowMs);
  const totalSeconds = Math.floor(left / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    done: left === 0,
  };
}
