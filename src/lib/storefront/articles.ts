/**
 * Storefront Articles — the owner's blog/education posts.
 *
 * Persisted in the `blog_posts` table (Prisma `BlogPost`); `body` there is a
 * JSON blob `{ text, excerpt }`. The storefront receives SUMMARIES only (no
 * body) on every render, and fetches one article's body when it is opened, so a
 * store with many long posts never bloats its home page payload.
 *
 * The body is plain text with a small formatting subset (## / ### headings,
 * "- " and "1. " lists, "> " quotes, **bold**, *italic*, [label](https://…)).
 * The parser returns structured blocks — never HTML — so tenant-authored copy
 * can't inject markup into a public page, and a link survives only as http(s).
 *
 * Pure and client-safe. Covered by scripts/test-articles.ts.
 */

import { safeHttpUrl } from "./hero-links";

export const ARTICLE_LIMITS = {
  title: 160,
  slug: 80,
  excerpt: 400,
  body: 30_000,
  /** How many published summaries the storefront ships. */
  listed: 60,
  /** Derived excerpt length, before the ellipsis. */
  derivedExcerpt: 220,
} as const;

const WORDS_PER_MINUTE = 200;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTICLES_ROUTE = "articles";

export type ArticleStatus = "draft" | "published";

export type ArticleSummary = {
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string;
  /** ISO, or null for a never-published draft. */
  publishedAt: string | null;
  readMinutes: number;
};

export type Article = ArticleSummary & {
  id: string;
  status: ArticleStatus;
  body: string;
};

export type ArticleSpan = { text: string; bold?: boolean; italic?: boolean; href?: string };

export type ArticleBlock =
  | { kind: "h2" | "h3" | "p" | "quote"; spans: ArticleSpan[] }
  | { kind: "ul" | "ol"; items: ArticleSpan[][] };

export type ArticleInput = {
  title: string;
  slug: string;
  excerpt: string;
  coverUrl: string;
  body: string;
  status: ArticleStatus;
};

// ── Slugs + routing ──────────────────────────────────────────────────────────

export function slugifyArticle(raw: string): string {
  const slug = String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ARTICLE_LIMITS.slug)
    .replace(/-+$/g, "");
  return slug || "article";
}

/** `#articles/<slug>` → the slug; the list route (or anything else) → null. */
export function articleSlugFromHash(hash: string): string | null {
  const h = String(hash ?? "").replace(/^#/, "");
  const prefix = `${ARTICLES_ROUTE}/`;
  if (!h.startsWith(prefix)) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(h.slice(prefix.length));
  } catch {
    return null;
  }
  return SLUG_RE.test(slug) && slug.length <= ARTICLE_LIMITS.slug ? slug : null;
}

export function articleHash(slug: string): string {
  return `#${ARTICLES_ROUTE}/${slug}`;
}

// ── Input ────────────────────────────────────────────────────────────────────

const clip = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

/** Validate + clean an article coming from the store admin. Never throws. */
export function normalizeArticleInput(
  input: unknown,
): { ok: true; value: ArticleInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid article." };
  const o = input as Record<string, unknown>;
  const title = clip(o.title, ARTICLE_LIMITS.title);
  if (!title) return { ok: false, error: "Give the article a title." };
  const explicitSlug = clip(o.slug, 200);
  return {
    ok: true,
    value: {
      title,
      slug: slugifyArticle(explicitSlug || title),
      excerpt: clip(o.excerpt, ARTICLE_LIMITS.excerpt),
      coverUrl: safeHttpUrl(typeof o.coverUrl === "string" ? o.coverUrl : ""),
      // The body keeps its inner whitespace (blank lines are paragraph breaks).
      body: (typeof o.body === "string" ? o.body : "").replace(/\r\n/g, "\n").slice(0, ARTICLE_LIMITS.body),
      status: o.status === "published" ? "published" : "draft",
    },
  };
}

// ── Body parsing ─────────────────────────────────────────────────────────────

// **bold** | *italic* | [label](url) — a URL may hold one level of parentheses.
const INLINE_RE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

function mergePlain(spans: ArticleSpan[]): ArticleSpan[] {
  const out: ArticleSpan[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const prev = out[out.length - 1];
    const plain = !span.bold && !span.italic && !span.href;
    if (plain && prev && !prev.bold && !prev.italic && !prev.href) {
      out[out.length - 1] = { text: prev.text + span.text };
    } else {
      out.push(span);
    }
  }
  return out;
}

export function parseInline(text: string): ArticleSpan[] {
  const spans: ArticleSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ text: text.slice(last, at) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], italic: true });
    else {
      const href = safeHttpUrl(m[4]);
      spans.push(href ? { text: m[3], href } : { text: m[3] });
    }
    last = at + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return mergePlain(spans);
}

type LineKind = "blank" | "h2" | "h3" | "quote" | "ul" | "ol" | "p";

function classify(line: string): { kind: LineKind; text: string } {
  const t = line.trim();
  if (!t) return { kind: "blank", text: "" };
  if (t.startsWith("### ")) return { kind: "h3", text: t.slice(4).trim() };
  if (t.startsWith("## ")) return { kind: "h2", text: t.slice(3).trim() };
  if (t.startsWith("> ")) return { kind: "quote", text: t.slice(2).trim() };
  const ul = t.match(/^[-*•]\s+(.*)$/);
  if (ul) return { kind: "ul", text: ul[1] };
  const ol = t.match(/^\d+[.)]\s+(.*)$/);
  if (ol) return { kind: "ol", text: ol[1] };
  return { kind: "p", text: t };
}

export function parseArticleBody(text: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  let run: { kind: LineKind; lines: string[] } | null = null;

  const flush = () => {
    if (!run) return;
    const { kind, lines } = run;
    if (kind === "ul" || kind === "ol") blocks.push({ kind, items: lines.map(parseInline) });
    else if (kind === "p" || kind === "quote") blocks.push({ kind, spans: parseInline(lines.join(" ")) });
    run = null;
  };

  for (const raw of String(text ?? "").split("\n")) {
    const { kind, text: content } = classify(raw);
    if (kind === "blank") {
      flush();
      continue;
    }
    if (kind === "h2" || kind === "h3") {
      flush();
      blocks.push({ kind, spans: parseInline(content) });
      continue;
    }
    if (run && run.kind === kind) run.lines.push(content);
    else {
      flush();
      run = { kind, lines: [content] };
    }
  }
  flush();
  return blocks;
}

function plainText(blocks: ArticleBlock[]): string {
  return blocks
    .flatMap((b) => ("spans" in b ? [b.spans] : b.items))
    .map((spans) => spans.map((s) => s.text).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readMinutes(text: string): number {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

// ── DB rows ──────────────────────────────────────────────────────────────────

/** The `blog_posts` columns this module reads. Dates may arrive as strings
 *  from an unstable_cache hit, so both shapes are accepted. */
export type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  body: unknown;
  coverUrl: string | null;
  status: string;
  publishedAt: Date | string | null;
};

function isoOrNull(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function articleFromRow(row: ArticleRow): Article {
  const blob = row.body && typeof row.body === "object" ? (row.body as Record<string, unknown>) : {};
  const body = typeof blob.text === "string" ? blob.text : "";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: typeof blob.excerpt === "string" ? blob.excerpt : "",
    coverUrl: row.coverUrl ?? "",
    publishedAt: isoOrNull(row.publishedAt),
    readMinutes: readMinutes(body),
    status: row.status === "published" ? "published" : "draft",
    body,
  };
}

/** The list-card view of an article: no body, excerpt derived when blank. */
export function summarizeArticle(a: Article): ArticleSummary {
  let excerpt = a.excerpt.trim();
  if (!excerpt) {
    const plain = plainText(parseArticleBody(a.body));
    excerpt =
      plain.length > ARTICLE_LIMITS.derivedExcerpt
        ? `${plain.slice(0, ARTICLE_LIMITS.derivedExcerpt).replace(/\s+\S*$/, "")}…`
        : plain;
  }
  return {
    slug: a.slug,
    title: a.title,
    excerpt,
    coverUrl: a.coverUrl,
    publishedAt: a.publishedAt,
    readMinutes: a.readMinutes,
  };
}

/** The JSON blob stored in `blog_posts.body`. */
export function articleBodyJson(input: ArticleInput): { text: string; excerpt: string } {
  return { text: input.body, excerpt: input.excerpt };
}
