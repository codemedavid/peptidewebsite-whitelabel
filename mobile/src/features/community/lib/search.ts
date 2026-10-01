// WhatsApp-style message search text helpers (highlighting, snippets, match stepping).
import type { CommunityMessage } from "@contract";

/** Queries shorter than this match too much to be useful. */
export const MIN_QUERY = 2;
/** Characters of context kept around a match in a result snippet. */
const SNIPPET_RADIUS = 40;

export type MatchSegment = { text: string; match: boolean };
export type StepDirection = "older" | "newer";

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits text into matched and unmatched runs, case-insensitively. */
export function splitMatches(text: string, query: string): MatchSegment[] {
  if (!query) return [{ text, match: false }];
  const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: part.toLowerCase() === query.toLowerCase() }));
}

/** One line of context around the first match, like a search result preview. */
export function snippetAround(text: string, query: string, radius = SNIPPET_RADIUS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= radius * 2) return flat;
  const at = Math.max(0, flat.toLowerCase().indexOf(query.toLowerCase()));
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + query.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** Next focused index in a newest-first match list; -1 when there are none. */
export function stepMatch(current: number, total: number, direction: StepDirection): number {
  if (total === 0) return -1;
  const next = direction === "older" ? current + 1 : current - 1;
  return Math.min(total - 1, Math.max(0, next));
}

/** The line a result shows: the caption if it matched, else the document name. */
export function hitText(message: Pick<CommunityMessage, "body" | "file">, query: string): string {
  const q = query.toLowerCase();
  const fileName = message.file?.name ?? null;
  if (message.body && (message.body.toLowerCase().includes(q) || !fileName)) return message.body;
  return fileName ? `📄 ${fileName}` : (message.body ?? "");
}

/** Identity of a result list — the focus only resets when this changes. */
export function hitIdsKey(ids: string[]): string {
  return ids.join("|");
}

/** Which hit to focus after new results: the one asked for (from Chats search), else the newest. */
export function focusIndexFor(ids: string[], wanted: string | null): number {
  const at = wanted ? ids.indexOf(wanted) : -1;
  return Math.max(0, at);
}
