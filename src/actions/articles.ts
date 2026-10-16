"use server";

// Storefront Articles — owner-written posts in the `blog_posts` table.
//
// Gate: FEATURES.SITE_BLOG (the blog entitlement) for everything; the admin
// actions also need the "articles" staff permission. Writes go through
// updateMany/deleteMany so forTenant() scopes them — the tenant extension does
// NOT scope single-row update/delete by unique id.
//
// The public read returns ONE published post by slug. The storefront render
// ships summaries only (storefront-brand.ts), so bodies load on demand.

import { withTenant } from "@/lib/db/tenant-client";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  ARTICLE_LIMITS,
  articleBodyJson,
  articleFromRow,
  normalizeArticleInput,
  type Article,
} from "@/lib/storefront/articles";

type Fail = { error: string };

const NO_ACCESS = "You don't have access to Articles.";
const NOT_FOUND = "That article no longer exists.";
const DEMO = "Articles need the live database (demo mode is read-only).";
/** Admin list size — far above any real store's post count. */
const ADMIN_LIST_LIMIT = 500;

/** The signed-in admin's tenant, when it holds the "articles" grant AND the blog feature. */
async function articlesAdmin(): Promise<string | null> {
  const ctx = await requireStaffPermission("articles");
  if (!ctx) return null;
  return (await hasFeature(ctx.tenantId, FEATURES.SITE_BLOG)) ? ctx.tenantId : null;
}

async function bust(tenantId: string) {
  revalidateTenant(tenantId, await getTenantSlug());
}

export async function listArticlesAdminAction(): Promise<{ ok: true; articles: Article[] } | Fail> {
  const tenantId = await articlesAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { ok: true, articles: [] };
  const rows = await withTenant(tenantId, (db) =>
    db.blogPost.findMany({ orderBy: { createdAt: "desc" }, take: ADMIN_LIST_LIMIT }),
  );
  return { ok: true, articles: rows.map(articleFromRow) };
}

/**
 * Create (id null) or update an article. The slug is kept unique per tenant by
 * suffixing -2, -3…; publishedAt is stamped the first time a post goes live and
 * kept through later edits, so re-saving never reshuffles the list.
 */
export async function saveArticleAction(
  id: string | null,
  input: unknown,
): Promise<{ ok: true; article: Article } | Fail> {
  const tenantId = await articlesAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { error: DEMO };

  const parsed = normalizeArticleInput(input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;

  try {
    const saved = await withTenant(tenantId, async (db) => {
      const existing = id ? await db.blogPost.findFirst({ where: { id } }) : null;
      if (id && !existing) return null;

      const clashes = await db.blogPost.findMany({
        where: { slug: { startsWith: value.slug }, ...(id ? { NOT: { id } } : {}) },
        select: { slug: true },
      });
      const taken = new Set(clashes.map((c) => c.slug));
      let slug = value.slug;
      for (let n = 2; taken.has(slug); n++) {
        const suffix = `-${n}`;
        slug = `${value.slug.slice(0, ARTICLE_LIMITS.slug - suffix.length)}${suffix}`;
      }

      const publishedAt =
        value.status === "published" ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null);
      const data = {
        title: value.title,
        slug,
        coverUrl: value.coverUrl || null,
        body: articleBodyJson(value),
        status: value.status,
        publishedAt,
      };

      if (existing) {
        await db.blogPost.updateMany({ where: { id: existing.id }, data });
        return db.blogPost.findFirst({ where: { id: existing.id } });
      }
      // tenantId is injected by forTenant(); typed here for the Prisma input.
      return db.blogPost.create({ data: { ...data, tenantId } });
    });
    if (!saved) return { error: NOT_FOUND };
    await bust(tenantId);
    return { ok: true, article: articleFromRow(saved) };
  } catch (err) {
    console.error("[articles] save failed", err);
    return { error: "Couldn't save the article. Please try again." };
  }
}

export async function deleteArticleAction(id: string): Promise<{ ok: true } | Fail> {
  const tenantId = await articlesAdmin();
  if (!tenantId) return { error: NO_ACCESS };
  if (isDemoMode()) return { error: DEMO };
  if (typeof id !== "string" || !id) return { error: NOT_FOUND };
  const result = await withTenant(tenantId, (db) => db.blogPost.deleteMany({ where: { id } }));
  if (result.count === 0) return { error: NOT_FOUND };
  await bust(tenantId);
  return { ok: true };
}

/** Public: one PUBLISHED article of the request's store, by slug. */
export async function getPublishedArticleAction(slug: string): Promise<{ ok: true; article: Article } | Fail> {
  if (isDemoMode()) return { error: NOT_FOUND };
  const tenantId = await getTenantIdOrNull();
  if (!tenantId || !(await hasFeature(tenantId, FEATURES.SITE_BLOG))) return { error: NOT_FOUND };
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) return { error: NOT_FOUND };
  const row = await withTenant(tenantId, (db) =>
    db.blogPost.findFirst({ where: { slug, status: "published" } }),
  );
  return row ? { ok: true, article: articleFromRow(row) } : { error: NOT_FOUND };
}
