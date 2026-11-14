// Sale Campaign ("Mega Sale") — one owner-set start/end window that switches a
// store's promo pieces on together, the way Shopee/TikTok run 11.11:
//
//   • a countdown bar across the top of the storefront (teaser → live),
//   • product sale prices marked "Only during the sale" (Product.saleCampaignOnly),
//   • promo codes marked "Only during the sale" (PromoCode.campaignOnly),
//   • the free-shipping threshold when marked "Only during the sale".
//
// Before this, a seller running 11.11 had to flip five settings by hand at
// midnight and again when it ended. Now each piece names the campaign and the
// clock does the flipping.
//
// HOW THE CLOCK STAYS HONEST. Nothing here asks "is it live?" at render time on
// the server — the storefront render is cached, so a phase computed there would
// be frozen at whatever moment the cache filled. Instead the server ships the
// WINDOW (startsAt/endsAt), stamped onto each campaign-only product, and every
// pricing call checks it against the clock where it runs: the shopper's browser
// for display, the server at placement. A tab left open past midnight re-prices
// on its next render, and placement can never charge a sale that has ended.
//
// FAIL CLOSED. No grant, no saved campaign, or the owner's switch off → no
// window at all → every campaign-only sale, code and free-shipping rule is
// simply inactive. A product's own sale price is never deleted, so switching
// the campaign back on restores everything untouched.
//
// Pure (no React, no DB). Shared by the storefront, the store admin, the server
// placement and the app catalog. Covered by npm run test:mega-sale.

/** What the store owner saves (branding.config.saleCampaign). */
export type SaleCampaignConfig = {
  enabled: boolean;
  /** Shopper-facing name, e.g. "11.11 Mega Sale". */
  name: string;
  /** ISO instant the sale goes live. */
  startsAt: string;
  /** ISO instant the sale ends. Always after startsAt once normalized. */
  endsAt: string;
  /** Show the "starts in" teaser countdown before the sale (default on). */
  teaser: boolean;
  /** How many days before startsAt the teaser bar appears (1–30). */
  teaserDays: number;
  /** Show the countdown bar across the top of the storefront (default on). */
  showBar: boolean;
};

/** The part every pricing surface needs — just the two instants. */
export type CampaignWindow = { startsAt: string; endsAt: string };

export type CampaignPhase = "off" | "teaser" | "live" | "ended";

export const CAMPAIGN_NAME_MAX = 60;
export const DEFAULT_CAMPAIGN_NAME = "Mega Sale";
export const DEFAULT_TEASER_DAYS = 3;
const MAX_TEASER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const EMPTY_SALE_CAMPAIGN: SaleCampaignConfig = {
  enabled: false,
  name: DEFAULT_CAMPAIGN_NAME,
  startsAt: "",
  endsAt: "",
  teaser: true,
  teaserDays: DEFAULT_TEASER_DAYS,
  showBar: true,
};

/** A parseable instant as a canonical ISO string, else "". */
function isoOrEmpty(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Coerce untrusted config/client input into a clean campaign. A campaign whose
 * dates are missing or out of order can never be live, so it is saved with
 * `enabled: false` rather than as an "on" campaign that silently does nothing.
 */
export function normalizeSaleCampaign(input: unknown): SaleCampaignConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const startsAt = isoOrEmpty(o.startsAt);
  const endsAt = isoOrEmpty(o.endsAt);
  const datesValid = !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  const name = typeof o.name === "string" ? o.name.trim().slice(0, CAMPAIGN_NAME_MAX) : "";
  const days = Math.round(Number(o.teaserDays));
  return {
    enabled: o.enabled === true && datesValid,
    name: name || DEFAULT_CAMPAIGN_NAME,
    startsAt,
    endsAt,
    teaser: o.teaser !== false,
    teaserDays: Number.isFinite(days) && days >= 1 ? Math.min(days, MAX_TEASER_DAYS) : DEFAULT_TEASER_DAYS,
    showBar: o.showBar !== false,
  };
}

/** Why a campaign can't be saved as ON, or null when it can. */
export function saleCampaignError(input: unknown): string | null {
  const o = (input ?? {}) as Record<string, unknown>;
  if (o.enabled !== true) return null;
  const startsAt = isoOrEmpty(o.startsAt);
  const endsAt = isoOrEmpty(o.endsAt);
  if (!startsAt || !endsAt) return "Set both a start and an end time for the sale.";
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return "The sale has to end after it starts.";
  return null;
}

/**
 * The window every campaign-only price, code and shipping rule keys off — or
 * null when nothing should run (no grant, switched off, or bad dates).
 * Deliberately time-free: the caller's clock decides live vs not.
 */
export function campaignWindow(
  campaign: SaleCampaignConfig | null | undefined,
  entitled: boolean,
): CampaignWindow | null {
  if (!entitled || !campaign?.enabled) return null;
  if (!campaign.startsAt || !campaign.endsAt) return null;
  if (Date.parse(campaign.endsAt) <= Date.parse(campaign.startsAt)) return null;
  return { startsAt: campaign.startsAt, endsAt: campaign.endsAt };
}

/** Is `now` inside the window? Start inclusive, end exclusive. */
export function isWindowLive(window: CampaignWindow | null | undefined, now: number = Date.now()): boolean {
  if (!window) return false;
  const start = Date.parse(window.startsAt);
  const end = Date.parse(window.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start && now < end;
}

/** Where the campaign is relative to `now` — drives the countdown bar. */
export function campaignPhase(
  campaign: SaleCampaignConfig | null | undefined,
  entitled: boolean,
  now: number = Date.now(),
): CampaignPhase {
  const window = campaignWindow(campaign, entitled);
  if (!window || !campaign) return "off";
  const start = Date.parse(window.startsAt);
  const end = Date.parse(window.endsAt);
  if (now >= end) return "ended";
  if (now >= start) return "live";
  if (campaign.teaser && now >= start - campaign.teaserDays * DAY_MS) return "teaser";
  return "off";
}

/** The fields the sale rule reads off a product. */
export type CampaignSaleSource = {
  saleCampaignOnly?: boolean;
  campaignWindow?: CampaignWindow;
};

/**
 * Stamp the campaign window onto every product whose sale is campaign-only, so
 * the pricing rule (lib/storefront/sale) can check it against the clock. A
 * TRANSIENT field: normalizeProductInput never names it, so an admin save can't
 * persist it. Any stale stamp is cleared first — a product can only ever carry
 * the window the server resolved for this request. Returns new objects; the
 * input array is not mutated.
 */
export function stampCampaignWindow<T extends CampaignSaleSource>(
  products: T[],
  window: CampaignWindow | null,
): T[] {
  return products.map((p) => {
    const { campaignWindow: _stale, ...rest } = p;
    void _stale;
    if (p.saleCampaignOnly !== true || !window) return rest as T;
    return { ...rest, campaignWindow: { ...window } } as T;
  });
}

/**
 * Whether a product's sale may run right now. An ordinary sale always may; a
 * campaign-only sale needs its stamped window to be live.
 */
export function campaignSaleOpen(p: CampaignSaleSource, now: number = Date.now()): boolean {
  if (p.saleCampaignOnly !== true) return true;
  return isWindowLive(p.campaignWindow, now);
}

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
};

/** Split the time left until `target` into clock units (never negative). */
export function campaignCountdownParts(target: string, now: number): CountdownParts {
  const left = Math.max(0, Date.parse(target) - now);
  const totalSeconds = Math.floor(left / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    done: left <= 0,
  };
}
