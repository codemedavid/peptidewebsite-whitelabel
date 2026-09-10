/**
 * Import VR Jonina's supplier protocol guides (the Google-Drive folder the
 * owner supplied) into their storefront Protocols page.
 *
 * Each source file becomes ONE image-mode protocol: a PDF's pages are rendered
 * to JPEGs and become that protocol's gallery, a flyer image becomes a
 * single-image gallery. Image mode is what the owner already uses for the
 * MicaBlend 2.0 flyer — the guides are laid-out documents (tables, dilution
 * charts, do's and don'ts) that lose their meaning when flattened into the
 * five written fields, so the page is kept as authored.
 *
 * Every image is re-hosted in the tenant's own ImageKit folder via
 * uploadTenantMedia — the storefront never hotlinks a local file.
 *
 * The write is a read-modify-write of `branding.config.protocols` (protocols
 * have no SQL table), merged with mergeProtocolsByName: a guide whose name
 * already exists is refreshed in place, everything else is appended, and no
 * protocol the owner typed by hand is ever dropped.
 *
 * Requires python3 with PyMuPDF (`pip install pymupdf`) for PDF rendering.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/import-vrjonina-protocols.ts            # render + report only
 *   npx tsx scripts/import-vrjonina-protocols.ts --apply    # upload + DB write
 *   npx tsx scripts/import-vrjonina-protocols.ts --dir <folder>
 */

import "dotenv/config";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";
import {
  buildImageProtocol,
  mergeProtocolsByName,
  protocolKey,
} from "../src/lib/storefront/protocol-import";
import type { Protocol } from "../src/storefront/types";

const SLUG = "vrjonina";
const DEFAULT_DIR = path.join(
  os.homedir(),
  "Downloads",
  "drive-download-20260910T225906Z-1-001",
);
/** 144 dpi ≈ 1191×1685 per A4 page, ~215 KB as q82 JPEG — crisp on retina,
 *  small enough for a gallery of ~85 pages behind ImageKit. */
const RENDER_DPI = 144;
const JPEG_QUALITY = 82;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const dirFlag = argv.indexOf("--dir");
const SOURCE_DIR = dirFlag >= 0 ? argv[dirFlag + 1] : DEFAULT_DIR;

/**
 * Source file → the protocol row it becomes. Categories reuse the tenant's
 * existing filter values wherever one fits; "Hormone Support" and "Immune
 * Support" are new because nothing existing covered HCG, Thymosin Alpha-1 or
 * VIP. Names are taken from each document's own title so the owner recognises
 * the row against the file they sent.
 */
type Source = { file: string; name: string; category: string };
const SOURCES: Source[] = [
  { file: "5amino 1mq.pdf", name: "5-Amino-1MQ", category: "Fat Burning & Energy" },
  { file: "AOD-9604 (1).pdf", name: "AOD-9604", category: "Fat Burning & Energy" },
  { file: "Adamax.pdf", name: "Adamax", category: "Cognitive Enhancement" },
  { file: "CAGRILINTIDE (1).pdf", name: "Cagrilintide", category: "Weight Management" },
  { file: "CJC-1295 without DAC+ I pamorelin (2).pdf", name: "CJC-1295 without DAC + Ipamorelin", category: "Growth Hormone" },
  { file: "Dihexa.pdf", name: "Dihexa", category: "Cognitive Enhancement" },
  { file: "Epithalon-Epitalon.pdf", name: "Epithalon (Epitalon)", category: "Longevity & Anti-Aging" },
  { file: "GHK-Cu.pdf", name: "GHK-Cu 50mg & 100mg", category: "Beauty & Regeneration" },
  { file: "GHK-Cu_KPV_Blend_Guide.pdf", name: "The Mica Blend GHK-Cu 50mg + KPV 10mg — Quick Guide", category: "Anti-Inflammatory & Regeneration" },
  { file: "GLOW.pdf", name: "GLOW (BPC-157 + GHK-Cu + TB-500)", category: "Healing & Anti-Inflammatory" },
  { file: "Glutathione 1500 mg. (1).pdf", name: "Glutathione 1500mg", category: "Detox & Skin Brightening" },
  { file: "HCG 500 IU (1).pdf", name: "HCG 500 IU", category: "Hormone Support" },
  { file: "KLOW 80mg.pdf", name: "KLOW 80mg", category: "Healing & Anti-Inflammatory" },
  { file: "L-Carnitine.pdf", name: "L-Carnitine", category: "Fat Burning & Energy" },
  { file: "LIPO C – Fat Blaster Peptide Guide (2).pdf", name: "Lipo C Fat Blaster", category: "Fat Burning & Energy" },
  { file: "MOTS-c — 10 mg & 40 mg .pdf", name: "MOTS-c 10mg & 40mg", category: "Metabolic Health" },
  { file: "NA Selank Amidate.pdf", name: "N-Acetyl Selank Amidate", category: "Cognitive Enhancement" },
  { file: "NA Semax Amidate.pdf", name: "N-Acetyl Semax Amidate", category: "Cognitive Enhancement" },
  { file: "NAD+ (Nicotinamide Adenine Dinucleotide) — 500 mg  .pdf", name: "NAD+ 500mg", category: "Longevity & Anti-Aging" },
  { file: "Oxytocin.pdf", name: "Oxytocin", category: "Sexual Wellness" },
  { file: "Retatrutide.pdf", name: "Retatrutide", category: "Weight Management" },
  { file: "SEMAX 10 + SELANK 10 BLEND.pdf", name: "Semax 10mg + Selank 10mg Blend", category: "Cognitive Enhancement" },
  { file: "SS-31  — 10 mg & 50 mg  .pdf", name: "SS-31 10mg & 50mg", category: "Mitochondrial Health" },
  { file: "Semax.pdf", name: "Semax", category: "Cognitive Enhancement" },
  { file: "Super Human Blend (1).pdf", name: "Super Human Blend", category: "Fat Burning & Energy" },
  { file: "Thymosin Alpha 1 (Tα1) — 5 mg & 10 mg.pdf", name: "Thymosin Alpha-1 5mg & 10mg", category: "Immune Support" },
  { file: "Tirz epat ide.  _ TR10 TR15 TR20 TR30 TR60.pdf", name: "Tirzepatide TR10 / TR15 / TR20 / TR30 / TR60", category: "Weight Management" },
  { file: "TMB.pdf", name: "The Mica Blend GHK-Cu 50mg + KPV 10mg", category: "Anti-Inflammatory & Regeneration" },
  { file: "TSM.pdf", name: "Tesamorelin", category: "Growth Hormone" },
  { file: "VIP.pdf", name: "VIP (Vasoactive Intestinal Peptide)", category: "Immune Support" },
  { file: "Vilon.pdf", name: "Vilon", category: "Longevity & Anti-Aging" },
  // Flyer images — already single-page artwork, uploaded as-is.
  { file: "MICABLEND 2.0_TR30mg + CAG5mg.jpg", name: "MicaBlend 2.0 tirzepatide 30mg + cagrilintide 5mg", category: "Weight Management" },
  { file: "MICABLEND 3.0_GHK100mg + KPV20mg.jpg", name: "MicaBlend 3.0 GHK-Cu 100mg + KPV 20mg", category: "Anti-Inflammatory & Regeneration" },
  { file: "RETALIDE_Retatrutide 30mg + Cagrilintide 5mg.jpeg", name: "Retalide retatrutide 30mg + cagrilintide 5mg", category: "Weight Management" },
];

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** ImageKit-safe file stem derived from the protocol name. */
function fileStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "protocol"
  );
}

/**
 * Render a PDF's pages to JPEG buffers via python3 + PyMuPDF. Node has no
 * usable PDF rasteriser here, so the one external dependency is isolated to
 * this function and checked up front with a clear message.
 */
function renderPdf(file: string, outDir: string): Buffer[] {
  const py = `
import fitz, json, sys
src, out, dpi, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
doc = fitz.open(src)
paths = []
for i, page in enumerate(doc):
    p = f"{out}/page-{i + 1}.jpg"
    page.get_pixmap(dpi=dpi).save(p, jpg_quality=q)
    paths.append(p)
print(json.dumps(paths))
`;
  const stdout = execFileSync(
    "python3",
    ["-c", py, file, outDir, String(RENDER_DPI), String(JPEG_QUALITY)],
    { encoding: "utf8" },
  );
  const paths = JSON.parse(stdout.trim()) as string[];
  return paths.map((p) => fs.readFileSync(p));
}

function assertRendererAvailable() {
  try {
    execFileSync("python3", ["-c", "import fitz"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "PDF rendering needs python3 with PyMuPDF. Install it with: pip3 install pymupdf",
    );
  }
}

/** Resumable upload cache so a re-run after a failure never re-uploads a page. */
type UploadCache = Record<string, string>;
const cachePath = path.join(os.tmpdir(), `protocol-import-${SLUG}.json`);
function readCache(): UploadCache {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8")) as UploadCache;
  } catch {
    return {};
  }
}
function writeCache(cache: UploadCache) {
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
}

/** Flag existing rows that look like they already cover an imported guide. */
function overlaps(existingRows: Protocol[], incoming: Protocol[]): string[] {
  const hits: string[] = [];
  const incomingKeys = new Set(incoming.map((p) => protocolKey(p.name)));
  for (const row of existingRows) {
    const key = protocolKey(row.name);
    if (incomingKeys.has(key)) continue; // handled as an in-place refresh
    const head = key.split(" ")[0];
    if (head.length < 3) continue;
    const match = incoming.find((p) => protocolKey(p.name).split(" ")[0] === head);
    if (match) hits.push(`${row.name}  ~  ${match.name}`);
  }
  return hits;
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) throw new Error(`source folder not found: ${SOURCE_DIR}`);

  // Every file in the folder must be accounted for — a silently skipped guide
  // is the failure mode this import exists to avoid.
  const onDisk = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => !f.startsWith(".") && (f.toLowerCase().endsWith(".pdf") || IMAGE_EXTS.has(path.extname(f).toLowerCase())));
  const mapped = new Set(SOURCES.map((s) => s.file));
  const unmapped = onDisk.filter((f) => !mapped.has(f));
  if (unmapped.length > 0) {
    throw new Error(`unmapped source file(s):\n  ${unmapped.join("\n  ")}`);
  }
  const missing = SOURCES.filter((s) => !fs.existsSync(path.join(SOURCE_DIR, s.file)));
  if (missing.length > 0) {
    throw new Error(`missing source file(s):\n  ${missing.map((m) => m.file).join("\n  ")}`);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);

  assertRendererAvailable();
  if (APPLY && !process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("IMAGEKIT_PRIVATE_KEY is not set — cannot upload");
  }

  console.log(`tenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`source ${SOURCE_DIR}`);
  console.log(`${SOURCES.length} guide files\n`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "protocol-render-"));
  const cache = readCache();
  const incoming: Protocol[] = [];
  let totalBytes = 0;
  let totalPages = 0;

  for (const src of SOURCES) {
    const full = path.join(SOURCE_DIR, src.file);
    const isPdf = full.toLowerCase().endsWith(".pdf");

    let pages: Buffer[];
    if (isPdf) {
      const pageDir = fs.mkdtempSync(path.join(workDir, "pdf-"));
      pages = renderPdf(full, pageDir);
    } else {
      pages = [fs.readFileSync(full)];
    }
    if (pages.length === 0) throw new Error(`${src.file} produced no pages`);

    const stem = fileStem(src.name);
    const urls: string[] = [];
    for (const [i, bytes] of pages.entries()) {
      totalBytes += bytes.length;
      totalPages++;
      const cacheKey = `${src.file}#${i + 1}`;
      if (!APPLY) {
        urls.push(`dry-run://${stem}-p${i + 1}.jpg`);
        continue;
      }
      const cached = cache[cacheKey];
      if (cached) {
        urls.push(cached);
        continue;
      }
      const up = await uploadTenantMedia({
        tenantId: tenant.id,
        file: bytes,
        fileName: `protocol-${stem}-p${i + 1}.jpg`,
        tags: ["protocol", "guide"],
      });
      cache[cacheKey] = up.url;
      writeCache(cache);
      urls.push(up.url);
    }

    incoming.push(buildImageProtocol({ name: src.name, category: src.category, images: urls }));
    const kb = pages.reduce((n, b) => n + b.length, 0) / 1024;
    console.log(
      `  ✓ ${src.name}\n      ${src.category} · ${pages.length} image${pages.length === 1 ? "" : "s"} · ${kb.toFixed(0)} KB · ${src.file}`,
    );
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id } });
  const current = (branding?.config ?? {}) as Record<string, unknown>;
  const existingRows = Array.isArray(current.protocols) ? (current.protocols as Protocol[]) : [];
  const merged = mergeProtocolsByName(existingRows, incoming);

  const existingKeys = new Set(existingRows.map((p) => protocolKey(p.name)));
  const refreshed = incoming.filter((p) => existingKeys.has(protocolKey(p.name)));
  const added = incoming.filter((p) => !existingKeys.has(protocolKey(p.name)));

  console.log(`\n${totalPages} images (${(totalBytes / 1024 / 1024).toFixed(1)} MB total)`);
  console.log(`existing protocols: ${existingRows.length}`);
  console.log(`  refreshed in place: ${refreshed.length}${refreshed.length ? ` (${refreshed.map((p) => p.name).join(", ")})` : ""}`);
  console.log(`  newly added:        ${added.length}`);
  console.log(`final protocol count: ${merged.length}`);

  if (merged.length < existingRows.length) {
    throw new Error("merge lost protocols — refusing to write");
  }

  const dupes = overlaps(existingRows, incoming);
  if (dupes.length > 0) {
    console.log(
      `\nHeads up — ${dupes.length} existing typed protocol(s) look like they cover the same peptide as an imported guide. Nothing was deleted; prune them in the store admin if you want:`,
    );
    for (const d of dupes) console.log(`  · ${d}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing uploaded, nothing written. Re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }

  const config = { ...current, protocols: merged };
  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as object },
    create: { tenantId: tenant.id, config: config as object },
  });

  console.log(`\n✓ wrote ${merged.length} protocols to branding.config for ${SLUG}`);
  console.log(
    "Note: the storefront caches branding — hit Save once in the store admin (or restart the server) to flush it.",
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  await prisma.$disconnect();
  process.exit(1);
});
