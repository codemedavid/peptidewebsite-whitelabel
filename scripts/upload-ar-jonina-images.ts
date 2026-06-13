/**
 * Upload local product photos to ImageKit and attach them to AR Jonina's
 * products (Product.images). Mirrors the app's own convention: files land in the
 * tenant folder `/tenant/<slug>` and the hosted `url` is stored on the product.
 *
 * Idempotent-ish: re-running uploads fresh copies (useUniqueFileName) and
 * overwrites Product.images with the new URL. Only the exact-match mappings
 * below are applied.
 *
 * Source: ~/Downloads/product images
 * Run from the project root:
 *   npx tsx scripts/upload-ar-jonina-images.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import ImageKit from "imagekit";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "ar-jonina";
const SRC_DIR = join(homedir(), "Downloads", "product images");

// slug (in our catalog) → image filename (in SRC_DIR). Exact matches only.
const MAP: Record<string, string> = {
  "tirzepatide-15mg-ba3": "tirzepatide 15mg.png",
  "tirzepatide-30mg-ba5": "tirzepatide 30mg.png",
  "ghk-cu-50mg-ba10": "ghk-cu 50mg.png",
  "ghk-cu-100mg-ba10": "ghk-cu 100mg.png",
  "aod-9604-bac-water": "aod-9604 5mg.png",
  "nad-500mg-ba10": "nad+ 500mg.png",
  "glutathione-1500mg-ba10": "gluthathione 1500mg.jpeg",
  "lipo-c-fat-blaster": "lipo c 10ml.jpeg",
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

async function main() {
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

    const buf = readFileSync(filePath);
    const uploaded = await imagekit.upload({
      file: buf,
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
    console.log(`  ✓ ${product.name}\n      ${uploaded.url}`);
  }

  console.log(`Done. ${ok}/${Object.keys(MAP).length} product images uploaded & attached.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
