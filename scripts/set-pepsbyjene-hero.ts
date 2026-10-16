/**
 * Upload Pep's by Jene's hero banner (tenant `pepsys-compound`) and make it the
 * storefront hero — the same result as uploading it in the store admin's Hero
 * editor in IMAGE mode with "show text over the image" on.
 *
 * On the Showcase layout that renders the banner hero: the picture fills the
 * hero, pinned to the right (where the vials are), with the owner's headline,
 * CTAs and trust row on the empty pink area to the left. Turning the overlay off
 * in the Hero editor shows the plain banner instead.
 *
 *   • uploadTenantMedia → the tenant's own ImageKit folder + a MediaAsset row
 *   • branding.config.heroMedia (read-modify-write; every other key is kept)
 *
 * DRY RUN BY DEFAULT:
 *   npx tsx scripts/set-pepsbyjene-hero.ts /path/to/banner.png
 *   npx tsx scripts/set-pepsbyjene-hero.ts /path/to/banner.png --apply
 */
import "dotenv/config";
import { existsSync, readFileSync, statSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";
import { normalizeHeroMedia, type HeroMedia } from "../src/lib/storefront/hero-media";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const SRC = ARGS.find((a) => !a.startsWith("--"));
const TENANT_SLUG = "pepsys-compound";
const MAX_BYTES = 10 * 1024 * 1024;

/** Everything but the URL, which comes from the upload. */
const HERO: Omit<HeroMedia, "url"> = {
  mode: "image",
  alt: "Pep's by Jene vials on pink marble",
  ratio: "standard",
  focus: "right",
  linkType: "none",
  linkPage: "catalog",
  linkUrl: "",
  overlay: true,
  scrim: 0,
};

async function main() {
  if (!SRC) throw new Error("Pass the banner image path as the first argument.");
  if (!existsSync(SRC)) throw new Error(`Image not found: ${SRC}`);
  const bytes = statSync(SRC).size;
  if (bytes > MAX_BYTES) throw new Error(`Image is ${bytes} bytes — over the 10 MB limit.`);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true, branding: { select: { config: true } } },
  });
  if (!tenant?.branding) throw new Error(`Tenant "${TENANT_SLUG}" or its branding row not found`);
  const config = (tenant.branding.config ?? {}) as Record<string, unknown>;
  // normalizeHeroMedia reads `.heroMedia` off a Brand-shaped object.
  const current = normalizeHeroMedia({ heroMedia: config.heroMedia });

  console.log(`Tenant  ${tenant.name} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Source  ${SRC} (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`Hero    mode ${current.mode} → ${HERO.mode}, overlay ${current.overlay} → ${HERO.overlay}, focus → ${HERO.focus}`);
  console.log(`        current url: ${current.url || "(none)"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing uploaded. Re-run with --apply.");
    return;
  }

  const uploaded = await uploadTenantMedia({
    tenantId: tenant.id,
    file: readFileSync(SRC),
    fileName: "storefront-hero-pepsbyjene.png",
    tags: ["storefront"],
  });

  const heroMedia = normalizeHeroMedia({ heroMedia: { ...current, ...HERO, url: uploaded.url } });
  if (heroMedia.url !== uploaded.url) throw new Error("The uploaded URL did not survive normalisation.");

  await prisma.$transaction([
    prisma.mediaAsset.create({
      data: { tenantId: tenant.id, imagekitId: uploaded.fileId, url: uploaded.url, type: "storefront" },
    }),
    prisma.branding.update({
      where: { tenantId: tenant.id },
      data: { config: { ...config, heroMedia } as Prisma.InputJsonValue },
    }),
  ]);

  console.log(`\n✓ Hero banner set: ${uploaded.url}`);
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
