/**
 * Upload Pep's by Jene's logo (tenant `pepsys-compound`) to ImageKit and make it
 * the store logo — the same path the store-admin uploader takes
 * (uploadBrandingAssetAction, src/actions/branding.ts):
 *
 *   • uploadTenantMedia → the tenant's own ImageKit folder
 *   • a MediaAsset row (type "branding:logo") so the upload is tracked
 *   • Branding.logoUrl COLUMN only. config.logoUrl must stay empty: the page
 *     resolves `config.logoUrl || branding.logoUrl`, so a config value would
 *     shadow every later upload from the admin (see seed-pepsys-compound.ts).
 *
 * Also sets config.logoCurve = 50 (a full circle): the logo is a round badge on
 * a square canvas, so at the default corner radius its white corners show.
 *
 * DRY RUN BY DEFAULT:
 *   npx tsx scripts/upload-pepsbyjene-logo.ts /path/to/logo.png
 *   npx tsx scripts/upload-pepsbyjene-logo.ts /path/to/logo.png --apply
 */
import "dotenv/config";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const SRC = ARGS.find((a) => !a.startsWith("--"));
const TENANT_SLUG = "pepsys-compound";
const LOGO_CURVE_CIRCLE = 50;
const MAX_BYTES = 10 * 1024 * 1024;

async function main() {
  if (!SRC) throw new Error("Pass the logo file path as the first argument.");
  if (!existsSync(SRC)) throw new Error(`Logo file not found: ${SRC}`);
  const bytes = statSync(SRC).size;
  if (bytes > MAX_BYTES) throw new Error(`Logo is ${bytes} bytes — over the 10 MB limit.`);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true, branding: { select: { logoUrl: true, config: true } } },
  });
  if (!tenant?.branding) throw new Error(`Tenant "${TENANT_SLUG}" or its branding row not found`);
  const config = (tenant.branding.config ?? {}) as Record<string, unknown>;

  console.log(`Tenant   ${tenant.name} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Source   ${SRC} (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`Current  branding.logoUrl = ${tenant.branding.logoUrl ?? "(none)"}`);
  console.log(`         config.logoUrl   = ${JSON.stringify(config.logoUrl ?? "")} (must stay empty)`);
  console.log(`         config.logoCurve = ${JSON.stringify(config.logoCurve)} → ${LOGO_CURVE_CIRCLE}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing uploaded. Re-run with --apply.");
    return;
  }

  const uploaded = await uploadTenantMedia({
    tenantId: tenant.id,
    file: readFileSync(SRC),
    fileName: `logo-pepsbyjene-${basename(SRC)}`,
    tags: ["branding:logo"],
  });

  await prisma.$transaction([
    prisma.mediaAsset.create({
      data: { tenantId: tenant.id, imagekitId: uploaded.fileId, url: uploaded.url, type: "branding:logo" },
    }),
    prisma.branding.update({
      where: { tenantId: tenant.id },
      data: {
        logoUrl: uploaded.url,
        config: { ...config, logoUrl: "", logoCurve: LOGO_CURVE_CIRCLE } as Prisma.InputJsonValue,
      },
    }),
  ]);

  console.log(`\n✓ Logo set: ${uploaded.url}`);
  console.log(
    "The storefront caches branding: press Save on any branding screen in the store\n" +
      "admin, or restart the server, for the live page to pick this up.",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
