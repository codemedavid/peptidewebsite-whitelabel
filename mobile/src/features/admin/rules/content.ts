import type { AdminBrand } from "../bridge";

/**
 * The website's store-rules content shapes (Notice Modal, Delivery Note, Order
 * Notifications) and the pure rules their editors apply before a save. Each
 * block names the website file it mirrors — the server re-normalizes every save,
 * so these only keep the form and its preview honest.
 */

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Trim + cap a string, or `fallback` when it isn't one. */
function capped(raw: unknown, max: number, fallback: string): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : fallback;
}

/** Trimmed, capped, de-blanked, count-capped list — or `fallback` when absent. */
function cappedList(raw: unknown, maxLen: number, maxCount: number, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .map((v) => (typeof v === "string" ? v.trim().slice(0, maxLen) : ""))
    .filter((v) => v.length > 0)
    .slice(0, maxCount);
}

/** Business-exclusive lock (storefront/visibility isAdminModuleLocked). */
export function isBusinessLocked(brand: AdminBrand, entitledFlag: string): boolean {
  const trial = brand.trial as { onTrial?: boolean; expired?: boolean } | undefined;
  if (trial?.onTrial === true && trial.expired === false) return true;
  return brand[entitledFlag] === false;
}

// ── notice modal — lib/storefront/notice-modal ───────────────────────────────

export const NOTICE_TITLE_MAX = 200;
export const NOTICE_PARAGRAPH_MAX = 800;
export const NOTICE_LINE_MAX = 400;
export const MAX_NOTICE_PARAGRAPHS = 8;
export const MAX_NOTICE_DELIVERY_LINES = 8;

export type NoticeModal = {
  operatorEnabled: boolean;
  enabled: boolean;
  title: string;
  subtitle: string;
  bodyParagraphs: string[];
  warningTitle: string;
  warningBody: string;
  deliveryTitle: string;
  deliveryLines: string[];
  agreeLabel: string;
  footerNote: string;
};

export const DEFAULT_NOTICE_MODAL: NoticeModal = {
  operatorEnabled: false,
  enabled: false,
  title: "Important Notice",
  subtitle: "Please read before continuing",
  bodyParagraphs: [
    "Peptides are sold strictly for laboratory research purposes only. They are not medications, not FDA-approved, and are not intended to diagnose, treat, cure, or prevent any disease.",
    "Improper handling or use may carry risks, including possible side effects, adverse reactions, contamination, or ineffective results.",
    "Any information provided is educational only and should not replace medical advice. Always consult a licensed healthcare professional for health-related decisions.",
  ],
  warningTitle: "NO MEET UPS · NO PICK UPS · NO RUSH ORDERS",
  warningBody: "Orders are processed and shipped in the order received.",
  deliveryTitle: "DELIVERY CUT-OFF TIMES",
  deliveryLines: [
    "J&T Express: Cut-off is at 3:00 PM. Orders placed after cut-off are shipped the next business day.",
    "Same-Day Delivery: Booking & packing starts at 2:00 PM.",
  ],
  agreeLabel: "I Understand & Agree",
  footerNote: "This notice is shown on every visit to the storefront.",
};

export function normalizeNoticeModal(input: unknown): NoticeModal {
  if (!input || typeof input !== "object") return DEFAULT_NOTICE_MODAL;
  const o = asObject(input);
  const d = DEFAULT_NOTICE_MODAL;
  return {
    operatorEnabled: o.operatorEnabled === true,
    enabled: o.enabled === true,
    title: capped(o.title, NOTICE_TITLE_MAX, d.title),
    subtitle: capped(o.subtitle, NOTICE_TITLE_MAX, d.subtitle),
    bodyParagraphs: cappedList(o.bodyParagraphs, NOTICE_PARAGRAPH_MAX, MAX_NOTICE_PARAGRAPHS, d.bodyParagraphs),
    warningTitle: capped(o.warningTitle, NOTICE_TITLE_MAX, d.warningTitle),
    warningBody: capped(o.warningBody, NOTICE_PARAGRAPH_MAX, d.warningBody),
    deliveryTitle: capped(o.deliveryTitle, NOTICE_TITLE_MAX, d.deliveryTitle),
    deliveryLines: cappedList(o.deliveryLines, NOTICE_LINE_MAX, MAX_NOTICE_DELIVERY_LINES, d.deliveryLines),
    agreeLabel: capped(o.agreeLabel, NOTICE_TITLE_MAX, d.agreeLabel),
    footerNote: capped(o.footerNote, NOTICE_TITLE_MAX, d.footerNote),
  };
}

/** Paragraphs are separated by a blank line; delivery entries by a newline (AdminNoticeModal). */
export const toParagraphs = (text: string): string[] => text.split(/\n{2,}/);
export const toLines = (text: string): string[] => text.split(/\n+/);

// ── track-order delivery note — lib/storefront/track-note ────────────────────

export const TRACK_TITLE_MAX = 120;
export const TRACK_FOOTNOTE_MAX = 400;
export const TRACK_CELL_MAX = 80;
export const MAX_TRACK_NOTE_ROWS = 12;

export type TrackNoteRow = { region: string; estimate: string };
export type TrackNote = { enabled: boolean; title: string; subtitle: string; rows: TrackNoteRow[]; footnote: string };

export const DEFAULT_TRACK_NOTE: TrackNote = { enabled: false, title: "", subtitle: "", rows: [], footnote: "" };

/** The one-tap starter the website offers ("Load J&T Davao example"). */
export const TRACK_NOTE_EXAMPLE: TrackNote = {
  enabled: true,
  title: "J&T Express Delivery Estimates",
  subtitle: "from Davao City",
  rows: [
    { region: "Mindanao", estimate: "1–5 days" },
    { region: "Metro Manila & Luzon", estimate: "3–7 days" },
    { region: "Visayas", estimate: "3–7 days" },
    { region: "Island Provinces", estimate: "5–6 days" },
  ],
  footnote: "* Sending day not counted. · Palawan: +15 days. · Business days only.",
};

export function normalizeTrackRows(raw: unknown): TrackNoteRow[] {
  if (!Array.isArray(raw)) return DEFAULT_TRACK_NOTE.rows;
  return raw
    .map((entry) => {
      const o = asObject(entry);
      return { region: capped(o.region, TRACK_CELL_MAX, ""), estimate: capped(o.estimate, TRACK_CELL_MAX, "") };
    })
    .filter((r) => r.region.length > 0 || r.estimate.length > 0)
    .slice(0, MAX_TRACK_NOTE_ROWS);
}

export function normalizeTrackNote(input: unknown): TrackNote {
  if (!input || typeof input !== "object") return DEFAULT_TRACK_NOTE;
  const o = asObject(input);
  return {
    enabled: o.enabled === true,
    title: capped(o.title, TRACK_TITLE_MAX, ""),
    subtitle: capped(o.subtitle, TRACK_TITLE_MAX, ""),
    rows: normalizeTrackRows(o.rows),
    footnote: capped(o.footnote, TRACK_FOOTNOTE_MAX, ""),
  };
}

/** Shown only when on AND there's something to show (isTrackNoteVisible). */
export const isTrackNoteVisible = (n: TrackNote): boolean => n.enabled && (n.title.length > 0 || n.rows.length > 0);

// ── order notifications — lib/analytics/events isValidEmail ──────────────────

export const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

export type OrderNotifications = { enabled: boolean; email: string };

export function normalizeOrderNotifications(input: unknown): OrderNotifications {
  const o = asObject(input);
  return { enabled: o.enabled === true, email: typeof o.email === "string" ? o.email : "" };
}
