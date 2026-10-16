/**
 * Self-contained test for the storefront Articles core (no DB, no network).
 *
 * Articles are owner-written posts (the "Articles" page The Peppy Lab ran on its
 * old site). The body is plain text with a small, safe formatting subset — it is
 * tenant-authored and rendered on a public page, so the parser must never emit
 * HTML, and a link must never carry anything but http(s).
 *
 *   npm run test:articles
 */

import assert from "node:assert";

import {
  ARTICLE_LIMITS,
  articleFromRow,
  articleSlugFromHash,
  normalizeArticleInput,
  parseArticleBody,
  readMinutes,
  slugifyArticle,
  summarizeArticle,
} from "../src/lib/storefront/articles";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("\nArticles\n");

// ──────────────────────────── slugs ─────────────────────────────────────────
check("slugify: lowercase, hyphenated, accents and symbols dropped", () => {
  assert.strictEqual(slugifyArticle("  GHK-Cu: The Copper Peptide, Explained! "), "ghk-cu-the-copper-peptide-explained");
  assert.strictEqual(slugifyArticle("Résumé & Café"), "resume-and-cafe");
});

check("slugify: an all-symbol title still yields a usable slug", () => {
  assert.strictEqual(slugifyArticle("!!!"), "article");
});

check("slugify: capped at the slug limit without a trailing hyphen", () => {
  const s = slugifyArticle("word ".repeat(60));
  assert.ok(s.length <= ARTICLE_LIMITS.slug, `${s.length}`);
  assert.ok(!s.endsWith("-"));
});

// ──────────────────────────── hash ──────────────────────────────────────────
check("hash: #articles/<slug> yields the slug; the list route yields null", () => {
  assert.strictEqual(articleSlugFromHash("#articles/what-is-nad"), "what-is-nad");
  assert.strictEqual(articleSlugFromHash("articles/what-is-nad"), "what-is-nad");
  assert.strictEqual(articleSlugFromHash("#articles"), null);
  assert.strictEqual(articleSlugFromHash("#articles/"), null);
  assert.strictEqual(articleSlugFromHash("#faq"), null);
});

check("hash: a slug is decoded and junk is rejected", () => {
  assert.strictEqual(articleSlugFromHash("#articles/what%2Dis"), "what-is");
  assert.strictEqual(articleSlugFromHash("#articles/<script>"), null);
  assert.strictEqual(articleSlugFromHash("#articles/%E0%A4%A"), null);
});

// ──────────────────────────── input ─────────────────────────────────────────
check("input: a valid article normalizes, slug derived from the title", () => {
  const r = normalizeArticleInput({ title: "  What is NAD+?  ", body: "Hello\n\nWorld", status: "published" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.strictEqual(r.value.title, "What is NAD+?");
  assert.strictEqual(r.value.slug, "what-is-nad");
  assert.strictEqual(r.value.status, "published");
  assert.strictEqual(r.value.body, "Hello\n\nWorld");
});

check("input: a title is required", () => {
  const r = normalizeArticleInput({ title: "   ", body: "x" });
  assert.ok(!r.ok);
});

check("input: unknown status falls back to draft", () => {
  const r = normalizeArticleInput({ title: "T", status: "live" });
  assert.ok(r.ok && r.value.status === "draft");
});

check("input: an explicit slug is cleaned, not trusted", () => {
  const r = normalizeArticleInput({ title: "T", slug: "My Slug/../x" });
  assert.ok(r.ok && r.value.slug === "my-slug-x");
});

check("input: cover must be http(s); anything else is dropped", () => {
  const ok = normalizeArticleInput({ title: "T", coverUrl: "https://ik.imagekit.io/x/a.jpg" });
  const bad = normalizeArticleInput({ title: "T", coverUrl: "javascript:alert(1)" });
  assert.ok(ok.ok && ok.value.coverUrl === "https://ik.imagekit.io/x/a.jpg");
  assert.ok(bad.ok && bad.value.coverUrl === "");
});

check("input: long fields are capped", () => {
  const r = normalizeArticleInput({
    title: "t".repeat(500),
    excerpt: "e".repeat(5000),
    body: "b".repeat(ARTICLE_LIMITS.body + 100),
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.strictEqual(r.value.title.length, ARTICLE_LIMITS.title);
  assert.strictEqual(r.value.excerpt.length, ARTICLE_LIMITS.excerpt);
  assert.strictEqual(r.value.body.length, ARTICLE_LIMITS.body);
});

check("input: non-object input is rejected without throwing", () => {
  assert.ok(!normalizeArticleInput(null).ok);
  assert.ok(!normalizeArticleInput("x").ok);
});

// ──────────────────────────── body parser ───────────────────────────────────
check("body: paragraphs split on blank lines; single newlines join", () => {
  const blocks = parseArticleBody("First line\nstill first\n\nSecond");
  assert.deepStrictEqual(blocks, [
    { kind: "p", spans: [{ text: "First line still first" }] },
    { kind: "p", spans: [{ text: "Second" }] },
  ]);
});

check("body: headings, quotes and both list kinds", () => {
  const blocks = parseArticleBody("## Dosing\n### Weekly\n> Always consult\n- one\n- two\n\n1. a\n2. b");
  assert.deepStrictEqual(
    blocks.map((b) => b.kind),
    ["h2", "h3", "quote", "ul", "ol"],
  );
  const ul = blocks[3];
  assert.ok(ul.kind === "ul" && ul.items.length === 2 && ul.items[1][0].text === "two");
});

check("body: **bold**, *italic* and safe links become spans", () => {
  const [p] = parseArticleBody("Use **BAC water** and *care* — see [the guide](https://example.com/g).");
  assert.ok(p.kind === "p");
  if (p.kind !== "p") return;
  assert.deepStrictEqual(p.spans, [
    { text: "Use " },
    { text: "BAC water", bold: true },
    { text: " and " },
    { text: "care", italic: true },
    { text: " — see " },
    { text: "the guide", href: "https://example.com/g" },
    { text: "." },
  ]);
});

check("body: an unsafe link degrades to its plain label", () => {
  const [p] = parseArticleBody("[click](javascript:alert(1))");
  assert.ok(p.kind === "p");
  if (p.kind !== "p") return;
  assert.deepStrictEqual(p.spans, [{ text: "click" }]);
});

check("body: HTML is never interpreted — it stays literal text", () => {
  const [p] = parseArticleBody("<img src=x onerror=alert(1)>");
  assert.ok(p.kind === "p");
  if (p.kind !== "p") return;
  assert.strictEqual(p.spans[0].text, "<img src=x onerror=alert(1)>");
});

check("body: empty or whitespace-only text yields no blocks", () => {
  assert.deepStrictEqual(parseArticleBody("   \n\n  "), []);
});

// ──────────────────────────── summaries ─────────────────────────────────────
check("read time: ~200 words a minute, never below 1", () => {
  assert.strictEqual(readMinutes(""), 1);
  assert.strictEqual(readMinutes("word ".repeat(450)), 3);
});

const ROW = {
  id: "cuid1",
  slug: "what-is-nad",
  title: "What is NAD+?",
  body: { text: "## Intro\n\nNAD+ is a **coenzyme** found in every cell.", excerpt: "" },
  coverUrl: "https://ik.imagekit.io/x/nad.jpg",
  status: "published",
  publishedAt: new Date("2026-10-01T00:00:00.000Z"),
  createdAt: new Date("2026-09-30T00:00:00.000Z"),
};

check("row: DB row maps to an article, body text out of the JSON blob", () => {
  const a = articleFromRow(ROW);
  assert.strictEqual(a.id, "cuid1");
  assert.strictEqual(a.status, "published");
  assert.strictEqual(a.body, "## Intro\n\nNAD+ is a **coenzyme** found in every cell.");
  assert.strictEqual(a.publishedAt, "2026-10-01T00:00:00.000Z");
});

check("row: a malformed body blob reads as empty, not a crash", () => {
  const a = articleFromRow({ ...ROW, body: "garbage" as unknown as object });
  assert.strictEqual(a.body, "");
});

check("row: a cached row's string dates survive (unstable_cache returns strings)", () => {
  const a = articleFromRow({ ...ROW, publishedAt: "2026-10-01T00:00:00.000Z" as unknown as Date });
  assert.strictEqual(a.publishedAt, "2026-10-01T00:00:00.000Z");
});

check("summary: a blank excerpt is derived from the body as plain text", () => {
  const s = summarizeArticle(articleFromRow(ROW));
  assert.strictEqual(s.excerpt, "Intro NAD+ is a coenzyme found in every cell.");
  assert.ok(!("body" in s));
});

check("summary: an owner-written excerpt wins", () => {
  const s = summarizeArticle(articleFromRow({ ...ROW, body: { text: "x", excerpt: "Short and sweet." } }));
  assert.strictEqual(s.excerpt, "Short and sweet.");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
