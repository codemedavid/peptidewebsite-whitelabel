/**
 * Upload The Babe Studio's logo to ImageKit and attach it to the tenant.
 *
 * The storefront resolves the logo as `config.logoUrl || branding.logoUrl`
 * (see (tenant)/(storefront)/page.tsx), and the header reads the column
 * directly (layout.tsx), so BOTH are written — the same pair the self-serve
 * onboarding provisioner sets.
 *
 * Source file: ~/Downloads/logo-2.jpeg (the JPEG the client sent).
 *
 * DRY RUN BY DEFAULT — resolves and reports, uploads nothing:
 *   npx tsx scripts/upload-babe-studio-logo.ts
 *   npx tsx scripts/upload-babe-studio-logo.ts --apply
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import ImageKit from "imagekit";
import { PrismaClient, Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const TENANT_SLUG = "the-babe-studio";
const SRC = join(homedir(), "Downloads", "logo-2.jpeg");

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvFallback();

  if (!existsSync(SRC)) throw new Error(`Logo file not found: ${SRC}`);
  const bytes = statSync(SRC).size;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true, branding: { select: { id: true, logoUrl: true, config: true } } },
  });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  if (!tenant.branding) throw new Error(`Tenant "${TENANT_SLUG}" has no branding row`);

  console.log(`Tenant   ${tenant.name} (${tenant.id})`);
  console.log(`Source   ${SRC}  (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`Current  branding.logoUrl = ${tenant.branding.logoUrl ?? "(none)"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing uploaded. Re-run with --apply.");
    return;
  }

  const imagekit = new ImageKit({
    publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
    urlEndpoint: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT!,
  });

  const uploaded = await imagekit.upload({
    file: readFileSync(SRC),
    fileName: `${TENANT_SLUG}-logo.jpeg`,
    folder: `/tenant/${TENANT_SLUG}`,
    useUniqueFileName: true,
    tags: ["logo", TENANT_SLUG],
  });

  // Merge into the existing config blob — never replace it.
  const config = {
    ...((tenant.branding.config as Record<string, unknown>) ?? {}),
    logoUrl: uploaded.url,
  };

  await prisma.branding.update({
    where: { id: tenant.branding.id },
    data: { logoUrl: uploaded.url, config: config as unknown as Prisma.InputJsonValue },
  });

  console.log(`\n✓ Logo attached to ${TENANT_SLUG}:\n  ${uploaded.url}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
