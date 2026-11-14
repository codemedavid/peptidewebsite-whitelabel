import { campaignPhase, type CampaignPhase } from "../../shop/lib/campaign";

/**
 * The website's promo-engine cards (AdminPromoEngine → saveSaleCampaignAction /
 * saveFreeShippingThresholdAction) as pure editor state. The server sanitizes
 * and entitlement-checks every save; this only builds the same payload the
 * website form sends and catches what that form's inputs can't hold.
 *
 * Dates: the website uses <input type="datetime-local"> (the owner's local
 * time); the app takes the same thing typed as "YYYY-MM-DD HH:mm".
 */

type Row = Record<string, unknown>;

export const CAMPAIGN_NAME_MAX = 60;
const DEFAULT_NAME = "Mega Sale";
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → "YYYY-MM-DD HH:mm" in the phone's local time ("" when unset). */
export function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD HH:mm" (local) → ISO instant; "" when blank; null when unreadable. */
export function fromLocalInput(text: string): string | null {
  const v = text.trim();
  if (!v) return "";
  const m = LOCAL_INPUT.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi);
  // Reject roll-overs such as Feb 31 → Mar 3.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString();
}

// ── Sale Campaign ───────────────────────────────────────────────────────────

export type CampaignDraft = {
  enabled: boolean;
  name: string;
  startsAt: string;
  endsAt: string;
  teaser: boolean;
  teaserDays: string;
  showBar: boolean;
};

export function campaignDraftFrom(saved: unknown): CampaignDraft {
  const o = (saved && typeof saved === "object" ? saved : {}) as Row;
  const days = Number(o.teaserDays);
  return {
    enabled: o.enabled === true,
    name: typeof o.name === "string" && o.name ? o.name : DEFAULT_NAME,
    startsAt: toLocalInput(o.startsAt),
    endsAt: toLocalInput(o.endsAt),
    teaser: o.teaser !== false,
    teaserDays: String(Number.isFinite(days) && days >= 1 ? days : 3),
    showBar: o.showBar !== false,
  };
}

const DATE_HINT = "Use the format YYYY-MM-DD HH:mm, e.g. 2026-11-11 00:00.";

/** Per-field date errors (shown under the inputs). */
export function campaignDateErrors(d: CampaignDraft): { startsAt: string | null; endsAt: string | null } {
  return {
    startsAt: fromLocalInput(d.startsAt) === null ? DATE_HINT : null,
    endsAt: fromLocalInput(d.endsAt) === null ? DATE_HINT : null,
  };
}

/** Why this draft can't be saved — the website's saleCampaignError, plus unreadable dates. */
export function campaignDraftError(d: CampaignDraft): string | null {
  const start = fromLocalInput(d.startsAt);
  const end = fromLocalInput(d.endsAt);
  if (start === null || end === null) return "Check the start and end times.";
  if (!d.enabled) return null;
  if (!start || !end) return "Set both a start and an end time for the sale.";
  if (Date.parse(end) <= Date.parse(start)) return "The sale has to end after it starts.";
  return null;
}

/** The website form's payload (sanitized again server-side). */
export function campaignPayload(d: CampaignDraft): Row {
  return {
    enabled: d.enabled,
    name: d.name.trim().slice(0, CAMPAIGN_NAME_MAX),
    startsAt: fromLocalInput(d.startsAt) ?? "",
    endsAt: fromLocalInput(d.endsAt) ?? "",
    teaser: d.teaser,
    teaserDays: Number(d.teaserDays) || 0,
    showBar: d.showBar,
  };
}

const PHASE_LABEL: Record<CampaignPhase, string> = {
  off: "Not running",
  teaser: "Teaser showing",
  live: "Live now",
  ended: "Ended",
};

/** Status of the SAVED campaign right now ("Live now", "Ended"…). */
export function savedCampaignStatus(saved: unknown, now: number = Date.now()): string {
  const o = (saved && typeof saved === "object" ? saved : {}) as Row;
  if (o.enabled !== true) return "Off";
  const phase = campaignPhase(
    {
      name: String(o.name ?? ""),
      startsAt: String(o.startsAt ?? ""),
      endsAt: String(o.endsAt ?? ""),
      teaser: o.teaser !== false,
      teaserDays: Number(o.teaserDays) || 0,
      showBar: o.showBar !== false,
    },
    now,
  );
  return PHASE_LABEL[phase];
}

// ── Free shipping over ₱X ───────────────────────────────────────────────────

export type FreeShippingDraft = {
  enabled: boolean;
  minSubtotal: string;
  usdMinSubtotal: string;
  campaignOnly: boolean;
};

export function freeShippingDraftFrom(saved: unknown): FreeShippingDraft {
  const o = (saved && typeof saved === "object" ? saved : {}) as Row;
  const min = Number(o.minSubtotal);
  const usd = Number(o.usdMinSubtotal);
  return {
    enabled: o.enabled === true,
    minSubtotal: min > 0 ? String(min) : "",
    usdMinSubtotal: usd > 0 ? String(usd) : "",
    campaignOnly: o.campaignOnly === true,
  };
}

export function freeShippingDraftError(d: FreeShippingDraft): string | null {
  return d.enabled && !(Number(d.minSubtotal) > 0) ? "Set the minimum order amount for free shipping." : null;
}

export function freeShippingPayload(d: FreeShippingDraft): Row {
  return {
    enabled: d.enabled,
    minSubtotal: Number(d.minSubtotal) || 0,
    usdMinSubtotal: Number(d.usdMinSubtotal) || 0,
    campaignOnly: d.campaignOnly,
  };
}

export type PromoEngineGrants = { ladder: boolean; freeShipping: boolean; campaign: boolean };

/** Which promo-engine grants this store has (the website brand's flags). */
export function promoEngineGrants(brand: Row | undefined): PromoEngineGrants {
  return {
    ladder: brand?.voucherLadderEntitled === true,
    freeShipping: brand?.freeShippingThresholdEntitled === true,
    campaign: brand?.saleCampaignEntitled === true,
  };
}
