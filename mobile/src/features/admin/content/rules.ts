import { str, type Row } from "../setup/rules";

/**
 * The website's content-editor rules (FAQ, Lab Results, Protocols, Reviews)
 * the app needs BEFORE a save: caps, choices and the client-side checks the web
 * forms run. Each block names the website file it mirrors — the server
 * re-normalizes every save, so these only keep the form honest.
 */

// ── FAQ — src/lib/storefront/faq.ts ──────────────────────────────────────────

export const FAQ_ICONS = [
  { key: "shipping", label: "Shipping" },
  { key: "payment", label: "Payment" },
  { key: "product", label: "Product" },
  { key: "default", label: "Default" },
] as const;
export type FaqIcon = (typeof FAQ_ICONS)[number]["key"];
export const MAX_FAQ_GROUPS = 20;
export const MAX_FAQ_ITEMS = 40;
export const MAX_FAQ_LABEL = 120;
export const MAX_FAQ_QUESTION = 300;
export const MAX_FAQ_ANSWER = 4000;

export type FaqItem = { q: string; a: string };
export type FaqGroup = { id: string; label: string; icon: string; items: FaqItem[] };

export function toFaqGroups(rows: readonly Row[]): FaqGroup[] {
  return rows.map((g, i) => ({
    ...g,
    id: str(g.id) || `g${i}`,
    label: str(g.label),
    icon: str(g.icon, "default"),
    items: Array.isArray(g.items)
      ? g.items
          .filter((it): it is Row => !!it && typeof it === "object")
          .map((it) => ({ q: str(it.q), a: str(it.a) }))
      : [],
  }));
}

// ── Lab results — src/lib/storefront/coa.ts ──────────────────────────────────

export const MAX_COA_NAME = 200;
export const MAX_COA_TEXT = 120;

export type CoaPartner = { label: string; href: string };

export function coaPartners(brand: Row): CoaPartner[] {
  const list = brand.coaPartners;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is Row => !!p && typeof p === "object" && typeof (p as Row).label === "string")
    .map((p) => ({ label: str(p.label), href: str(p.href) }))
    .filter((p) => p.label.trim() !== "");
}

/** "2026-04-12" → "Apr 12, 2026" (the web card's toLocaleDateString). */
export function formatReportDate(date: string): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ── Protocols — src/lib/storefront/protocol-images.ts, actions normalizeProtocols

export const MAX_PROTOCOL_IMAGES = 12;
export const MAX_PROTOCOL_NAME = 200;
export const MAX_PROTOCOL_FIELD = 200;
export const MAX_PROTOCOL_STORAGE = 500;
export const MAX_PROTOCOLS = 200;

export type ProtocolMode = "details" | "image";

/** resolveProtocolImages: `images` is authoritative when present, else the legacy `image`. */
export function protocolImages(p: Row): string[] {
  if (Array.isArray(p.images)) {
    return p.images.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, MAX_PROTOCOL_IMAGES);
  }
  const legacy = str(p.image);
  return legacy.trim() ? [legacy] : [];
}

export const protocolMode = (p: Row): ProtocolMode => (p.mode === "image" ? "image" : "details");

/** The web's "Add Protocol" row (AdminProtocolsManager add). */
export const newProtocol = (): Row => ({
  category: "General",
  name: "New Protocol",
  dosage: "",
  frequency: "",
  duration: "",
  notes: [""],
  storage: "",
  images: [],
  mode: "details",
});

// ── Reviews — src/lib/storefront/reviews.ts, review-viewer.ts, theme/tokens ──

export const MAX_REVIEW_TEXT = 600;
export const MAX_REVIEW_PRODUCTS = 20;
export const MIN_REVIEW_FONT_SIZE = 10;
export const MAX_REVIEW_FONT_SIZE = 72;
export const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/** FONT_OPTIONS — the registered storefront families, in the web picker's order. */
export const FONT_OPTIONS: readonly string[] = [
  "Inter",
  "DM Sans",
  "Manrope",
  "Poppins",
  "Montserrat",
  "Work Sans",
  "Space Grotesk",
  "Sora",
  "Outfit",
  "Figtree",
  "Plus Jakarta Sans",
  "IBM Plex Sans",
  "Archivo",
  "Oswald",
  "Syne",
  "Bebas Neue",
  "Playfair Display",
  "DM Serif Display",
  "Cormorant Garamond",
  "Lora",
  "Libre Baskerville",
  "Fraunces",
  "Spectral",
  "Marcellus",
  "Bodoni Moda",
  "Roboto Slab",
];

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
export const isHexColor = (s: string): boolean => HEX_COLOR.test(s.trim());

/** The description typography a review may carry (HeroFieldStyle subset the web edits). */
export type ReviewDescStyle = { font?: string; size?: number; weight?: FontWeight; italic?: boolean; color?: string } & Row;

export function reviewDescStyle(v: unknown): ReviewDescStyle {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as ReviewDescStyle) } : {};
}

/** reviewProductIds: the legacy single link first, then the multi-connect list, de-duplicated. */
export function reviewProductIds(r: Row): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const id = raw.trim();
    if (id && !out.includes(id)) out.push(id);
  };
  push(r.productId);
  if (Array.isArray(r.productIds)) r.productIds.forEach(push);
  return out;
}

/** canOpenReviewViewer — an all-blank row has nothing to enlarge. */
export function canOpenReviewViewer(r: Row): boolean {
  return ["image", "title", "subtitle", "headline", "badge"].some((k) => str(r[k]).trim() !== "");
}
