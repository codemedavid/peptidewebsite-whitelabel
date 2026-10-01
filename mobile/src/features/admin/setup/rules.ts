import type { AdminBrand } from "../bridge";

/**
 * The website's store-setup rules the editors need BEFORE a save: caps, labels,
 * defaults and the client-side checks the web forms run. Each block names the
 * website file it mirrors — the server re-normalizes every save anyway, so these
 * only keep the form honest (same limits, same messages, same preview).
 */

// ── shared ───────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
export const currencyOf = (brand: AdminBrand): string => str(brand.currency) || "₱";
export const brandName = (brand: AdminBrand): string => str(brand.name);

/** A row id like the website's (`pm${Date.now()}`). */
export const newId = (prefix: string): string => `${prefix}${Date.now()}`;

/** http(s) only, else "" — lib/storefront/courier-booking safeExternalUrl. */
export function safeExternalUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const url = input.trim();
  const lower = url.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") ? url : "";
}

/** http(s) only, capped — lib/storefront/hero-links safeHttpUrl. */
export function safeHttpUrl(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, 500);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

// ── page links (hero CTAs, banner slides) — storefront/visibility PAGE_TOGGLE ─

const PAGE_OPTIONS: { route: string; label: string; visible: (b: AdminBrand) => boolean }[] = [
  { route: "home", label: "Home", visible: () => true },
  { route: "catalog", label: "Shop / Catalog", visible: () => true },
  { route: "reviews", label: "Reviews", visible: (b) => b.showPageReviews !== false },
  { route: "faq", label: "FAQ", visible: (b) => b.showPageFAQ !== false },
  { route: "coa", label: "Lab Results (COA)", visible: (b) => b.showPageCOA !== false },
  { route: "protocols", label: "Protocols", visible: (b) => b.showPageProtocols !== false },
  { route: "calculator", label: "Reconstitution Calculator", visible: (b) => b.showPageCalculator !== false },
  { route: "track", label: "Track Order", visible: (b) => b.showPageTrack !== false },
  { route: "merchant", label: "Wholesale", visible: (b) => b.showPageMerchant === true },
];

export const HERO_LINK_PAGES: ReadonlySet<string> = new Set(PAGE_OPTIONS.map((o) => o.route));

/** The pages a link may point at — only the ones this store has switched on. */
export function pageOptions(brand: AdminBrand): { key: string; label: string }[] {
  return PAGE_OPTIONS.filter((o) => o.visible(brand)).map((o) => ({ key: o.route, label: o.label }));
}

// ── store status — lib/storefront/store-status ───────────────────────────────

export const MAX_STORE_CLOSED_HEADLINE = 160;
export const MAX_STORE_CLOSED_MESSAGE = 600;
export type StoreStatus = { open: boolean; headline: string; message: string };

export function normalizeStoreStatus(value: unknown): StoreStatus {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
  return {
    open: raw.open !== false,
    headline: str(raw.headline).trim().slice(0, MAX_STORE_CLOSED_HEADLINE),
    message: str(raw.message).trim().slice(0, MAX_STORE_CLOSED_MESSAGE),
  };
}

/** What the storefront's closed banner will say (buildStoreClosedNotice). */
export function storeClosedNotice(status: StoreStatus, name: string): { headline: string; message: string } {
  const n = name.trim();
  const auto = n ? `Hello — ${n} is currently closed` : "Hello — this store is currently closed";
  return { headline: status.headline || auto, message: status.message };
}

// ── checkout fee — lib/storefront/admin-fee + storefront/visibility ─────────

export const ADMIN_FEE_LABEL_MAX = 60;
export const ADMIN_FEE_LABEL_DEFAULT = "Admin fee";
export const ADMIN_FEE_AMOUNT_MAX = 1_000_000;
export const FEE_LABEL_PRESETS = ["Shipping fee", "Service fee", "Admin fee", "Processing fee"];
export type AdminFee = { enabled: boolean; label: string; mode: "fixed" | "percentage"; amount: number; percent: number };

function clampRound(raw: unknown, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 100) / 100)) : 0;
}

export function normalizeAdminFee(input: unknown): AdminFee {
  const x = (input ?? {}) as Row;
  return {
    enabled: x.enabled === true,
    label: str(x.label).trim().slice(0, ADMIN_FEE_LABEL_MAX),
    mode: x.mode === "percentage" ? "percentage" : "fixed",
    amount: clampRound(x.amount, ADMIN_FEE_AMOUNT_MAX),
    percent: clampRound(x.percent, 100),
  };
}

/** Business-exclusive lock: every exclusive is locked during an active trial, else entitlement decides. */
export function isFeeLocked(brand: AdminBrand): boolean {
  const trial = brand.trial as { onTrial?: boolean; expired?: boolean } | undefined;
  if (trial?.onTrial === true && trial.expired === false) return true;
  return brand.adminFeeEntitled === false;
}

// ── payment methods — storefront/types PaymentMethod ─────────────────────────

export const QRPH_FEE_PERCENT = 2; // lib/storefront/payment-fee

// ── promo codes — lib/storefront/promo ───────────────────────────────────────

export const isPromoExpired = (expiry: unknown, now = new Date()): boolean =>
  typeof expiry === "string" && !!expiry && new Date(expiry) < now;

/** The web's <input type="date"> value: YYYY-MM-DD that is a real day. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ── announcement banner — lib/storefront/banner ──────────────────────────────

export const BANNER_MODES = ["single", "carousel", "marquee"] as const;
export type BannerMode = (typeof BANNER_MODES)[number];
export type BannerSpeed = "slow" | "normal" | "fast";
export type BannerLinkType = "none" | "page" | "custom";
export type BannerSlide = { id: string; text: string; linkType: BannerLinkType; linkPage: string; linkUrl: string };
export type Banner = {
  enabled: boolean;
  mode: BannerMode;
  bgColor: string;
  textColor: string;
  slides: BannerSlide[];
  autoplayMs: number;
  speed: BannerSpeed;
  pauseOnHover: boolean;
};

export const MAX_BANNER_SLIDES = 10;
export const BANNER_TEXT_MAX = 160;
export const BANNER_AUTOPLAY_MIN = 2000;
export const BANNER_AUTOPLAY_MAX = 20000;
export const URL_MAX = 500;
const COLOR_CHARSET = /^[a-zA-Z0-9#(),.%\s/-]+$/;

/** Keep only values that look like a safe CSS color (banner safeCssColor). */
export function safeCssColor(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, 64);
  if (!s || s.toLowerCase().includes("url(")) return "";
  return COLOR_CHARSET.test(s) ? s : "";
}

function normalizeSlide(raw: unknown, index: number): BannerSlide | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Row;
  const text = String(o.text ?? "").trim().slice(0, BANNER_TEXT_MAX);
  if (!text) return null;
  const linkType: BannerLinkType = o.linkType === "custom" ? "custom" : o.linkType === "page" ? "page" : "none";
  const page = String(o.linkPage ?? "").trim();
  return {
    id: str(o.id).trim() || `b${index}`,
    text,
    linkType,
    linkPage: linkType === "page" ? (HERO_LINK_PAGES.has(page) ? page : "catalog") : "",
    linkUrl: linkType === "custom" ? safeHttpUrl(o.linkUrl) : "",
  };
}

export function normalizeBanner(input: unknown): Banner {
  const o = (input && typeof input === "object" ? input : {}) as Row;
  const ms = o.autoplayMs;
  return {
    enabled: o.enabled === true,
    mode: (BANNER_MODES as readonly string[]).includes(o.mode as string) ? (o.mode as BannerMode) : "single",
    bgColor: safeCssColor(o.bgColor),
    textColor: safeCssColor(o.textColor),
    slides: Array.isArray(o.slides)
      ? o.slides
          .map((s, i) => normalizeSlide(s, i))
          .filter((s): s is BannerSlide => s !== null)
          .slice(0, MAX_BANNER_SLIDES)
      : [],
    autoplayMs:
      typeof ms === "number" && Number.isFinite(ms) ? Math.min(BANNER_AUTOPLAY_MAX, Math.max(BANNER_AUTOPLAY_MIN, ms)) : 5000,
    speed: o.speed === "slow" || o.speed === "fast" ? o.speed : "normal",
    pauseOnHover: o.pauseOnHover !== false,
  };
}

// ── hero — lib/storefront/hero-content, hero-links, hero-media ──────────────

export const HERO_SHORT_MAX = 120;
export const HERO_SUB_MAX = 400;
export const HERO_ALT_MAX = 200;
export const HERO_SCRIM_MAX = 70;
export const HERO_SCRIM_STEP = 5;
/** Server image cap (STOREFRONT_IMAGE_MAX_BYTES). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Hosted URL cap / inline data URL cap (HERO_MEDIA_MAX_*). */
const HERO_MEDIA_MAX_HTTP_URL_LEN = 2_000;
const HERO_MEDIA_MAX_DATA_LEN = 512_000;
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;

export type HeroMedia = {
  mode: "text" | "image";
  url: string;
  alt: string;
  ratio: "wide" | "standard" | "tall";
  focus: "center" | "top" | "bottom" | "left" | "right";
  linkType: "page" | "custom" | "none";
  linkPage: string;
  linkUrl: string;
  overlay: boolean;
  scrim: number;
};

export const HERO_RATIOS: { key: HeroMedia["ratio"]; label: string }[] = [
  { key: "wide", label: "Wide strip (3:1)" },
  { key: "standard", label: "Standard (2:1)" },
  { key: "tall", label: "Tall (3:2)" },
];
export const HERO_FOCUSES: { key: HeroMedia["focus"]; label: string }[] = [
  { key: "center", label: "Center" },
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];

/** Why the server would drop an image source ("too-large" | "unsupported"), or null. */
export function heroMediaSrcIssue(raw: unknown): "too-large" | "unsupported" | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("data:")) {
    if (!DATA_IMAGE_RE.test(s)) return "unsupported";
    return s.length <= HERO_MEDIA_MAX_DATA_LEN ? null : "too-large";
  }
  if (s.length > HERO_MEDIA_MAX_HTTP_URL_LEN) return "too-large";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? null : "unsupported";
  } catch {
    return "unsupported";
  }
}

const snapScrim = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.round(Math.min(HERO_SCRIM_MAX, Math.max(0, n)) / HERO_SCRIM_STEP) * HERO_SCRIM_STEP;
};

/** Reads `brand.heroMedia` (or a save payload's `heroMedia`), like normalizeHeroMedia. */
export function normalizeHeroMedia(root: AdminBrand | Row): HeroMedia {
  const raw = (root.heroMedia && typeof root.heroMedia === "object" ? root.heroMedia : {}) as Row;
  const ratio = HERO_RATIOS.find((r) => r.key === raw.ratio)?.key ?? "standard";
  const focus = HERO_FOCUSES.find((f) => f.key === raw.focus)?.key ?? "center";
  const linkType = raw.linkType === "custom" || raw.linkType === "none" ? raw.linkType : "page";
  const page = String(raw.linkPage ?? "").trim();
  const url = String(raw.url ?? "").trim();
  return {
    mode: raw.mode === "image" ? "image" : "text",
    url: heroMediaSrcIssue(url) ? "" : url,
    alt: String(raw.alt ?? "").slice(0, HERO_ALT_MAX).trim(),
    ratio,
    focus,
    linkType,
    linkPage: HERO_LINK_PAGES.has(page) ? page : "catalog",
    linkUrl: linkType === "custom" ? safeHttpUrl(raw.linkUrl) : "",
    overlay: Boolean(raw.overlay),
    scrim: snapScrim(raw.scrim),
  };
}

/** Banner box aspect (width / height) for the preview — heroMediaAspect. */
export const heroAspect = (ratio: HeroMedia["ratio"]): number => (ratio === "wide" ? 3 : ratio === "tall" ? 1.5 : 2);

/** "gold-vials.jpg" → "gold vials" — the web seeds alt text from the filename. */
export const altFromName = (name: string): string => name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
