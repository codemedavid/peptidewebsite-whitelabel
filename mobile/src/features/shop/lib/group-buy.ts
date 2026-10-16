// The live group-buy round's numbers and words — pure, so the shop banner, the
// group-buy screen and the chat card all say the same thing
// (npm run test:mobile-group-buy).
import type { ShopCatalog, ShopGroupBuy, ShopProduct } from "@shop-contract";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SOON = 3 * DAY;

export type SlotMeter = {
  /** False when the owner set no goal — show a count, not a bar. */
  enabled: boolean;
  goal: number;
  filled: number;
  /** 0–100, for the bar's width. */
  pct: number;
  left: number;
  reached: boolean;
  /** "12 of 30 slots filled" / "7 joined". */
  label: string;
  /** "18 slots left" / "Goal reached — still open" / "". */
  hint: string;
};

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export function slotMeter(goal: number, filled: number): SlotMeter {
  const g = whole(goal);
  const f = whole(filled);
  if (g === 0) return { enabled: false, goal: 0, filled: f, pct: 0, left: 0, reached: false, label: `${f} joined`, hint: "" };
  const left = Math.max(0, g - f);
  const reached = left === 0;
  return {
    enabled: true,
    goal: g,
    filled: f,
    pct: Math.min(100, Math.round((f / g) * 100)),
    left,
    reached,
    label: `${f} of ${g} slots filled`,
    hint: reached ? "Goal reached — still open" : `${left} ${left === 1 ? "slot" : "slots"} left`,
  };
}

/** calm = plenty of time · soon = ≤ 3 days · last = final 24 h · ended = past the close. */
export type UrgencyTone = "calm" | "soon" | "last" | "ended";
export type RoundUrgency = { tone: UrgencyTone; label: string; ended: boolean };

export function roundUrgency(endsAt: string | null | undefined, now = Date.now()): RoundUrgency {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  if (!Number.isFinite(end)) return { tone: "calm", label: "Open now", ended: false };
  const left = end - now;
  if (left <= 0) return { tone: "ended", label: "Closed", ended: true };
  if (left < DAY) {
    const h = Math.floor(left / HOUR);
    const m = Math.floor((left % HOUR) / 60_000);
    return { tone: "last", label: `Last day · ${h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`} left`, ended: false };
  }
  const days = Math.ceil(left / DAY);
  return { tone: left <= SOON ? "soon" : "calm", label: `Closes in ${days} days`, ended: false };
}

/** The round's products, in the round's order (ids the catalog doesn't list are skipped). */
export function roundProducts(catalog: Pick<ShopCatalog, "products" | "groupBuy"> | undefined): ShopProduct[] {
  const ids = catalog?.groupBuy?.productIds ?? [];
  if (!catalog || ids.length === 0) return [];
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
}

export type LiveStrip = {
  headline: string;
  message: string;
  ctaLabel: string;
  urgency: RoundUrgency;
  /** One sentence for screen readers. */
  a11y: string;
};

/**
 * The LIVE strip pinned above the customer tab bar, or null when it must not
 * show: no round, the owner switched it off (or the server predates it),
 * ordering paused (nothing to join, so not "live"), or the close passed while
 * the app sat open.
 */
export function liveStrip(round: ShopGroupBuy | null | undefined, now = Date.now()): LiveStrip | null {
  const text = round?.liveBanner;
  if (!round || !text || round.ordering !== "open") return null;
  const urgency = roundUrgency(round.endsAt, now);
  if (urgency.ended) return null;
  return { ...text, urgency, a11y: [text.headline, text.message, urgency.label].join(". ") };
}
