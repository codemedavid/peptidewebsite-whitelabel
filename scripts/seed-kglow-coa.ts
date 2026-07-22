/**
 * Seed the k-glow tenant's Lab Reports (COA) page with 7 Janoshik test reports.
 *
 * These are the public Janoshik Analytical certificates the store owner
 * supplied (verify.janoshik.com/tests/...). To avoid hotlinking (Janoshik
 * returns 403 to referer-less/bot requests), each certificate image is
 * downloaded with a browser UA + the verify-page referer and re-hosted into
 * k-glow's own ImageKit folder — the same rescue pattern as rehost-hpglow-images.
 * The stored `link` points at the official Janoshik verification page so a
 * customer can independently confirm the result.
 *
 * Writes branding.config.coaReports (read-modify-write, mirroring
 * saveCoaReportsAction) so the reports show on every device/customer.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/seed-kglow-coa.ts            # fetch + validate, no writes
 *   npx tsx scripts/seed-kglow-coa.ts --apply    # upload to ImageKit + DB write
 */

import "dotenv/config";

import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";
import { normalizeCoaReports } from "../src/lib/storefront/coa";
import type { CoaReport } from "../src/storefront/types";

const APPLY = process.argv.slice(2).includes("--apply");
const SLUG = "k-glow";
const LAB = "Janoshik Analytical";
const DATE = "2026-01-27"; // "Analysis conducted" date on every report
const VERIFY_BASE = "https://verify.janoshik.com/tests";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Task → (verify slug, display name, single-component purity). Blends carry mg
// per component but no single purity number, so purity is left blank for them.
type Seed = { task: string; slug: string; name: string; purity: string };
const SEEDS: Seed[] = [
  { task: "102847", slug: "102847-90030_6W2ANUZLQKSW", name: "Retatrutide 30mg", purity: "99.768%" },
  { task: "102848", slug: "102848-80030_I3YIS8HRF4NY", name: "Tirzepatide 30mg", purity: "99.816%" },
  { task: "102850", slug: "102850-BT10_Q6FETR3NZAAB", name: "TB-500 (TB-4) 10mg", purity: "99.577%" },
  { task: "102851", slug: "102851-BBG70_J72SBWN19Y2D", name: "GHK-Cu / BPC-157 / TB-500 Blend", purity: "" },
  { task: "102852", slug: "102852-CU100_1A527MDQY4SL", name: "GHK-Cu 100mg", purity: "99.693%" },
  { task: "102868", slug: "102868-RA10mg_3SJE65FDW7XP", name: "ARA-290 10mg", purity: "99.026%" },
  { task: "103116", slug: "103116-BB20_3VK2ZFJL2YHB", name: "BPC-157 / TB-500 Blend 20mg", purity: "" },
];

/** Pull the certificate image URL out of a Janoshik verify page. */
async function resolveImageUrl(verifyUrl: string): Promise<string> {
  const res = await fetch(verifyUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`verify page ${verifyUrl} → HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/\.\/img\/[a-f0-9]+\.(?:png|jpg)/i);
  if (!m) throw new Error(`no certificate image found on ${verifyUrl}`);
  return `${VERIFY_BASE}/${m[0].replace(/^\.\//, "")}`;
}

/** Download the certificate image bytes (browser UA + referer, else 403). */
async function download(imageUrl: string, referer: string): Promise<Buffer> {
  const res = await fetch(imageUrl, { headers: { "User-Agent": UA, Referer: referer } });
  if (!res.ok) throw new Error(`image ${imageUrl} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`image ${imageUrl} suspiciously small (${buf.length}B)`);
  return buf;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);
  console.log(`tenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const reports: CoaReport[] = [];
  for (const s of SEEDS) {
    const verifyUrl = `${VERIFY_BASE}/${s.slug}`;
    const srcImg = await resolveImageUrl(verifyUrl);
    const bytes = await download(srcImg, verifyUrl);

    let hostedImage = srcImg;
    if (APPLY) {
      const up = await uploadTenantMedia({
        tenantId: tenant.id,
        file: bytes,
        fileName: `coa-janoshik-${s.task}.png`,
        tags: ["lab-result", "coa", "janoshik"],
      });
      hostedImage = up.url;
    }

    reports.push({
      id: `janoshik-${s.task}`,
      name: s.name,
      lab: LAB,
      date: DATE,
      purity: s.purity,
      image: hostedImage,
      link: verifyUrl,
    });
    console.log(`  ✓ #${s.task}  ${s.name}${s.purity ? `  (${s.purity})` : ""}`);
    console.log(`      src    ${srcImg} (${(bytes.length / 1024).toFixed(0)} KB)`);
    console.log(`      hosted ${APPLY ? hostedImage : "(dry run — Janoshik URL kept)"}`);
    console.log(`      verify ${verifyUrl}`);
  }

  const normalized = normalizeCoaReports(reports);
  if (normalized.length !== SEEDS.length) {
    throw new Error(`normalizer dropped rows: ${normalized.length}/${SEEDS.length}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would write ${normalized.length} coaReports. Re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id } });
  const current = ((branding?.config ?? {}) as Record<string, unknown>) || {};
  const config = { ...current, coaReports: normalized };
  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as object },
    create: { tenantId: tenant.id, config: config as object },
  });
  console.log(`\n✓ wrote ${normalized.length} coaReports to ${SLUG} branding.config`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
