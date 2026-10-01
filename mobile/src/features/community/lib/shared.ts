// "Media, links and docs": links pulled out of message text, and newest-first
// items grouped by month (ported from the inspiration's sharedContent.ts).

export type TextSegment = { text: string; url?: string };
export type SharedLink = { url: string; host: string };

const LINK = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi;
// Sentence punctuation that follows a link rather than belonging to it.
const TRAILING = /[.,!?;:'")\]]+$/;

/** Message text split into plain runs and tappable links (always http/https). */
export function splitLinks(body: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    const start = match.index ?? 0;
    const link = match[0].replace(TRAILING, "");
    if (!link) continue;
    if (start > last) segments.push({ text: body.slice(last, start) });
    segments.push({ text: link, url: /^https?:\/\//i.test(link) ? link : `https://${link}` });
    last = start + link.length;
  }
  if (last < body.length) segments.push({ text: body.slice(last) });
  return segments.length ? mergeText(segments) : [{ text: body }];
}

function mergeText(segments: TextSegment[]): TextSegment[] {
  return segments.reduce<TextSegment[]>((out, segment) => {
    const prev = out[out.length - 1];
    if (prev && !prev.url && !segment.url) return [...out.slice(0, -1), { text: prev.text + segment.text }];
    return [...out, segment];
  }, []);
}

/** Host without "www.", via regex (React Native's URL has no hostname). */
export function hostOf(url: string): string {
  const host = /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url;
  return host.toLowerCase().replace(/^www\./, "");
}

/** Every distinct link in a message, in order. */
export function extractLinks(body: string | null | undefined): SharedLink[] {
  if (!body) return [];
  const seen = new Set<string>();
  return splitLinks(body).flatMap((segment) => {
    if (!segment.url || seen.has(segment.url)) return [];
    seen.add(segment.url);
    return [{ url: segment.url, host: hostOf(segment.url) }];
  });
}

export type MonthSection<T> = { title: string; data: T[] };

/** Newest-first items under "This month", then "August", then "December 2025". */
export function monthSections<T extends { createdAt: string }>(items: T[], now = Date.now()): MonthSection<T>[] {
  const today = new Date(now);
  const sections: MonthSection<T>[] = [];
  for (const item of items) {
    const d = new Date(item.createdAt);
    const title =
      d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
        ? "This month"
        : d.toLocaleDateString(
            "en-US",
            d.getFullYear() === today.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" },
          );
    const current = sections[sections.length - 1];
    if (current?.title === title) sections[sections.length - 1] = { title, data: [...current.data, item] };
    else sections.push({ title, data: [item] });
  }
  return sections;
}

/** Rows of `size` for a grid inside a section list. */
export function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
}
