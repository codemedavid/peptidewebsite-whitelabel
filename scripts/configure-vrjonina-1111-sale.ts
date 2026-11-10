/**
 * ONE-SHOT promo for `vrjonina`: the 11.11 sale (2026-11-11, Asia/Manila).
 *
 * Same shape as the owner's Halloween promo: SELECTED PRODUCTS get a slashed
 * sale price ("NOW ₱1,080"), plus a promo bar and a pop-up pointing shoppers at
 * the catalog. No discount code. Everything is ordinary store-admin data, so
 * the owner can see and edit it afterwards (product editor → Discount / option
 * sale price, Announcement Banner, Announcement Pop-up).
 *
 *   1. Markdowns  product.metadata — a product WITHOUT options gets
 *                 discountEnabled + discountPrice; a product WITH options gets
 *                 `salePrice` on the matching option (e.g. Tirzepatide → 20mg).
 *                 This is the exact rule the catalog and checkout read
 *                 (lib/storefront/sale.ts), so the slashed price on screen is
 *                 the price the cart charges. A markdown at or above the list
 *                 price is not a sale there, so the script refuses it.
 *   2. Pop-up     branding.config.announcementPopup, scheduled 2026-11-11 only.
 *   3. Banner     branding.config.banner, a marquee bar linking to the catalog.
 *
 * Product prices and the banner have no schedule: they change the moment the
 * script writes. So run --live at (or just before) midnight going into Nov 11,
 * and --end when the sale closes.
 *
 * PRICES BELOW ARE PLACEHOLDERS copied from the Halloween promo — confirm the
 * 11.11 prices with the owner and edit MARKDOWNS before running.
 *
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts          # dry run: shows every match + price change, writes nothing
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts --live   # apply markdowns + banner + scheduled pop-up
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts --end    # put prices, banner and pop-up back from the backup
 *
 * Every write saves a JSON backup (product sale fields + banner + pop-up) in the
 * current folder; --end restores from the OLDEST one, i.e. the pre-sale state.
 * Re-running --live is safe: it re-applies the same prices.
 * The storefront caches catalog + branding: press Save on any store-admin
 * screen (or redeploy) afterwards so shoppers see it immediately.
 */
import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeBanner } from "../src/lib/storefront/banner";
import { normalizeAnnouncementPopup, preparePopupForSave, validatePopup } from "../src/lib/storefront/announcement-popup";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "vrjonina";
const DAY = "2026-11-11";

// ── Placeholders (Halloween prices): confirm the 11.11 prices ───────────────
// `product` matches the product name. `option` matches an option (variation)
// name, or, for a product without options, its own name. `price` in pesos;
// null = not decided yet, skipped with a warning.
type Markdown = { label: string; product: RegExp; option: RegExp | null; price: number | null };
const MARKDOWNS: Markdown[] = [
  { label: "Tirzepatide 20mg", product: /tirzepatide/i, option: /\b20\s*mg\b/i, price: 1080 },
  { label: "Tirzepatide 30mg", product: /tirzepatide/i, option: /\b30\s*mg\b/i, price: 1260 },
  { label: "MMG Semax Selank Blend", product: /semax.*selank|selank.*semax/i, option: null, price: null },
];
const BANNER_TEXT = [
  "11.11 SALE · Selected products marked down today only",
  "Order on our website and receive it ASAP",
];
const POPUP = {
  title: "11.11 Sale is live!",
  message: "Selected products are discounted today only. Order through our website for faster ordering, quick delivery and loyalty rewards.",
};
// ────────────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const MODE = args.has("--end") ? "end" : args.has("--live") ? "live" : "dry";
const BACKUP_PREFIX = "vrjonina-1111-backup-";

type Meta = Record<string, unknown>;
type Variation = Record<string, unknown> & { name?: string; price?: number; salePrice?: number };
type Row = { id: string; name: string; priceCents: number; metadata: Prisma.JsonValue };
type Backup = {
  products: Record<string, { name: string; discountEnabled: unknown; discountPrice: unknown; variations: unknown }>;
  banner: unknown;
  announcementPopup: unknown;
};

const peso = (n: unknown) => `₱${Number(n).toLocaleString("en-PH")}`;

/** Compute the new metadata for one product, or null if no markdown touches it. */
function markdownProduct(row: Row, warnings: string[], hits: Map<string, number>): Meta | null {
  const meta = { ...((row.metadata ?? {}) as Meta) };
  const variations = Array.isArray(meta.variations) ? (meta.variations as Variation[]) : [];
  let changed = false;

  for (const md of MARKDOWNS) {
    if (!md.product.test(row.name)) continue;
    if (md.price === null) {
      warnings.push(`${md.label}: no 11.11 price set yet, "${row.name}" left unchanged`);
      hits.set(md.label, (hits.get(md.label) ?? 0) + 1);
      continue;
    }
    if (variations.length > 0) {
      variations.forEach((v, i) => {
        if (md.option && !md.option.test(String(v.name ?? ""))) return;
        const list = Number(v.price);
        hits.set(md.label, (hits.get(md.label) ?? 0) + 1);
        if (!(md.price! < list)) {
          warnings.push(`${md.label}: ${peso(md.price)} is not below "${row.name} / ${v.name}" list ${peso(list)}, skipped`);
          return;
        }
        console.log(`  ${row.name} / ${v.name}: ${peso(list)} → NOW ${peso(md.price)}${v.salePrice ? ` (was on sale at ${peso(v.salePrice)})` : ""}`);
        variations[i] = { ...v, salePrice: md.price! };
        changed = true;
      });
    } else {
      if (md.option && !md.option.test(row.name)) continue;
      const list = row.priceCents / 100;
      hits.set(md.label, (hits.get(md.label) ?? 0) + 1);
      if (!(md.price < list)) {
        warnings.push(`${md.label}: ${peso(md.price)} is not below "${row.name}" list ${peso(list)}, skipped`);
        continue;
      }
      console.log(`  ${row.name}: ${peso(list)} → NOW ${peso(md.price)}${meta.discountEnabled ? ` (was on sale at ${peso(meta.discountPrice)})` : ""}`);
      meta.discountEnabled = true;
      meta.discountPrice = md.price;
      changed = true;
    }
  }
  if (variations.length > 0) meta.variations = variations;
  return changed ? meta : null;
}

function saleBanner() {
  return normalizeBanner({
    enabled: true,
    mode: "marquee",
    bgColor: "", // "" = the tenant's brand accent
    textColor: "",
    speed: "normal",
    pauseOnHover: true,
    slides: BANNER_TEXT.map((text, i) => ({ id: `sale-1111-${i + 1}`, text, linkType: "page", linkPage: "catalog", linkUrl: "" })),
  });
}

function salePopup() {
  const draft = normalizeAnnouncementPopup({
    enabled: true,
    kind: "promo",
    layout: "stacked",
    title: POPUP.title,
    message: POPUP.message,
    image: null,
    code: "",
    buttonLabel: "Shop the sale",
    action: "page",
    linkPage: "catalog",
    frequency: "once",
    delaySeconds: 2,
    startDate: DAY,
    endDate: DAY,
  });
  const problems = validatePopup(draft);
  if (problems.length) throw new Error(`pop-up invalid: ${problems.map((p) => p.message).join("; ")}`);
  return preparePopupForSave(draft);
}

function oldestBackup(): Backup | null {
  const files = readdirSync(".").filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(".json")).sort();
  return files.length ? (JSON.parse(readFileSync(files[0], "utf8")) as Backup) : null;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`tenant "${SLUG}" not found`);
  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Meta;
  const rows: Row[] = await prisma.product.findMany({
    where: { tenantId: tenant.id, status: { not: "archived" } },
    select: { id: true, name: true, priceCents: true, metadata: true },
    orderBy: { name: "asc" },
  });
  console.log(`MODE ${MODE} · ${rows.length} products in ${SLUG}`);

  if (MODE === "end") {
    const prev = oldestBackup();
    if (!prev) throw new Error("no backup file in this folder: run --end from the folder where --live ran");
    for (const row of rows) {
      const saved = prev.products[row.id];
      if (!saved) continue;
      const meta = { ...((row.metadata ?? {}) as Meta) };
      for (const k of ["discountEnabled", "discountPrice", "variations"] as const) {
        if (saved[k] === undefined || saved[k] === null) delete meta[k];
        else meta[k] = saved[k];
      }
      await prisma.product.update({ where: { id: row.id }, data: { metadata: meta as Prisma.InputJsonValue } });
      console.log(`  restored ${row.name}`);
    }
    await prisma.branding.update({
      where: { tenantId: tenant.id },
      data: { config: { ...config, banner: prev.banner ?? undefined, announcementPopup: prev.announcementPopup ?? undefined } as Prisma.InputJsonValue },
    });
    console.log("restored banner + pop-up. done. Press Save on any store-admin screen (or redeploy) to refresh the cache.");
    return;
  }

  console.log("Markdowns:");
  const warnings: string[] = [];
  const hits = new Map<string, number>();
  const updates: { row: Row; meta: Meta }[] = [];
  for (const row of rows) {
    const meta = markdownProduct(row, warnings, hits);
    if (meta) updates.push({ row, meta });
  }
  for (const md of MARKDOWNS) {
    if (!hits.get(md.label)) warnings.push(`${md.label}: NO matching product/option found, check the name`);
  }
  console.log(`Banner: ON marquee ${JSON.stringify(BANNER_TEXT)}`);
  console.log(`Pop-up: "${POPUP.title}", shows ${DAY} only`);
  if (warnings.length) console.log(`\nWARNINGS:\n  ${warnings.join("\n  ")}`);

  if (MODE === "dry") {
    console.log("\nDry run, nothing written. Re-run with --live to apply.");
    return;
  }

  const backup: Backup = {
    products: Object.fromEntries(
      updates.map(({ row }) => {
        const m = (row.metadata ?? {}) as Meta;
        return [row.id, { name: row.name, discountEnabled: m.discountEnabled ?? null, discountPrice: m.discountPrice ?? null, variations: m.variations ?? null }];
      }),
    ),
    banner: config.banner ?? null,
    announcementPopup: config.announcementPopup ?? null,
  };
  const backupFile = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\nbackup → ${backupFile}`);

  for (const { row, meta } of updates) {
    await prisma.product.update({ where: { id: row.id }, data: { metadata: meta as Prisma.InputJsonValue } });
  }
  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: { ...config, banner: saleBanner(), announcementPopup: salePopup() } as Prisma.InputJsonValue },
  });
  console.log(`done: ${updates.length} products marked down, banner + pop-up saved.`);
  console.log("Press Save on any store-admin screen (or redeploy) so shoppers see it immediately.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
