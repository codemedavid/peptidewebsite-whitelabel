// Pure core for the Track-Order Delivery Note — the per-tenant informational
// card shown on the storefront's Track Order page, directly under the "search
// your order number" box. Shared by the store-admin save action (server) and the
// live storefront + preview (client), so it must stay free of any DB / Next /
// browser dependency — it is exercised directly by test:track-note.
//
// Single-flag gate (deliberately simpler than the Notice Modal's two-flag
// entitlement — this is plain informational content, not a premium feature, so
// any store may use it):
//   - enabled : the store owner's on/off, set in the store admin's Track Note
//               editor. Defaults false — no tenant shows it automatically.
// The card is visible only when enabled AND it has something to show
// (isTrackNoteVisible).
//
// This module is the single place that sanitizes untrusted track-note config
// before it is persisted to branding.config. All copy is rendered by React as
// text nodes (never dangerouslySetInnerHTML), so sanitizing here means trimming
// and length/count clamping — React handles HTML escaping at render time.

/** One region → delivery-estimate pair (e.g. "Mindanao" → "1–5 days"). */
export type TrackNoteRow = {
  region: string;
  estimate: string;
};

export type TrackNoteConfig = {
  /** Store-owner on/off (store admin editor). Off → card hidden even with copy. */
  enabled: boolean;
  /** Card heading, e.g. "J&T Express Delivery Estimates". */
  title: string;
  /** Small muted qualifier next to the title, e.g. "from Davao City". */
  subtitle: string;
  /** The region → estimate rows, rendered as a two-column grid. */
  rows: TrackNoteRow[];
  /** Fine-print line under the grid, e.g. "* Sending day not counted. …". */
  footnote: string;
};

// ── length / count caps (untrusted input is clamped to these on save) ────────
const MAX_TITLE = 120;
const MAX_SUBTITLE = 120;
const MAX_CELL = 80;
const MAX_FOOTNOTE = 400;
export const MAX_TRACK_NOTE_ROWS = 12;

/**
 * The off-by-default baseline for EVERY tenant. Empty content + disabled, so a
 * store that never touched the feature shows nothing and inherits no other
 * store's copy. Owners fill their own courier / region estimates (or load the
 * example below) from the store-admin editor.
 */
export const DEFAULT_TRACK_NOTE: TrackNoteConfig = {
  enabled: false,
  title: "",
  subtitle: "",
  rows: [],
  footnote: "",
};

/**
 * A ready-made example an owner can load with one click in the editor — the J&T
 * Express estimates for a Davao-based store. Not a per-tenant default (that would
 * push Davao-specific copy onto every store); purely starter content to keep or
 * edit. Ordered for a 2-column grid with default row flow: left column gets
 * Mindanao / Visayas, right column gets Metro Manila & Luzon / Island Provinces.
 */
export const TRACK_NOTE_EXAMPLE: TrackNoteConfig = {
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

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

/** Trim + length-cap a single untrusted string, falling back to a default. */
function str(raw: unknown, max: number, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  return raw.trim().slice(0, max);
}

/**
 * Normalize an untrusted rows list: coerce each entry to a trimmed, length-capped
 * { region, estimate }, drop rows where BOTH cells are blank, and cap the count.
 * When the field is absent (not an array at all) the default rows are used — so
 * an owner who removes every row gets an empty grid, but a never-touched field
 * keeps its defaults.
 */
function rowList(raw: unknown): TrackNoteRow[] {
  if (!Array.isArray(raw)) return DEFAULT_TRACK_NOTE.rows;
  return raw
    .map((entry) => {
      const o = asObject(entry);
      return {
        region: str(o.region, MAX_CELL, ""),
        estimate: str(o.estimate, MAX_CELL, ""),
      };
    })
    .filter((r) => r.region.length > 0 || r.estimate.length > 0)
    .slice(0, MAX_TRACK_NOTE_ROWS);
}

/**
 * Coerce untrusted track-note config into a closed, safe shape before it is
 * written to branding.config (or read back at render). Strict boolean gate flag,
 * trimmed + length-capped copy, de-blanked + count-capped rows. Never throws — a
 * non-object collapses to the safe default.
 */
export function normalizeTrackNote(input: unknown): TrackNoteConfig {
  if (!input || typeof input !== "object") return DEFAULT_TRACK_NOTE;
  const o = asObject(input);

  return {
    enabled: o.enabled === true,
    title: str(o.title, MAX_TITLE, DEFAULT_TRACK_NOTE.title),
    subtitle: str(o.subtitle, MAX_SUBTITLE, DEFAULT_TRACK_NOTE.subtitle),
    rows: rowList(o.rows),
    footnote: str(o.footnote, MAX_FOOTNOTE, DEFAULT_TRACK_NOTE.footnote),
  };
}

/**
 * The gate: the track note is shown only when the owner enabled it AND there is
 * something to display (a title or at least one row). Absent/null config, or an
 * enabled-but-empty config, → hidden.
 */
export function isTrackNoteVisible(cfg: TrackNoteConfig | null | undefined): boolean {
  return !!cfg && cfg.enabled === true && (cfg.title.length > 0 || cfg.rows.length > 0);
}
