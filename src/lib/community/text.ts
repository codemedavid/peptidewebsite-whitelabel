// Text helpers for the community: search queries, the Links tab, previews.
// Pure (npm run test:community-core).

const QUERY_MIN = 2;
const QUERY_MAX = 80;
const PREVIEW_MAX = 120;
const MAX_LINKS = 10;

/** A search query worth running, or null (too short / empty). */
export function normaliseSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().replace(/\s+/g, " ").slice(0, QUERY_MAX);
  return q.length >= QUERY_MIN ? q : null;
}

/** `%q%` with LIKE wildcards and the escape character escaped (ESCAPE '\'). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** http(s) links in a message body, in order, deduplicated. */
export function extractLinks(body: string | null | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const m of body.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, "");
    if (url.length > "https://".length && !out.includes(url)) out.push(url);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export type PreviewSource = {
  kind: string;
  body: string | null;
  deleted: boolean;
  fileName?: string | null;
  productName?: string | null;
  protocolName?: string | null;
};

function clip(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

/** The one-line inbox preview of a message. Never includes file contents. */
export function previewText(m: PreviewSource): string {
  if (m.deleted) return "Message deleted";
  const caption = m.body ? clip(m.body) : "";
  switch (m.kind) {
    case "image":
      return clip(`📷 ${caption || "Photo"}`);
    case "file":
      return clip(`📎 ${caption || m.fileName || "File"}`);
    case "product":
      return clip(`🛍 ${caption || m.productName || "Product"}`);
    case "protocol":
      return clip(`📋 ${caption || m.protocolName || "Protocol"}`);
    case "drop":
      return clip(`🔥 ${caption || "New drop"}`);
    default:
      return caption;
  }
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Member";
}
