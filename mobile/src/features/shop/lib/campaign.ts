import type { ShopSaleCampaign } from "@shop-contract";

/**
 * The Sale Campaign's clock, decided on the PHONE — the server ships the window
 * (ShopCatalog.saleCampaign), never a "live" flag. Mirrors campaignPhase /
 * campaignCountdownParts in the website's lib/storefront/sale-campaign.ts
 * (the app can't import website code); npm run test:app-promo holds the two
 * to the same answers. Display only: prices always come from the server.
 */

export type CampaignPhase = "off" | "teaser" | "live" | "ended";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the campaign is relative to `now`. Start inclusive, end exclusive. */
export function campaignPhase(campaign: ShopSaleCampaign | null | undefined, now: number): CampaignPhase {
  if (!campaign) return "off";
  const start = Date.parse(campaign.startsAt);
  const end = Date.parse(campaign.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "off";
  if (now >= end) return "ended";
  if (now >= start) return "live";
  if (campaign.teaser && now >= start - campaign.teaserDays * DAY_MS) return "teaser";
  return "off";
}

/** "2d 04:11:09" / "03:12:44" until `target` (never negative). */
export function countdownText(target: string, now: number): string {
  const left = Math.max(0, Date.parse(target) - now);
  const total = Math.floor(left / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(total / 86_400);
  const hms = `${pad(Math.floor((total % 86_400) / 3_600))}:${pad(Math.floor((total % 3_600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

export type CampaignBarState = { phase: "teaser" | "live"; label: string; clock: string; target: string };

/** The bar's state for `now`, or null when it shouldn't show. */
export function campaignBar(campaign: ShopSaleCampaign | null | undefined, now: number): CampaignBarState | null {
  if (!campaign || !campaign.showBar) return null;
  const phase = campaignPhase(campaign, now);
  if (phase !== "teaser" && phase !== "live") return null;
  const target = phase === "live" ? campaign.endsAt : campaign.startsAt;
  return { phase, label: phase === "live" ? "ends in" : "starts in", clock: countdownText(target, now), target };
}
