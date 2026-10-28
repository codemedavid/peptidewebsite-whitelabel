// Turn web addresses in owner-written text into links, without HTML.
//
// The owner types plain text ("…visit our Peptide Library at
// www.feelsbonita.com."); this splits it into text and link segments that the
// page renders as React nodes, so nothing the owner types is ever injected as
// markup. Only http(s) addresses become links: "www.x.com" gets https:// in
// front, and anything with another scheme (javascript:, data:) stays text.
//
// Pure, zero imports: the storefront page, the admin preview and the test all
// read the same segments.

/** Longest owner note a page accepts (the Protocols page note, for now). */
export const OWNER_NOTE_MAX = 400;

/** An owner note as stored: plain text, trimmed, capped. Never throws. */
export function normalizeOwnerNote(input: unknown): string {
  return typeof input === "string" ? input.trim().slice(0, OWNER_NOTE_MAX) : "";
}

export type TextSegment = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

/** http(s)://… or www.… up to the next space. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
/** Sentence punctuation that ends a typed address rather than belonging to it. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** The href for a typed address, or null when it isn't a safe web link. */
export function safeLinkHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A real domain has a dot of its own: "www.nodot" is a typo, not a site.
    return url.hostname.replace(/^www\./i, "").includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** Split text into plain and link segments, in order. Never throws. */
export function linkifySegments(input: string): TextSegment[] {
  const text = typeof input === "string" ? input : "";
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const address = match[0].replace(TRAILING, "");
    const href = safeLinkHref(address);
    if (!href) continue;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "link", text: address, href });
    last = start + address.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
