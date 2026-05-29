"use server";

// Storefront product management — the DB write path behind the store admin's
// Products screen. Every action is gated on a REAL `sf_admin_session` for the
// current tenant (resolved from the request host, never the client), mirroring
// savePaymentMethodsAction. Reads/writes run through `withTenant`, so the
// tenantId is stamped on creates and enforced on every read/delete — a session
// for store A can't touch store B's catalog. In demo mode (no DB / no ImageKit)
// the same operations round-trip against the file-backed demo store instead.

import { Prisma } from "@prisma/client";
import { getTenantSlug } from "@/lib/tenant/headers";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { withTenant } from "@/lib/db/tenant-client";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  isDemoMode,
  getDemoProducts,
  getDemoStoreProducts,
  saveDemoStoreProducts,
} from "@/lib/demo/fixtures";
import {
  currencySymbolToIso,
  dbProductToStorefront,
  productToDbWrite,
  slugify,
  uniqueize,
  type DbProductRow,
} from "@/lib/storefront/product-mapping";
import type { Product } from "@/storefront/types";

export type ActionResult = { ok: true } | { error: string };
export type SaveProductResult = { ok: true; product: Product } | { error: string };
export type ListProductsResult = { ok: true; products: Product[] } | { error: string };
export type UploadImageResult = { url: string } | { error: string };

// ── Input hardening ───────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  if (v == null) return "";
  return String(v).slice(0, max);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an untrusted client object into a clean storefront Product. */
function normalizeProductInput(input: unknown): Product {
  const o = (input ?? {}) as Record<string, unknown>;
  const inclusionsRaw = Array.isArray(o.inclusions) ? o.inclusions : [];
  const inclusions = inclusionsRaw.slice(0, 100).map((it) => {
    const x = (it ?? {}) as Record<string, unknown>;
    return { name: str(x.name, 200), qty: Math.max(1, Math.round(num(x.qty)) || 1) };
  });
  return {
    id: str(o.id, 64),
    name: str(o.name, 200).trim(),
    description: str(o.description, 5000).trim(),
    price: Math.max(0, num(o.price)),
    // The display symbol the storefront shows; capped short (it's "₱", "USD", …).
    currency: str(o.currency, 8) || "₱",
    purity: str(o.purity, 32),
    category: str(o.category, 64),
    featured: o.featured === true,
    // Hosted URLs are short; allow a large cap so demo data URLs survive too.
    image: typeof o.image === "string" && o.image ? o.image.slice(0, 12_000_000) : null,
    stock: Math.max(0, Math.round(num(o.stock))),
    available: o.available !== false,
    discountPrice: Math.max(0, num(o.discountPrice)),
    discountEnabled: o.discountEnabled === true,
    isSet: o.isSet === true,
    inclusions,
    molecularWeight: str(o.molecularWeight, 64),
    cas: str(o.cas, 64),
    storage: str(o.storage, 200),
    sequence: str(o.sequence, 1000),
    sizes: str(o.sizes, 200),
  };
}

// ── Demo helpers ──────────────────────────────────────────────────────────────

/** The effective storefront product list for a demo tenant (saved or seeded). */
function demoEffectiveProducts(slug: string, displaySymbol: string): Product[] {
  const saved = getDemoStoreProducts(slug);
  if (saved) return saved;
  // First touch: seed from the builtin fixture products (structurally a DB row).
  return getDemoProducts(slug).map((dp) =>
    dbProductToStorefront(dp as unknown as DbProductRow, displaySymbol),
  );
}

// ── List ────────────────────────────────────────────────────────────────────

/**
 * The tenant's full product set (active + unavailable) for the admin screen.
 * The storefront page already server-loads these on first paint; this powers
 * the admin "Refresh" without a full reload.
 */
export async function listProductsAction(displaySymbol = "₱"): Promise<ListProductsResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  const symbol = str(displaySymbol, 8) || "₱";

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    return { ok: true, products: demoEffectiveProducts(slug, symbol) };
  }

  try {
    const rows = await withTenant(tenantId, (db) =>
      db.product.findMany({
        where: { status: { not: "archived" } },
        orderBy: { createdAt: "asc" },
      }),
    );
    return { ok: true, products: rows.map((r) => dbProductToStorefront(r as DbProductRow, symbol)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load products." };
  }
}

// ── Create / update ───────────────────────────────────────────────────────────

/**
 * Upsert a single product. A client id that doesn't resolve to an existing row
 * (e.g. the temporary `p<timestamp>` ids the form mints for new products) is
 * treated as a create, and the DB assigns the canonical cuid that comes back in
 * the result. slug/sku are generated (unique per tenant) on create and kept
 * stable across edits so product URLs don't churn.
 */
export async function saveProductAction(input: unknown): Promise<SaveProductResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  const slug = await getTenantSlug();

  const p = normalizeProductInput(input);
  if (!p.name) return { error: "Product name is required." };
  if (!p.category) return { error: "Please choose a category." };

  const displaySymbol = p.currency;
  const currencyIso = currencySymbolToIso(displaySymbol);
  const write = productToDbWrite(p, currencyIso, displaySymbol);

  // ── Demo mode: merge into the file-backed product set ──
  if (isDemoMode()) {
    const dslug = slug ?? tenantId;
    const list = demoEffectiveProducts(dslug, displaySymbol);
    const saved: Product = { ...p, id: p.id || `p${list.length + 1}-${slugify(p.name)}` };
    const i = list.findIndex((x) => x.id === saved.id);
    const next = i >= 0 ? list.map((x, j) => (j === i ? saved : x)) : [...list, saved];
    saveDemoStoreProducts(dslug, next);
    revalidateTenant(dslug, dslug);
    return { ok: true, product: saved };
  }

  // Reject un-hosted images — they must go through ImageKit (uploadProductImage),
  // never bloat the DB as a base64 data URL.
  if (p.image && p.image.startsWith("data:")) {
    return { error: "That image wasn't uploaded yet. Use Choose File, or paste an image URL." };
  }

  try {
    const saved = await withTenant(tenantId, async (db) => {
      const existing = p.id
        ? await db.product.findFirst({ where: { id: p.id }, select: { id: true } })
        : null;

      if (existing) {
        return db.product.update({
          where: { id: existing.id },
          data: {
            name: write.name,
            description: write.description,
            priceCents: write.priceCents,
            currency: write.currency,
            stock: write.stock,
            status: write.status,
            active: write.active,
            images: write.images as unknown as Prisma.InputJsonValue,
            metadata: write.metadata as unknown as Prisma.InputJsonValue,
          },
        });
      }

      // Create: pick a slug + sku unique within the tenant.
      const taken = await db.product.findMany({ select: { slug: true, sku: true } });
      const slugSet = new Set(taken.map((t) => t.slug).filter((s): s is string => !!s));
      const skuSet = new Set(taken.map((t) => t.sku));
      const base = slugify(p.name);
      const finalSlug = uniqueize(base, slugSet);
      const finalSku = uniqueize(base.toUpperCase(), skuSet);

      return db.product.create({
        data: {
          tenantId,
          sku: finalSku,
          slug: finalSlug,
          name: write.name,
          description: write.description,
          priceCents: write.priceCents,
          currency: write.currency,
          stock: write.stock,
          status: write.status,
          active: write.active,
          images: write.images as unknown as Prisma.InputJsonValue,
          metadata: write.metadata as unknown as Prisma.InputJsonValue,
        },
      });
    });

    revalidateTenant(tenantId, slug);
    return { ok: true, product: dbProductToStorefront(saved as DbProductRow, displaySymbol) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the product." };
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete one or more of the tenant's products by id. */
export async function deleteProductsAction(
  ids: unknown,
  displaySymbol = "₱",
): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  const slug = await getTenantSlug();

  const list = Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 500)
    : [];
  if (!list.length) return { ok: true };

  if (isDemoMode()) {
    const dslug = slug ?? tenantId;
    const symbol = str(displaySymbol, 8) || "₱";
    const remove = new Set(list);
    // Seed the baseline with the tenant's configured symbol so a first-delete
    // doesn't persist the survivors under the wrong currency.
    const current = getDemoStoreProducts(dslug) ?? demoEffectiveProducts(dslug, symbol);
    saveDemoStoreProducts(dslug, current.filter((p) => !remove.has(p.id)));
    revalidateTenant(dslug, dslug);
    return { ok: true };
  }

  try {
    await withTenant(tenantId, (db) => db.product.deleteMany({ where: { id: { in: list } } }));
    revalidateTenant(tenantId, slug);
    return { ok: true };
  } catch {
    // Most likely an order/cart still references the product (FK restrict).
    return {
      error: "Couldn't delete — a product may be linked to existing orders. Mark it unavailable instead.",
    };
  }
}

// ── Image upload (ImageKit) ─────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Whether real ImageKit credentials are present (not blank / not placeholders). */
function imageKitConfigured(): boolean {
  const bad = (v?: string) => !v || v.trim() === "" || v.toLowerCase().includes("placeholder");
  return (
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY) &&
    !bad(process.env.IMAGEKIT_PRIVATE_KEY) &&
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  );
}

/**
 * Upload a product image to the tenant's own ImageKit folder and return its
 * hosted URL. The folder is forced from the server-derived tenantId
 * (`uploadTenantMedia`), so one store can never write into another's namespace,
 * and a `MediaAsset` row records the upload. In demo mode the bytes round-trip
 * as a data URL; when ImageKit isn't configured the caller gets a clear,
 * actionable error (and can still paste an image URL).
 */
export async function uploadProductImageAction(formData: FormData): Promise<UploadImageResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image too large (max 10 MB)." };
  if (!file.type.startsWith("image/")) {
    return { error: `Unsupported type: ${file.type || "unknown"}.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  if (isDemoMode()) {
    return { url: `data:${file.type};base64,${bytes.toString("base64")}` };
  }

  if (!imageKitConfigured()) {
    return {
      error:
        "Image uploads aren't configured. Add your ImageKit keys to .env (NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY, NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT, IMAGEKIT_PRIVATE_KEY), or paste an image URL below.",
    };
  }

  let uploaded;
  try {
    uploaded = await uploadTenantMedia({
      tenantId,
      file: bytes,
      fileName: `product-${file.name || "image"}`,
      tags: ["product"],
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  // Record the asset for the tenant's media library — through withTenant so the
  // app.tenant_id GUC is set and the RLS WITH CHECK on media_assets passes even
  // under the RLS-forced app_user role. Best-effort: the image is already hosted,
  // so a failed audit-row insert must never throw away a successful upload.
  try {
    await withTenant(tenantId, (db) =>
      db.mediaAsset.create({
        data: { tenantId, imagekitId: uploaded.fileId, url: uploaded.url, type: "product" },
      }),
    );
  } catch {
    /* non-fatal — media-library audit row only */
  }

  return { url: uploaded.url };
}
