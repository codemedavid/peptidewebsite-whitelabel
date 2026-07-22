/**
 * One-shot rebrand: tenant `fit-n-glow` ("Fit n glow") → `peptibesties`
 * ("PeptiBesties"), plus the new per-tenant default product image.
 *
 * What it does (in order — the slug moves FIRST so the upload lands in the
 * new /tenant/peptibesties ImageKit folder):
 *   1. Tenant: slug fit-n-glow → peptibesties, name → "PeptiBesties"
 *   2. TenantSettings.storeName → "PeptiBesties" (when a row exists)
 *   3. Upload the PeptiBesties vial photo to ImageKit (server-side, folder
 *      forced from the tenant) + a MediaAsset record (type "branding")
 *   4. Branding.config: name → "PeptiBesties", defaultProductImage → the
 *      uploaded URL (consumed by the storefront fallback — see
 *      src/lib/storefront/product-image.ts)
 *
 * SAFE BY DEFAULT: dry run unless `--apply` is passed.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/rebrand-fit-n-glow-peptibesties.ts \
 *     --image="/path/to/vial.jpeg" [--apply]
 *
 * Notes:
 *   • Existing ImageKit objects stay under /tenant/fit-n-glow — their absolute
 *     URLs keep working (logo/favicon are untouched by design).
 *   • The old fit-n-glow.<root> host stops resolving; the cached host→tenant
 *     mapping expires within ~5 min on a running server (unstable_cache TTL).
 *   • Host-scoped cookies don't follow: store-admin sessions re-login on the
 *     new subdomain.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/db/prisma";

const OLD_SLUG = "fit-n-glow";
const NEW_SLUG = "peptibesties";
const NEW_NAME = "PeptiBesties";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const imageArg = args.find((a) => a.startsWith("--image="))?.slice("--image=".length);

async function main() {
  // Idempotent lookup: keep working if the slug already moved on a previous run.
  const tenant =
    (await prisma.tenant.findUnique({ where: { slug: OLD_SLUG }, include: { branding: true, settings: true } })) ??
    (await prisma.tenant.findUnique({ where: { slug: NEW_SLUG }, include: { branding: true, settings: true } }));
  if (!tenant) throw new Error(`Tenant not found under ${OLD_SLUG} or ${NEW_SLUG}`);

  const clash = await prisma.tenant.findUnique({ where: { slug: NEW_SLUG }, select: { id: true } });
  if (clash && clash.id !== tenant.id) {
    throw new Error(`Slug ${NEW_SLUG} is already taken by another tenant (${clash.id})`);
  }

  if (!imageArg) throw new Error("Pass --image=/path/to/vial.jpeg");
  const imagePath = path.resolve(imageArg);
  const bytes = await readFile(imagePath); // throws if unreadable — fail before writing anything

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — rebrand ${tenant.slug} (${tenant.id})`);
  console.log(`  1. Tenant: slug ${tenant.slug} → ${NEW_SLUG}, name ${JSON.stringify(tenant.name)} → ${JSON.stringify(NEW_NAME)}`);
  console.log(`  2. TenantSettings.storeName → ${JSON.stringify(NEW_NAME)} (${tenant.settings ? "row exists" : "no row — skipped"})`);
  console.log(`  3. Upload ${imagePath} (${bytes.length} bytes) → ImageKit /tenant/${NEW_SLUG}`);
  console.log(`  4. Branding.config: name → ${JSON.stringify(NEW_NAME)}, defaultProductImage → <uploaded URL>`);
  if (!APPLY) {
    console.log("\nNo changes made. Re-run with --apply.");
    return;
  }

  // 1+2 — slug/name first, so tenantMediaFolder resolves the NEW folder.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { slug: NEW_SLUG, name: NEW_NAME },
  });
  if (tenant.settings) {
    await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: { storeName: NEW_NAME },
    });
  }
  console.log("  ✓ tenant renamed");

  // 3 — server-side upload; folder is forced from the tenant's (new) slug.
  // Reuse an already-uploaded copy (a prior run that failed later) over
  // uploading a duplicate.
  const { uploadTenantMedia, listTenantMedia } = await import("../src/lib/imagekit/server");
  const existingFiles = await listTenantMedia(tenant.id);
  const prior = existingFiles.find(
    (f): f is typeof f & { url: string; fileId: string; name: string } =>
      "name" in f && typeof f.name === "string" && f.name.startsWith("default-product-image"),
  );
  const up = prior ?? (await uploadTenantMedia({
    tenantId: tenant.id,
    file: bytes,
    fileName: "default-product-image.jpeg",
    tags: ["branding", "default-product-image"],
  }));
  const existingAsset = await prisma.mediaAsset.findFirst({
    where: { tenantId: tenant.id, url: up.url },
    select: { id: true },
  });
  if (!existingAsset) {
    await prisma.mediaAsset.create({
      data: { tenantId: tenant.id, url: up.url, imagekitId: up.fileId, type: "branding" },
    });
  }
  console.log(`  ✓ ${prior ? "reusing uploaded" : "uploaded"} ${up.url}`);

  // 4 — stamp the brand config (merge, never replace, to keep every other key).
  const config = { ...((tenant.branding?.config ?? {}) as Record<string, unknown>) };
  config.name = NEW_NAME;
  config.defaultProductImage = up.url;
  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config },
  });
  console.log("  ✓ branding.config updated (name + defaultProductImage)");

  console.log(`\nDone. Storefront: ${NEW_SLUG}.lvh.me:3100 (dev) / ${NEW_SLUG}.<root> (prod).`);
  console.log("Host cache for the old subdomain expires within ~5 min on a running server.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
