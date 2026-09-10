/**
 * Import VR Jonina's lab certificates (the Google-Drive COA folder the owner
 * supplied) into their storefront Lab Reports page.
 *
 * Every certificate is re-hosted in the tenant's own ImageKit folder and
 * becomes one row in `branding.config.coaReports`, merged with
 * mergeCoaReportsById so a re-run refreshes rows instead of stacking copies and
 * nothing the owner typed by hand is dropped.
 *
 * The metadata below was READ OFF EACH CERTIFICATE, not parsed from the file
 * name: several file names carry the wrong year (GHK-Cu is dated 12_17_2026 but
 * the report says 17 DEC 2025), an impossible day (04-31-2026), or claim a
 * purity test the certificate does not contain (the Janoshik NAD+ report states
 * content only). Purity is the headline chip on the card; for tests that report
 * no purity figure it carries that test's actual result instead (pH, benzyl
 * alcohol content, "Not detected", "Pass").
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/import-vrjonina-coa.ts            # validate + report only
 *   npx tsx scripts/import-vrjonina-coa.ts --apply    # upload + DB write
 *   npx tsx scripts/import-vrjonina-coa.ts --dir <folder>
 */

import "dotenv/config";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";
import { buildCoaReport, mergeCoaReportsById } from "../src/lib/storefront/coa-import";
import { normalizeCoaReports } from "../src/lib/storefront/coa";
import type { CoaReport } from "../src/storefront/types";

const SLUG = "vrjonina";
const DEFAULT_DIR = path.join(
  os.homedir(),
  "Downloads",
  "drive-download-20260910T233004Z-1-001",
);
const JANOSHIK = "Janoshik Analytical";
const VANGUARD = "Vanguard Laboratory";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const dirFlag = argv.indexOf("--dir");
const SOURCE_DIR = dirFlag >= 0 ? argv[dirFlag + 1] : DEFAULT_DIR;

/** One source certificate → the Lab Reports row it becomes. */
type Source = {
  file: string;
  name: string;
  lab: string;
  /** "Analysis conducted" (Janoshik) or "Date Reported" (Vanguard), ISO. */
  date: string;
  /** Headline chip: the purity figure, or the actual result of a non-purity test. */
  purity: string;
};

const SOURCES: Source[] = [
  { file: "Janoshik   01_12_2026  AOD-9604.   PURITY.  webp", name: "AOD-9604", lab: JANOSHIK, date: "2026-01-12", purity: "99.187%" },
  { file: "Janoshik 01_09_2026 Cagrilintide PURITY.webp", name: "Cagrilintide 10mg", lab: JANOSHIK, date: "2026-01-09", purity: "99.877%" },
  { file: "Janoshik 02-24-2026 BAPH BENZYL ALCOHOL CONTENT .png", name: "Bacteriostatic Water — Benzyl Alcohol #113177", lab: JANOSHIK, date: "2026-02-24", purity: "8.58 mg/ml" },
  { file: "Janoshik 02-24-2026 BAPH PH LEVEL.png", name: "Bacteriostatic Water 10ml — pH Level", lab: JANOSHIK, date: "2026-02-24", purity: "pH 7.62" },
  { file: "Janoshik 02-24-2026A BAPH BENZYL ALCOHOL CONTENT .png", name: "Bacteriostatic Water — Benzyl Alcohol #113176", lab: JANOSHIK, date: "2026-02-24", purity: "8.58 mg/ml" },
  { file: "Janoshik 03_04_2026 GLUTATHIONE PURITY.png", name: "Glutathione 1500mg", lab: JANOSHIK, date: "2026-03-04", purity: "99.489%" },
  { file: "Janoshik 03_04_2026 KPV PURITY.png", name: "KPV", lab: JANOSHIK, date: "2026-03-04", purity: "99.436%" },
  { file: "Janoshik 03_04_2026 MOTSC PURITY.png", name: "MOTS-c", lab: JANOSHIK, date: "2026-03-04", purity: "99.331%" },
  { file: "Janoshik 03_04_2026 SS-31  PURITY.png", name: "SS-31", lab: JANOSHIK, date: "2026-03-04", purity: "99.942%" },
  { file: "Janoshik 04-30-2026 ARA-290.png", name: "ARA-290", lab: JANOSHIK, date: "2026-04-30", purity: "99.490%" },
  { file: "Janoshik 04-30-2026 Tirzepatide 60mg.png", name: "Tirzepatide 60mg", lab: JANOSHIK, date: "2026-04-30", purity: "99.960%" },
  // File name says 04-31-2026; April has 30 days. The report reads 30 APR 2026.
  { file: "Janoshik 04-31-2026 Ipamorelin.png", name: "Ipamorelin 10mg", lab: JANOSHIK, date: "2026-04-30", purity: "99.523%" },
  { file: "Janoshik 04_30_2026 PT-141.  PURITY png.png", name: "PT-141", lab: JANOSHIK, date: "2026-04-30", purity: "99.754%" },
  { file: "Janoshik 04_30_2026 Tirzepatide 30MG PINKC CAP PURITY.png", name: "Tirzepatide 30mg Pink Cap", lab: JANOSHIK, date: "2026-04-30", purity: "99.854%" },
  { file: "Janoshik 05-04-2026 Tirzepatide 10mg with RAW Data.png", name: "Tirzepatide 10mg (with raw chromatogram)", lab: JANOSHIK, date: "2026-05-04", purity: "99.807%" },
  { file: "Janoshik 05-04-2026 Tirzepatide 10mg.png", name: "Tirzepatide 10mg", lab: JANOSHIK, date: "2026-05-04", purity: "99.838%" },
  { file: "Janoshik 05-05-2026 Tirzepatide 30mg Red cap Endotoxin.png", name: "Tirzepatide 30mg Red Cap — Endotoxin", lab: JANOSHIK, date: "2026-05-05", purity: "<1 EU/vial" },
  { file: "Janoshik 05-11-2026 BPC-157.png", name: "BPC-157 5mg", lab: JANOSHIK, date: "2026-05-11", purity: "99.556%" },
  // File name says 05_2026; the report reads 30 APR 2026.
  { file: "Janoshik 05_2026 Retatrutide 20mg Pink Custom Cap.png", name: "Retatrutide 20mg Pink Custom Cap", lab: JANOSHIK, date: "2026-04-30", purity: "99.270%" },
  // File name says PURITY; this report states content only, no purity figure.
  { file: "Janoshik 12_16_2025 NAD PURITY .webp", name: "NAD+ — Content", lab: JANOSHIK, date: "2025-12-16", purity: "529.73 mg" },
  { file: "Janoshik 12_16_2025 Tirzepatide PURITY. .webp", name: "Tirzepatide 30mg (Dec 2025)", lab: JANOSHIK, date: "2025-12-16", purity: "99.789%" },
  // File name says 12_17_2026; the report reads 17 DEC 2025.
  { file: "Janoshik 12_17_2026 GHKCu PURITY  .webp", name: "GHK-Cu (Dec 2025)", lab: JANOSHIK, date: "2025-12-17", purity: "99.864%" },
  { file: "Janoshik 1_09_2026 Tesamorelin PURITY .webp", name: "Tesamorelin 10mg", lab: JANOSHIK, date: "2026-01-09", purity: "99.234%" },
  { file: "Janoshik 1_1_52026 Tirzepatide PURITY.webp", name: "Tirzepatide 30mg (Jan 2026)", lab: JANOSHIK, date: "2026-01-15", purity: "99.806%" },
  { file: "Janoshik 1_30_2026 STERILITY  Test Tirzepatide.webp", name: "Tirzepatide 15mg — Sterility", lab: JANOSHIK, date: "2026-01-30", purity: "Pass" },
  { file: "Janoshik 3-6-2026 Tirzepatide 30mg PURITY .png", name: "Tirzepatide 30mg (Mar 2026)", lab: JANOSHIK, date: "2026-03-06", purity: "99.824%" },
  { file: "Janoshik 3_6_2026 HEAVY METALS.png", name: "Tirzepatide 30mg — Heavy Metals #103373", lab: JANOSHIK, date: "2026-03-06", purity: "Not detected" },
  { file: "Janoshik 3_6_2026 HEAVY METALSa.png", name: "Tirzepatide 30mg — Heavy Metals #113141", lab: JANOSHIK, date: "2026-03-06", purity: "Not detected" },
  { file: "Janoshik 3_9_2026 STERILITY .png", name: "Bacteriostatic Water 10ml — Sterility", lab: JANOSHIK, date: "2026-03-09", purity: "Pass" },
  { file: "Janoshik 5-11-2026 GHKCu.png", name: "GHK-Cu 50mg", lab: JANOSHIK, date: "2026-05-11", purity: "99.320%" },
  { file: "Janoshik 5-26-2026 TIRZEPATIDE 15MG PURITY.jpeg", name: "Tirzepatide 15mg (May 2026)", lab: JANOSHIK, date: "2026-05-26", purity: "99.791%" },
  { file: "Janoshik 5-26-2026 TIRZEPATIDE RED CAP PURIT.png", name: "Tirzepatide 30mg Red Cap", lab: JANOSHIK, date: "2026-05-26", purity: "99.848%" },
  { file: "Janoshik 6-2-2026 RETATRUTIDE PURITY.png", name: "Retatrutide 30mg Pink & Purple Cap", lab: JANOSHIK, date: "2026-06-02", purity: "99.888%" },
  { file: "Janoshik3-6-2026 tirzepatide  HEAVY METALS .png", name: "Tirzepatide — Heavy Metals #113069", lab: JANOSHIK, date: "2026-03-06", purity: "Not detected" },
  { file: "Janoshik3-6-2026 tirzepatide 15mg PURITY.png", name: "Tirzepatide 15mg (Mar 2026)", lab: JANOSHIK, date: "2026-03-06", purity: "99.799%" },
  { file: "Vanguard  1_15_2026  Bacteriostatic Water - Benzyl Alcohol Content, pH  level, Sterility Test .webp", name: "Bacteriostatic Water 10mL — Benzyl Alcohol, pH & Sterility", lab: VANGUARD, date: "2026-01-15", purity: "All Pass" },
  { file: "Vanguard 10_23_2025 Tirzepatide HEAVY METALS.png", name: "Tirzepatide 30mg Pink Cap — Heavy Metals", lab: VANGUARD, date: "2025-10-23", purity: "Not detected" },
  { file: "Vanguard 10_23_2025 Tirzepatide.webp", name: "Tirzepatide 30mg Pink Cap (Oct 2025)", lab: VANGUARD, date: "2025-10-23", purity: "99.76%" },
  { file: "Vanguard 11_18_2025 GHKCu PURITY .webp", name: "GHK-Cu 100mg Clear Cap", lab: VANGUARD, date: "2025-11-18", purity: ">99.80%" },
  { file: "Vanguard 11_18_2025 Retatrutide PURITY  .webp", name: "Retatrutide 5mg Pink Cap", lab: VANGUARD, date: "2025-11-18", purity: "99.63%" },
  { file: "Vanguard 11_18_2025 Retatrutide. HEAVY METALS TEST.png", name: "Retatrutide 5mg — Heavy Metals", lab: VANGUARD, date: "2025-11-18", purity: "Not detected" },
  { file: "Vanguard 11_1_8_2025 NAD  PURITY webp.webp", name: "NAD+ 100mg White Cap", lab: VANGUARD, date: "2025-11-18", purity: "96.29% NAD+" },
  { file: "Vanguard 6-2-2026 GHKCU PURITY .jpeg", name: "GHK-Cu 100mg Blue Cap", lab: VANGUARD, date: "2026-06-02", purity: ">99.80%" },
  { file: "Vanguard 6-2-2026 TIRZEPATIDE PINK JUNE JULY 2026 PURITY.jpeg", name: "Tirzepatide 30mg Pink Cap (Jun–Jul 2026)", lab: VANGUARD, date: "2026-06-02", purity: ">99.80%" },
  { file: "Vanguard 6-2-2026 TIRZEPATIDE RED CAP PURITY.jpeg", name: "Tirzepatide 30mg Red Cap (Jun 2026)", lab: VANGUARD, date: "2026-06-02", purity: ">99.80%" },
];

/** ImageKit-safe file stem derived from the report name. */
function fileStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "coa"
  );
}

/**
 * Re-encode a certificate to a web-sized JPEG. The folder mixes webp, png and
 * jpeg, one of them a 13 MB screenshot; normalising them keeps the Lab Reports
 * page from shipping a source scan per card.
 */
const MAX_CERT_WIDTH = 1400;
function encodeCertificate(file: string, outPath: string): Buffer {
  const py = `
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out, maxw = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB")
if im.width > maxw:
    im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
im.save(out, "JPEG", quality=85, optimize=True)
`;
  execFileSync("python3", ["-c", py, file, outPath, String(MAX_CERT_WIDTH)], { stdio: "ignore" });
  return fs.readFileSync(outPath);
}

function assertEncoderAvailable() {
  try {
    execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" });
  } catch {
    throw new Error("Certificate re-encoding needs python3 with Pillow. Install: pip3 install pillow");
  }
}

/** Resumable upload cache so a re-run after a failure never re-uploads a file. */
type UploadCache = Record<string, string>;
const cachePath = path.join(os.tmpdir(), `coa-import-${SLUG}.json`);
const readCache = (): UploadCache => {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8")) as UploadCache;
  } catch {
    return {};
  }
};
const writeCache = (c: UploadCache) => fs.writeFileSync(cachePath, JSON.stringify(c, null, 1));

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) throw new Error(`source folder not found: ${SOURCE_DIR}`);

  const onDisk = fs.readdirSync(SOURCE_DIR).filter((f) => !f.startsWith("."));
  const mapped = new Set(SOURCES.map((s) => s.file));
  const unmapped = onDisk.filter((f) => !mapped.has(f));
  if (unmapped.length > 0) throw new Error(`unmapped certificate(s):\n  ${unmapped.join("\n  ")}`);
  const missing = SOURCES.filter((s) => !fs.existsSync(path.join(SOURCE_DIR, s.file)));
  if (missing.length > 0) {
    throw new Error(`missing certificate(s):\n  ${missing.map((m) => m.file).join("\n  ")}`);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);

  assertEncoderAvailable();
  if (APPLY && !process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("IMAGEKIT_PRIVATE_KEY is not set — cannot upload");
  }

  console.log(`tenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`source ${SOURCE_DIR}`);
  console.log(`${SOURCES.length} certificates\n`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "coa-encode-"));
  const cache = readCache();
  const incoming: CoaReport[] = [];
  let srcBytes = 0;
  let outBytes = 0;

  for (const s of SOURCES) {
    const full = path.join(SOURCE_DIR, s.file);
    const stem = fileStem(s.name);
    const encoded = encodeCertificate(full, path.join(workDir, `${stem}.jpg`));
    srcBytes += fs.statSync(full).size;
    outBytes += encoded.length;

    let url = `dry-run://${stem}.jpg`;
    if (APPLY) {
      url =
        cache[s.file] ??
        (await uploadTenantMedia({
          tenantId: tenant.id,
          file: encoded,
          fileName: `coa-${stem}.jpg`,
          tags: ["lab-result", "coa"],
        })).url;
      cache[s.file] = url;
      writeCache(cache);
    }

    incoming.push(
      buildCoaReport({
        name: s.name,
        lab: s.lab,
        date: s.date,
        purity: s.purity,
        // A dry run has no hosted URL yet; use a placeholder that still passes
        // the https guard so the whole batch is validated before any upload.
        image: APPLY ? url : `https://example.invalid/${stem}.jpg`,
      }),
    );
    console.log(`  ✓ ${s.name}\n      ${s.lab} · ${s.date} · ${s.purity || "—"} · ${(encoded.length / 1024).toFixed(0)} KB`);
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id } });
  const current = (branding?.config ?? {}) as Record<string, unknown>;
  const existingRows = normalizeCoaReports(current.coaReports);
  const merged = mergeCoaReportsById(existingRows, incoming);
  const normalized = normalizeCoaReports(merged);

  if (normalized.length !== merged.length) {
    throw new Error(`normalizer dropped rows: ${normalized.length}/${merged.length}`);
  }
  if (merged.length < existingRows.length) throw new Error("merge lost reports — refusing to write");

  console.log(
    `\nsource ${(srcBytes / 1024 / 1024).toFixed(1)} MB → hosted ${(outBytes / 1024 / 1024).toFixed(1)} MB`,
  );
  console.log(`existing reports: ${existingRows.length}`);
  console.log(`final report count: ${merged.length}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing uploaded, nothing written. Re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  // The stock config still lists the seed placeholder lab "Chromate"; these
  // certificates come from Janoshik and Vanguard.
  const partners = [
    { label: "Janoshik", href: "#" },
    { label: "Vanguard", href: "#" },
  ];
  const config = { ...current, coaReports: normalized, coaPartners: partners };
  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as object },
    create: { tenantId: tenant.id, config: config as object },
  });

  console.log(`\n✓ wrote ${normalized.length} lab reports to branding.config for ${SLUG}`);
  console.log("  coaPartners set to Janoshik + Vanguard (was the seed placeholder Chromate)");
  console.log("Note: the storefront caches branding — hit Save once in the store admin (or restart) to flush it.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  await prisma.$disconnect();
  process.exit(1);
});
