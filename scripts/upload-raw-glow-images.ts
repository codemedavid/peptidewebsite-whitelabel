/**
 * Upload the "Raw Glow Product Photos" Drive folder to ImageKit and attach each
 * photo to the Raw Glow Wellness product of the same name (Product.images).
 * Same convention as upload-ar-jonina-images.ts: files land in `/tenant/<slug>`.
 *
 * Only fills products that have NO image yet — an existing photo is never
 * overwritten. "RAW GLOW Peptides.png" (a generic branded vial) is not mapped:
 * it names no product.
 *
 * Source: the Drive folder, downloaded locally (pass the dir as argv[2]).
 *   npx tsx scripts/upload-raw-glow-images.ts "<dir with the .png files>"
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ImageKit from "imagekit";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "raw-glow-wellness";
const SRC_DIR = process.argv[2];

// product slug → Drive filename. Matched by product name, one to one.
const MAP: Record<string, string> = {
  "acne-defense-serum-30ml": "Acne Defense Serum Lab Glow.png",
  "ahk-cu-hair-tonic-spray-50ml": "AHK-CU Hair Tonic Spray Packaging.png",
  "ami-eyes": "AMI Eyes Polynucleotide Skincare Box.png",
  aqualyx: "AQUALYX Cosmetic Solution Box.png",
  "botulax-100": "Botulax Pharmaceutical Boxes in a Glossy Lab.png",
  "candy-pen-60u-pen-only": "Candy pens.png",
  "ghk-cu-pdrn-with-snap-8-serum-30ml": "GHK-CU PDRN Serum in a Beauty Lab.png",
  "laennec-per-tray-10-amps": "Laennec Japan.png",
  "lemon-bottle-china-10ml": "LB China 10ml.png",
  // Original Korean LEMONBOTTLE box (5 × 10ml) — the VN listing; China 50ML has its own photo.
  "lemon-bottle-vn": "Lemonbottle Ampoule Box in Beauty Lab.png",
  "lipo-vela-v-line-per-box": "Lipo Vela-V Beauty Lab Product Showcase.png",
  "lipo-vela": "LIPOVELA in a Luxe Beauty Lab.png",
  "luhilo-snow": "Luhilo Snow Skincare Lab Display.png",
  "rejuran-healer": "REJURAN Skincare Lab Showcase.png",
  "retinol-bakuchiol-serum-30ml": "Retinol Bakuchiol Serum in a Glossy Lab.png",
  "v1-matte-pen-pen-only": "V1 Matte pens.png",
};

/** Ensure the ImageKit env vars are present (Prisma loads .env; belt-and-braces). */
function loadEnvFallback() {
  const need = [
    "NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY",
    "IMAGEKIT_PRIVATE_KEY",
    "NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT",
  ];
  if (need.every((k) => process.env[k])) return;
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function hasImage(images: unknown): boolean {
  return Array.isArray(images) && images.some((u) => typeof u === "string" && u.trim());
}

async function main() {
  if (!SRC_DIR || !existsSync(SRC_DIR)) throw new Error(`Source dir missing: ${SRC_DIR}`);
  loadEnvFallback();

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const imagekit = new ImageKit({
    publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
    urlEndpoint: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT!,
  });
  const folder = `/tenant/${TENANT_SLUG}`;

  let ok = 0;
  for (const [slug, fileName] of Object.entries(MAP)) {
    const filePath = join(SRC_DIR, fileName);
    if (!existsSync(filePath)) {
      console.warn(`  ! missing file, skipped: ${fileName}`);
      continue;
    }
    const product = await prisma.product.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
    });
    if (!product) {
      console.warn(`  ! no product for slug "${slug}", skipped`);
      continue;
    }
    if (hasImage(product.images)) {
      console.log(`  = ${product.name} already has an image, left as is`);
      continue;
    }

    const uploaded = await imagekit.upload({
      file: readFileSync(filePath),
      fileName: `${slug}-${fileName.replace(/\s+/g, "-")}`,
      folder,
      useUniqueFileName: true,
      tags: ["product", TENANT_SLUG],
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { images: [uploaded.url] as never },
    });
    ok++;
    console.log(`  ✓ ${product.name}  ←  ${fileName}\n      ${uploaded.url}`);
  }

  console.log(`Done. ${ok}/${Object.keys(MAP).length} product images uploaded & attached.`);
  console.log(
    "Next: the catalog is cached (6h). Press Save on any store-admin branding " +
      "screen for raw-glow-wellness to show the photos now.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
