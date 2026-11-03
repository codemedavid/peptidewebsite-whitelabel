// "Live now" — who is on a store this minute, on the website and in the app.
//
// PURE module: parsing a heartbeat, reading the IP location headers, and
// turning presence rows into the admin's live snapshot. The DB side lives in
// live.server.ts. Nothing here stores or returns an IP address — the location
// is the city Vercel resolves from it, nothing finer.

import type {
  LiveResponse,
  LiveStage,
  LiveSurface,
  LiveVisitor,
  RankedRow,
} from "@/lib/mobile/contract";

/** How often an open page / foreground app checks in. */
export const HEARTBEAT_MS = 30_000;
/** Two missed beats plus slack before a visitor drops off the live view. */
export const LIVE_WINDOW_MS = 75_000;
/** Rows older than this are pruned; it is also the "last 24 hours" count. */
export const RETAIN_MS = 24 * 60 * 60 * 1000;
/** Most visitors the phone lists; the rest are counted in `more`. */
export const FEED_LIMIT = 30;
const PLACES_LIMIT = 5;

export const LIVE_STAGES: readonly LiveStage[] = ["browsing", "product", "cart", "checkout"];
const STAGE_RANK: Record<LiveStage, number> = { browsing: 0, product: 1, cart: 2, checkout: 3 };

const VISITOR_ID = /^[A-Za-z0-9_-]{8,64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_REF = 120;
const MAX_CART_ITEMS = 999;
const MAX_CART_VALUE = 10_000_000;
const MAX_GEO = 80;

export type PresenceBeat = {
  visitorId: string | null;
  stage: LiveStage;
  productRef: string | null;
  cartItems: number;
  cartValue: number;
  currency: string | null;
  leave: boolean;
};

export function isLiveStage(v: unknown): v is LiveStage {
  return typeof v === "string" && (LIVE_STAGES as readonly string[]).includes(v);
}

const clampInt = (v: unknown, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(Math.floor(v), max)) : 0;

/**
 * Validate one heartbeat body. Unknown stages read as browsing; junk numbers
 * read as 0. Returns null only when the body is not an object, or a visitor id
 * is required (website) and missing or malformed.
 */
export function parsePresenceBeat(body: unknown, opts: { requireVisitorId: boolean }): PresenceBeat | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const visitorId = typeof b.visitorId === "string" && VISITOR_ID.test(b.visitorId) ? b.visitorId : null;
  if (opts.requireVisitorId && !visitorId) return null;

  const stage = isLiveStage(b.stage) ? b.stage : "browsing";
  const ref = typeof b.productRef === "string" ? b.productRef.trim().slice(0, MAX_REF) : "";
  const value = typeof b.cartValue === "number" && Number.isFinite(b.cartValue) ? b.cartValue : 0;

  return {
    visitorId,
    stage,
    // A product only means something while they are looking at it.
    productRef: stage === "product" && ref ? ref : null,
    cartItems: clampInt(b.cartItems, MAX_CART_ITEMS),
    cartValue: Math.max(0, Math.min(value, MAX_CART_VALUE)),
    currency: typeof b.currency === "string" && CURRENCY.test(b.currency) ? b.currency : null,
    leave: b.leave === true,
  };
}

export type GeoPlace = { city: string | null; region: string | null; country: string | null };

function cleanGeo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  // Vercel percent-encodes the city ("Quezon%20City").
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep the raw value */
  }
  v = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return v ? v.slice(0, MAX_GEO) : null;
}

/** City / region / country from the hosting platform's IP headers. */
export function readGeo(header: (name: string) => string | null | undefined): GeoPlace {
  const country = cleanGeo(header("x-vercel-ip-country"));
  return {
    city: cleanGeo(header("x-vercel-ip-city")),
    region: cleanGeo(header("x-vercel-ip-country-region")),
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
  };
}

let countryNames: Intl.DisplayNames | null | undefined;
function countryName(code: string): string {
  if (countryNames === undefined) {
    try {
      countryNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      countryNames = null;
    }
  }
  return countryNames?.of(code) ?? code;
}

/** "Davao City"; the country name when only the country is known; else null. */
export function placeLabel(geo: GeoPlace): string | null {
  if (geo.city) return geo.city;
  if (geo.country) return countryName(geo.country);
  return null;
}

/**
 * The website's stage from what is on screen: the checkout drawer past its
 * cart step is checkout, the open drawer is the cart, an open product is the
 * product stage, anything else is browsing.
 */
export function webStage(s: { cartOpen: boolean; checkoutStep: "cart" | "details" | "payment"; productOpen: boolean }): LiveStage {
  if (s.cartOpen) return s.checkoutStep === "cart" ? "cart" : "checkout";
  return s.productOpen ? "product" : "browsing";
}

export type PresenceRow = {
  id: string;
  surface: string;
  stage: string;
  productRef: string | null;
  cartItems: number;
  cartValue: number;
  currency: string | null;
  customerId: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type LiveLookups = {
  productName: (ref: string) => string | null;
  customerName: (id: string) => string | null;
  money: (value: number, currency: string | null) => string;
};

export function isLive(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() <= LIVE_WINDOW_MS;
}

const secsBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));

function toVisitor(row: PresenceRow, now: Date, look: LiveLookups): LiveVisitor {
  const stage = isLiveStage(row.stage) ? row.stage : "browsing";
  const surface: LiveSurface = row.surface === "app" ? "app" : "web";
  return {
    id: row.id,
    surface,
    stage,
    place: placeLabel(row),
    who: row.customerId ? look.customerName(row.customerId) : null,
    productName: row.productRef ? look.productName(row.productRef) : null,
    cartItems: row.cartItems,
    cartLabel: row.cartValue > 0 ? look.money(row.cartValue, row.currency) : null,
    lastSeenSecs: secsBetween(row.lastSeenAt, now),
    onSiteSecs: secsBetween(row.firstSeenAt, now),
  };
}

function rankPlaces(visitors: readonly LiveVisitor[]): RankedRow[] {
  const counts = new Map<string, number>();
  for (const v of visitors) {
    if (v.place) counts.set(v.place, (counts.get(v.place) ?? 0) + 1);
  }
  const total = visitors.length || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PLACES_LIMIT)
    .map(([name, value]) => ({
      name,
      value,
      valueLabel: String(value),
      detail: value === 1 ? "1 person" : `${value} people`,
      share: value / total,
    }));
}

/**
 * The admin's live snapshot. `rows` may include stale rows (they are filtered
 * by the live window here); `last24h` is counted by the caller in the DB.
 */
export function buildLiveSnapshot(input: {
  rows: readonly PresenceRow[];
  last24h: number;
  now: Date;
  lookups: LiveLookups;
}): LiveResponse {
  const { now, lookups } = input;
  const live = input.rows
    .filter((r) => isLive(r.lastSeenAt, now))
    .map((r) => toVisitor(r, now, lookups))
    .sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || a.lastSeenSecs - b.lastSeenSecs);

  const stages: Record<LiveStage, number> = { browsing: 0, product: 0, cart: 0, checkout: 0 };
  for (const v of live) stages[v.stage] += 1;
  const app = live.filter((v) => v.surface === "app").length;

  return {
    total: live.length,
    web: live.length - app,
    app,
    stages,
    visitors: live.slice(0, FEED_LIMIT),
    more: Math.max(0, live.length - FEED_LIMIT),
    places: rankPlaces(live),
    // Everyone live now was seen today, even if the count raced a prune.
    last24h: Math.max(input.last24h, live.length),
    asOf: now.toISOString(),
  };
}
