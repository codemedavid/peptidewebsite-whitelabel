/**
 * Rescue migration — re-host a tenant's images off a foreign storage host.
 *
 * WHY: the `hpglow` tenant carries image URLs that physically live in an OLD
 * Supabase project (`rtsnxmatvbabdylsnuuh.supabase.co`, bucket `menu-images`).
 * Only the URLs were copied into our DB — the bytes never moved. If that old
 * project is paused/deleted the images 404 forever. This downloads every such
 * image, re-uploads it to the tenant's own ImageKit folder, and rewrites the
 * stored references in `product.images` and `branding.config`.
 *
 * SAFE BY DEFAULT: runs a DRY RUN unless `--apply` is passed.
 *   • Dry run: downloads all foreign images to ./.rehost-backup/<tenant>/ (a
 *     real off-site backup), verifies each is still reachable, and prints the
 *     exact DB changes that WOULD happen. No upload, no DB write.
 *   • Apply (`--apply`): additionally uploads each backed-up image to ImageKit
 *     and writes the rewritten JSON back to the DB. Requires ImageKit creds.
 *
 * Usage:
 *   npx tsx scripts/rehost-hpglow-images.ts                 # dry run + backup
 *   npx tsx scripts/rehost-hpglow-images.ts --apply         # real migration
 *   npx tsx scripts/rehost-hpglow-images.ts --tenant=hpglow --host=<oldhost>
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/db/prisma";
import {
  collectMatchingUrls,
  rewriteJsonUrls,
  isForeignHostUrl,
  backupFileName,
} from "../src/lib/migration/rehost-urls";

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const arg = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const TENANT_ID = arg("tenant", "hpglow");
const OLD_HOST = arg("host", "rtsnxmatvbabdylsnuuh.supabase.co");
const BACKUP_DIR = path.join(process.cwd(), ".rehost-backup", TENANT_ID);

const isForeign = (s: string) => isForeignHostUrl(s, OLD_HOST);

async function main() {
  console.log(`\n▶ Re-host images for tenant "${TENANT_ID}" off ${OLD_HOST}`);
  console.log(`  mode: ${APPLY ? "APPLY (uploads + writes DB)" : "DRY RUN (backup + preview only)"}\n`);

  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) throw new Error(`Tenant "${TENANT_ID}" not found`);
  console.log(`  tenant: ${tenant.name} (slug=${tenant.slug})`);

  // 1. Gather all foreign URLs across products + branding.
  const products = await prisma.product.findMany({ where: { tenantId: TENANT_ID } });
  const branding = await prisma.branding.findFirst({ where: { tenantId: TENANT_ID } });

  const urlSet = new Set<string>();
  for (const p of products) collectMatchingUrls(p.images, isForeign).forEach((u) => urlSet.add(u));
  if (branding) collectMatchingUrls(branding.config, isForeign).forEach((u) => urlSet.add(u));
  const urls = [...urlSet];

  console.log(`  found ${urls.length} distinct foreign image URL(s) across ${products.length} product(s) + branding\n`);
  if (urls.length === 0) {
    console.log("  nothing to do.\n");
    return;
  }

  // 2. Download every image → local backup, building the old→new mapping.
  await mkdir(BACKUP_DIR, { recursive: true });
  const mapping = new Map<string, string>();
  let downloaded = 0;
  let uploaded = 0;
  const failures: { url: string; reason: string }[] = [];

  let uploadTenantMedia:
    | ((o: { tenantId: string; file: Buffer; fileName: string; tags?: string[] }) => Promise<{ url: string }>)
    | null = null;
  if (APPLY) {
    ({ uploadTenantMedia } = await import("../src/lib/imagekit/server"));
  }

  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        failures.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // Index-prefixed so two URLs sharing a basename never overwrite each other.
      const fileName = backupFileName(url, i);
      await writeFile(path.join(BACKUP_DIR, fileName), buf);
      downloaded++;

      if (APPLY && uploadTenantMedia) {
        const up = await uploadTenantMedia({
          tenantId: TENANT_ID,
          file: buf,
          fileName,
          tags: ["rehost", "from-old-supabase"],
        });
        mapping.set(url, up.url);
        uploaded++;
        console.log(`  ✓ ${fileName} → ${up.url}`);
      } else {
        console.log(`  ✓ backed up ${fileName} (${buf.length} bytes)`);
      }
    } catch (e) {
      failures.push({ url, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(`\n  backup dir: ${BACKUP_DIR}`);
  console.log(`  downloaded: ${downloaded}/${urls.length}`);
  if (failures.length) {
    console.log(`  ⚠ ${failures.length} failed:`);
    failures.forEach((f) => console.log(`     - ${f.reason}  ${f.url.slice(0, 80)}`));
  }

  // 3. Preview / apply the DB rewrite.
  if (!APPLY) {
    console.log(`\n  DRY RUN — DB changes that WOULD be made:`);
    for (const p of products) {
      const n = collectMatchingUrls(p.images, isForeign).length;
      if (n) console.log(`     product ${p.id} (${p.name}): ${n} image URL(s) in product.images`);
    }
    if (branding) {
      const n = collectMatchingUrls(branding.config, isForeign).length;
      if (n) console.log(`     branding ${branding.id}: ${n} URL(s) in branding.config`);
    }
    console.log(`\n  Re-run with --apply (ImageKit creds required) to upload + rewrite.\n`);
    return;
  }

  // Apply: only rewrite URLs we actually re-hosted (present in mapping).
  if (failures.length) {
    console.log(`\n  ✋ ${failures.length} image(s) failed to re-host — ABORTING DB write so no reference is left dangling.`);
    console.log(`     Fix the failures (or exclude those URLs) and re-run.\n`);
    process.exitCode = 1;
    return;
  }

  let productsUpdated = 0;
  let totalReplaced = 0;
  for (const p of products) {
    const { value, replaced } = rewriteJsonUrls(p.images, mapping);
    if (replaced > 0) {
      await prisma.product.update({ where: { id: p.id }, data: { images: value as never } });
      productsUpdated++;
      totalReplaced += replaced;
    }
  }
  if (branding) {
    const { value, replaced } = rewriteJsonUrls(branding.config, mapping);
    if (replaced > 0) {
      await prisma.branding.update({ where: { id: branding.id }, data: { config: value as never } });
      totalReplaced += replaced;
      console.log(`  ✓ branding.config: ${replaced} URL(s) rewritten`);
    }
  }

  console.log(`\n  ✅ APPLIED: uploaded ${uploaded}, updated ${productsUpdated} product(s), rewrote ${totalReplaced} reference(s).`);
  console.log(`     Tenant "${TENANT_ID}" no longer depends on ${OLD_HOST}.\n`);
}

main()
  .catch((e) => {
    console.error("\n✗ migration failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
