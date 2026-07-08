// Pure core for the Storefront Notice Modal — the per-tenant disclaimer/notice
// that pops up on every storefront visit. Shared by the store-admin save action
// (server) and the live storefront + preview (client), so it must stay free of
// any DB / Next / browser dependency — it is exercised directly by
// test:notice-modal.
//
// Two-flag entitlement gate (deliberate — no tenant gets the modal automatically):
//   - operatorEnabled : the super-admin grant, set per tenant on the platform
//                       settings page. Defaults false.
//   - enabled         : the store owner's day-to-day on/off, set in the store
//                       admin's Notice Modal editor. Defaults false.
// The modal is visible only when BOTH are true (isNoticeModalVisible).
//
// This module is the single place that sanitizes untrusted notice config before
// it is persisted to branding.config. All copy is rendered by React as text
// nodes (never dangerouslySetInnerHTML), so sanitizing here means trimming and
// length/count clamping — React handles HTML escaping at render time.

export type NoticeModalConfig = {
  /** Super-admin per-tenant grant (platform settings). Off → feature unavailable. */
  operatorEnabled: boolean;
  /** Store-owner on/off (store admin editor). Off → modal hidden even if granted. */
  enabled: boolean;
  // Header
  title: string;
  subtitle: string;
  // Body — the disclaimer paragraphs
  bodyParagraphs: string[];
  // Warning callout (the red "NO MEET UPS…" box)
  warningTitle: string;
  warningBody: string;
  // Delivery cut-off callout
  deliveryTitle: string;
  deliveryLines: string[];
  // Footer
  agreeLabel: string;
  footerNote: string;
};

// ── length / count caps (untrusted input is clamped to these on save) ────────
const MAX_TITLE = 200;
const MAX_LABEL = 200;
const MAX_PARAGRAPH = 800;
const MAX_LINE = 400;
export const MAX_NOTICE_PARAGRAPHS = 8;
export const MAX_NOTICE_DELIVERY_LINES = 8;

/**
 * The safe baseline used when a tenant has never configured the notice modal.
 * Both flags are false (nothing auto-on); the copy is the design's default
 * disclaimer so a freshly granted+enabled store shows something sensible before
 * the owner edits it.
 */
export const DEFAULT_NOTICE_MODAL: NoticeModalConfig = {
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

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

/** Trim + length-cap a single untrusted string, falling back to a default. */
function str(raw: unknown, max: number, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  return raw.trim().slice(0, max);
}

/**
 * Normalize an untrusted string list: coerce entries to trimmed, length-capped
 * strings, drop blanks, and cap the count. When the field is absent (not an
 * array at all) the caller's default list is used instead — so an owner who
 * removes every line gets an empty list, but a never-touched field keeps its
 * defaults.
 */
function strList(raw: unknown, maxLen: number, maxCount: number, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .map((v) => (typeof v === "string" ? v.trim().slice(0, maxLen) : ""))
    .filter((v) => v.length > 0)
    .slice(0, maxCount);
}

/**
 * Coerce untrusted notice-modal config into a closed, safe shape before it is
 * written to branding.config (or read back at render). Strict booleans for both
 * gate flags, trimmed + length-capped copy, de-blanked + count-capped lists.
 * Never throws — a non-object collapses to the safe default.
 */
export function normalizeNoticeModal(input: unknown): NoticeModalConfig {
  if (!input || typeof input !== "object") return DEFAULT_NOTICE_MODAL;
  const o = asObject(input);

  return {
    operatorEnabled: o.operatorEnabled === true,
    enabled: o.enabled === true,
    title: str(o.title, MAX_TITLE, DEFAULT_NOTICE_MODAL.title),
    subtitle: str(o.subtitle, MAX_TITLE, DEFAULT_NOTICE_MODAL.subtitle),
    bodyParagraphs: strList(
      o.bodyParagraphs,
      MAX_PARAGRAPH,
      MAX_NOTICE_PARAGRAPHS,
      DEFAULT_NOTICE_MODAL.bodyParagraphs,
    ),
    warningTitle: str(o.warningTitle, MAX_TITLE, DEFAULT_NOTICE_MODAL.warningTitle),
    warningBody: str(o.warningBody, MAX_PARAGRAPH, DEFAULT_NOTICE_MODAL.warningBody),
    deliveryTitle: str(o.deliveryTitle, MAX_TITLE, DEFAULT_NOTICE_MODAL.deliveryTitle),
    deliveryLines: strList(
      o.deliveryLines,
      MAX_LINE,
      MAX_NOTICE_DELIVERY_LINES,
      DEFAULT_NOTICE_MODAL.deliveryLines,
    ),
    agreeLabel: str(o.agreeLabel, MAX_LABEL, DEFAULT_NOTICE_MODAL.agreeLabel),
    footerNote: str(o.footerNote, MAX_LABEL, DEFAULT_NOTICE_MODAL.footerNote),
  };
}

/**
 * The entitlement gate: the notice modal is shown only when the operator has
 * granted it AND the store owner has switched it on. Absent/null config → hidden.
 */
export function isNoticeModalVisible(cfg: NoticeModalConfig | null | undefined): boolean {
  return !!cfg && cfg.operatorEnabled === true && cfg.enabled === true;
}
