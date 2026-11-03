// Pure core for the storefront Announcement Pop-up — the owner-editable pop-up a
// shopper sees when they open the store: news, a new drop, or a promo code.
// Ported from MamaMicaGlow's app pop-up (shared/app-popup.ts) and adapted to the
// website: the button can open a store page, a product's quick view or a web
// link, the pop-up can be scheduled, and the chrome is themed from the tenant's
// own --brand-* tokens (no colours are stored here).
//
// Shared by the store-admin save action (server), the editor's live preview and
// the storefront (client), so it must stay free of any DB / Next / browser
// dependency — it is exercised directly by test:announcement-popup.
//
// It is NOT the Notice Modal (lib/storefront/notice-modal): that one is an
// operator-granted disclaimer shown on every visit. This one is the owner's own
// marketing surface, shown once per version (or once per visit).

import { HERO_LINK_PAGES } from "./hero-links";

export type PopupKind = "announcement" | "drop" | "promo";
/** What the main button does. "close" just dismisses. */
export type PopupAction = "close" | "page" | "product" | "link";
/** "once" = until the shopper closes this version; "every_visit" = once per browser visit. */
export type PopupFrequency = "once" | "every_visit";
/** How the image sits in the card. */
export type PopupLayout = "stacked" | "split" | "poster";

export type PopupImage = {
  url: string;
  /** width / height, so the card reserves the right space before the image loads. */
  aspect: number;
};

export type AnnouncementPopup = {
  enabled: boolean;
  kind: PopupKind;
  layout: PopupLayout;
  title: string;
  message: string;
  image: PopupImage | null;
  /** Promo code shown as a copy-to-clipboard chip ("" = none). */
  code: string;
  buttonLabel: string;
  action: PopupAction;
  /** A HERO_LINK_PAGES route when action === "page". */
  linkPage: string;
  /** A product id when action === "product". */
  productId: string;
  /** An https URL when action === "link". */
  linkUrl: string;
  frequency: PopupFrequency;
  /** Seconds after the page opens before the pop-up appears. */
  delaySeconds: number;
  /** Optional schedule window, YYYY-MM-DD ("" = open-ended). */
  startDate: string;
  endDate: string;
};

export type StoredPopup = AnnouncementPopup & {
  /** Changes whenever what shoppers read changes — a new version re-shows "once" pop-ups. */
  version: string;
  updatedAt: string | null;
};

export const POPUP_LIMITS = {
  title: 80,
  message: 500,
  code: 32,
  buttonLabel: 28,
  linkUrl: 500,
} as const;

export const POPUP_DELAYS = [0, 3, 8] as const;
const MAX_DELAY_SECONDS = 30;
const ASPECT_MIN = 0.5;
const ASPECT_MAX = 2.5;
// Demo mode / an unconfigured ImageKit hands back data URLs. Cap them so a
// pasted photo cannot bloat branding.config (it ships to every visitor).
const MAX_DATA_URL_LEN = 1_500_000;
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const POPUP_KINDS: readonly PopupKind[] = ["announcement", "drop", "promo"];
export const POPUP_ACTIONS: readonly PopupAction[] = ["close", "page", "product", "link"];
export const POPUP_LAYOUTS: readonly PopupLayout[] = ["stacked", "split", "poster"];
const FREQUENCIES: readonly PopupFrequency[] = ["once", "every_visit"];

export const KIND_META: Record<
  PopupKind,
  { label: string; badge: string; defaultButton: string; hint: string }
> = {
  announcement: {
    label: "Announcement",
    badge: "Announcement",
    defaultButton: "Got it",
    hint: "News, schedule changes, reminders",
  },
  drop: {
    label: "New drop",
    badge: "New drop",
    defaultButton: "Shop the drop",
    hint: "A new or restocked product",
  },
  promo: {
    label: "Promo",
    badge: "Limited offer",
    defaultButton: "Shop now",
    hint: "A sale or a promo code",
  },
};

export const LAYOUT_META: Record<PopupLayout, { label: string; hint: string }> = {
  stacked: { label: "Image on top", hint: "Photo above the text" },
  split: { label: "Side by side", hint: "Photo beside the text on wide screens" },
  poster: { label: "Full image", hint: "Text over the photo" },
};

export const DEFAULT_ANNOUNCEMENT_POPUP: StoredPopup = {
  enabled: false,
  kind: "announcement",
  layout: "stacked",
  title: "",
  message: "",
  image: null,
  code: "",
  buttonLabel: "",
  action: "close",
  linkPage: "catalog",
  productId: "",
  linkUrl: "",
  frequency: "once",
  delaySeconds: 0,
  startDate: "",
  endDate: "",
  version: "",
  updatedAt: null,
};

export function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** An image URL the card may render: https, or a small inline image (demo uploads). */
export function isSafeImageUrl(url: string): boolean {
  const s = url.trim();
  if (s.startsWith("data:")) return s.length <= MAX_DATA_URL_LEN && DATA_IMAGE.test(s);
  return isSafeLinkUrl(s);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

function normalizeImage(raw: unknown): PopupImage | null {
  if (!isRecord(raw) || typeof raw.url !== "string" || !isSafeImageUrl(raw.url)) return null;
  const aspect =
    typeof raw.aspect === "number" && Number.isFinite(raw.aspect) && raw.aspect > 0 ? raw.aspect : 1;
  return { url: raw.url.trim(), aspect: Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect)) };
}

/** A real calendar date in YYYY-MM-DD form, else "". */
function normalizeDate(v: unknown): string {
  if (typeof v !== "string" || !DATE_ONLY.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "" : v;
}

function normalizeDelay(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.round(v)));
}

/** djb2 over the fields shoppers read — short, stable, no crypto dependency. */
export function popupVersion(p: AnnouncementPopup): string {
  const seed = JSON.stringify([
    p.kind,
    p.layout,
    p.title.trim(),
    p.message.trim(),
    p.image?.url ?? "",
    p.code.trim(),
    p.buttonLabel.trim(),
    p.action,
    p.linkPage,
    p.productId,
    p.linkUrl.trim(),
  ]);
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  return `v${(hash >>> 0).toString(36)}`;
}

/**
 * Coerce the action's target fields: a broken target degrades to "close" (an
 * inert button) rather than sending the shopper somewhere unexpected.
 */
function normalizeTarget(raw: Record<string, unknown>) {
  const requested = oneOf(raw.action, POPUP_ACTIONS, "close");
  const linkUrl = text(raw.linkUrl, POPUP_LIMITS.linkUrl).trim();
  const pageRaw = typeof raw.linkPage === "string" ? raw.linkPage.trim() : "";
  const linkPage = HERO_LINK_PAGES.has(pageRaw) ? pageRaw : "catalog";
  const productId = typeof raw.productId === "string" ? raw.productId.trim().slice(0, 64) : "";

  let action: PopupAction = requested;
  if (requested === "link" && !isSafeLinkUrl(linkUrl)) action = "close";
  if (requested === "product" && !productId) action = "close";
  return { action, linkPage, productId, linkUrl };
}

/** Whatever is in branding.config → a pop-up that is safe to render. Never throws. */
export function normalizeAnnouncementPopup(raw: unknown): StoredPopup {
  if (!isRecord(raw)) return { ...DEFAULT_ANNOUNCEMENT_POPUP };
  const popup: AnnouncementPopup = {
    enabled: raw.enabled === true,
    kind: oneOf(raw.kind, POPUP_KINDS, "announcement"),
    layout: oneOf(raw.layout, POPUP_LAYOUTS, "stacked"),
    title: text(raw.title, POPUP_LIMITS.title),
    message: text(raw.message, POPUP_LIMITS.message),
    image: normalizeImage(raw.image),
    code: text(raw.code, POPUP_LIMITS.code).trim(),
    buttonLabel: text(raw.buttonLabel, POPUP_LIMITS.buttonLabel),
    ...normalizeTarget(raw),
    frequency: oneOf(raw.frequency, FREQUENCIES, "once"),
    delaySeconds: normalizeDelay(raw.delaySeconds),
    startDate: normalizeDate(raw.startDate),
    endDate: normalizeDate(raw.endDate),
  };
  return {
    ...popup,
    version: typeof raw.version === "string" && raw.version ? raw.version : popupVersion(popup),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

export type PopupField = "title" | "message" | "code" | "buttonLabel" | "linkUrl" | "productId" | "endDate";
export type PopupError = { field: PopupField; message: string };

/** What blocks "Save". A switched-off draft only has to fit the limits. */
export function validatePopup(p: AnnouncementPopup): PopupError[] {
  const errors: PopupError[] = [];
  if (p.enabled && !hasPopupContent(p)) {
    errors.push({ field: "title", message: "Add a title or an image so shoppers have something to see." });
  }
  if (p.title.length > POPUP_LIMITS.title) {
    errors.push({ field: "title", message: `Keep the title under ${POPUP_LIMITS.title} characters.` });
  }
  if (p.message.length > POPUP_LIMITS.message) {
    errors.push({ field: "message", message: `Keep the message under ${POPUP_LIMITS.message} characters.` });
  }
  if (p.code.length > POPUP_LIMITS.code) {
    errors.push({ field: "code", message: `Keep the code under ${POPUP_LIMITS.code} characters.` });
  }
  if (p.buttonLabel.length > POPUP_LIMITS.buttonLabel) {
    errors.push({ field: "buttonLabel", message: `Keep the button under ${POPUP_LIMITS.buttonLabel} characters.` });
  }
  if (p.action === "link" && !isSafeLinkUrl(p.linkUrl)) {
    errors.push({ field: "linkUrl", message: "Use a full web address starting with https://" });
  }
  if (p.action === "product" && !p.productId) {
    errors.push({ field: "productId", message: "Pick the product the button should open." });
  }
  if (p.startDate && p.endDate && p.endDate < p.startDate) {
    errors.push({ field: "endDate", message: "The end date is before the start date." });
  }
  return errors;
}

/** The exact JSON the editor writes: trimmed text, a default button, a fresh version. */
export function preparePopupForSave(p: AnnouncementPopup, now: Date = new Date()): StoredPopup {
  const normalized = normalizeAnnouncementPopup({ ...p, version: "" });
  const clean: AnnouncementPopup = {
    enabled: normalized.enabled,
    kind: normalized.kind,
    layout: normalized.layout,
    title: normalized.title.trim(),
    message: normalized.message.trim(),
    image: normalized.image,
    code: normalized.code,
    buttonLabel: normalized.buttonLabel.trim() || KIND_META[normalized.kind].defaultButton,
    action: normalized.action,
    linkPage: normalized.linkPage,
    productId: normalized.action === "product" ? normalized.productId : "",
    linkUrl: normalized.action === "link" ? normalized.linkUrl : "",
    frequency: normalized.frequency,
    delaySeconds: normalized.delaySeconds,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  };
  return { ...clean, version: popupVersion(clean), updatedAt: now.toISOString() };
}

export function hasPopupContent(p: Pick<AnnouncementPopup, "title" | "image">): boolean {
  return p.title.trim().length > 0 || p.image !== null;
}

/** The shopper's local calendar day as YYYY-MM-DD (schedule dates are calendar days). */
export function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Inside the schedule window? Both ends are inclusive whole days. */
export function isWithinSchedule(p: Pick<AnnouncementPopup, "startDate" | "endDate">, today: string): boolean {
  if (p.startDate && today < p.startDate) return false;
  if (p.endDate && today > p.endDate) return false;
  return true;
}

export type PopupSeenState = {
  /** Versions this shopper already closed (this browser). */
  seenVersions: readonly string[];
  /** Already shown during this browser visit (tab session). */
  shownThisVisit: boolean;
};

export function shouldShowPopup(p: StoredPopup, seen: PopupSeenState, today: string): boolean {
  if (!p.enabled || !hasPopupContent(p)) return false;
  if (!isWithinSchedule(p, today)) return false;
  if (seen.shownThisVisit) return false;
  if (p.frequency === "every_visit") return true;
  return !seen.seenVersions.includes(p.version);
}

/** Keep the seen list short: the newest versions win. */
export const MAX_SEEN_VERSIONS = 20;
export function rememberSeen(seen: readonly string[], version: string): string[] {
  const rest = seen.filter((v) => v !== version);
  return [...rest, version].slice(-MAX_SEEN_VERSIONS);
}

/** Parse the browser's stored seen list; anything malformed is an empty list. */
export function parseSeenVersions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
