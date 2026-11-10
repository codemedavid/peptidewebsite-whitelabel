/**
 * ONE-SHOT promo for `vrjonina`: the 11.11 sale (2026-11-11, Asia/Manila).
 *
 * Everything here is ordinary store-admin data in branding.config, so the owner
 * can see and edit all of it afterwards under Promo Codes, Announcement Banner
 * and Announcement Pop-up:
 *
 *   1. Promo code  (config.promoCodes)        SALE1111, 11% off the cart.
 *   2. Pop-up      (config.announcementPopup) kind "promo" with a copy-the-code
 *                  chip, scheduled 2026-11-11 → 2026-11-11, so it only shows on
 *                  the day (the pop-up checks the shopper's local date).
 *   3. Banner      (config.banner)            a marquee promo bar linking to the
 *                  catalog. The banner has NO schedule, so --apply saves it
 *                  switched off and --live switches it on.
 *
 * Promo codes have an expiry but no start date. The code is created active, so
 * it technically works from the moment --apply runs; that is harmless because
 * nothing advertises it until the pop-up/banner go up on the 11th. Expiry is
 * stored as "2026-11-12" (what the admin date field writes): promoExpired reads
 * that as 00:00 UTC = 08:00 Manila on Nov 12, i.e. the whole of 11.11 plus an
 * overnight grace. Change SALE.expiry for a hard midnight cutoff.
 *
 * PLACEHOLDERS — confirm with the owner before running: code, percent, min
 * spend, usage limit, copy. Edit the SALE block below.
 *
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts            # dry run: prints the plan, writes nothing
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts --apply    # code + scheduled pop-up, banner saved OFF
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts --live     # same, banner ON (run on/just before Nov 11)
 *   npx tsx scripts/configure-vrjonina-1111-sale.ts --end      # code off, pop-up off, previous banner/pop-up restored
 *
 * Idempotent: the code is upserted by its fixed id, so re-running never
 * duplicates it or resets its `used` counter. Each write saves a JSON backup of
 * the touched keys next to the script's cwd. The storefront caches branding:
 * press Save on any store-admin branding screen (or redeploy) to see it live.
 */
import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { normalizePromoCodes } from "../src/lib/storefront/promo";
import { normalizeBanner } from "../src/lib/storefront/banner";
import { normalizeAnnouncementPopup, preparePopupForSave, validatePopup } from "../src/lib/storefront/announcement-popup";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "vrjonina";
const PROMO_ID = "sale-1111-2026"; // fixed id → re-runs update in place

// ── Placeholders: confirm with the owner ────────────────────────────────────
const SALE = {
  code: "SALE1111",
  type: "percent" as const,
  value: 11, // 11% off the cart subtotal
  minPurchase: 0,
  usageLimit: null as number | null, // null = unlimited
  expiry: "2026-11-12", // = 08:00 Manila Nov 12 (see header)
  day: "2026-11-11",
  bannerText: [
    "11.11 SALE TODAY ONLY · 11% OFF everything with code SALE1111",
    "Shop now, the code expires at midnight",
  ],
  popupTitle: "11.11 Sale is live!",
  popupMessage: "Take 11% off your whole order today only. Use the code below at checkout.",
};
// ────────────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const MODE = args.has("--end") ? "end" : args.has("--live") ? "live" : args.has("--apply") ? "apply" : "dry";
const BACKUP_PREFIX = `vrjonina-1111-backup-`;

type Config = Record<string, unknown>;

function summary(c: Config): string {
  const codes = normalizePromoCodes(c.promoCodes);
  const banner = normalizeBanner(c.banner);
  const popup = normalizeAnnouncementPopup(c.announcementPopup);
  return [
    `  promoCodes: ${codes.map((p) => `${p.code}(${p.type === "percent" ? p.value + "%" : p.value}${p.active ? "" : ",off"}${p.expiry ? ",exp " + p.expiry : ""},used ${p.used})`).join(" ") || "(none)"}`,
    `  banner:     ${banner.enabled ? "ON" : "off"} ${banner.mode} ${JSON.stringify(banner.slides.map((s) => s.text))}`,
    `  popup:      ${popup.enabled ? "ON" : "off"} ${popup.kind} "${popup.title}" code=${popup.code || "-"} ${popup.startDate || "…"}→${popup.endDate || "…"}`,
  ].join("\n");
}

function salePromo(existing: Record<string, unknown> | undefined, active: boolean) {
  return {
    id: PROMO_ID,
    code: SALE.code,
    type: SALE.type,
    value: SALE.value,
    minPurchase: SALE.minPurchase,
    usageLimit: SALE.usageLimit,
    used: Number(existing?.used ?? 0) || 0, // never reset redemptions
    expiry: SALE.expiry,
    active,
  };
}

function withSaleCode(c: Config, active: boolean): unknown[] {
  const list = Array.isArray(c.promoCodes) ? (c.promoCodes as Record<string, unknown>[]) : [];
  const existing = list.find((p) => p?.id === PROMO_ID);
  // Guard: another code with the same text would make findPromoCode ambiguous.
  const clash = list.find((p) => p?.id !== PROMO_ID && String(p?.code ?? "").toUpperCase() === SALE.code);
  if (clash) throw new Error(`a different promo already uses code ${SALE.code} (id ${String(clash.id)}); pick another code`);
  const next = salePromo(existing, active);
  return existing ? list.map((p) => (p?.id === PROMO_ID ? next : p)) : [...list, next];
}

function saleBanner(enabled: boolean) {
  return normalizeBanner({
    enabled,
    mode: "marquee",
    bgColor: "", // "" = the tenant's brand accent
    textColor: "",
    speed: "normal",
    pauseOnHover: true,
    slides: SALE.bannerText.map((text, i) => ({
      id: `sale-1111-${i + 1}`,
      text,
      linkType: "page",
      linkPage: "catalog",
      linkUrl: "",
    })),
  });
}

function salePopup() {
  const draft = normalizeAnnouncementPopup({
    enabled: true,
    kind: "promo",
    layout: "stacked",
    title: SALE.popupTitle,
    message: SALE.popupMessage,
    image: null,
    code: SALE.code,
    buttonLabel: "Shop the sale",
    action: "page",
    linkPage: "catalog",
    frequency: "once",
    delaySeconds: 2,
    startDate: SALE.day,
    endDate: SALE.day,
  });
  const problems = validatePopup(draft);
  if (problems.length) throw new Error(`pop-up invalid: ${problems.map((p) => p.message).join("; ")}`);
  return preparePopupForSave(draft);
}

function latestBackup(): Config | null {
  const files = readdirSync(".").filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(".json")).sort();
  // The oldest backup holds what the store had BEFORE the sale was first applied.
  return files.length ? (JSON.parse(readFileSync(files[0], "utf8")) as Config) : null;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`tenant "${SLUG}" not found`);
  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Config;

  console.log(`MODE ${MODE}\nBEFORE ${SLUG}:\n${summary(config)}`);

  let next: Config;
  if (MODE === "end") {
    const prev = latestBackup();
    next = {
      ...config,
      promoCodes: withSaleCode(config, false),
      banner: prev && "banner" in prev ? prev.banner : { ...normalizeBanner(config.banner), enabled: false },
      announcementPopup:
        prev && prev.announcementPopup
          ? prev.announcementPopup
          : { ...normalizeAnnouncementPopup(config.announcementPopup), enabled: false },
    };
    if (!prev) console.log("(no backup file found here: banner and pop-up are switched off instead of restored)");
  } else {
    next = {
      ...config,
      promoCodes: withSaleCode(config, true),
      banner: saleBanner(MODE === "live"),
      announcementPopup: salePopup(),
    };
  }

  console.log(`AFTER (${MODE === "dry" ? "planned" : "writing"}):\n${summary(next)}`);
  if (MODE === "dry") {
    console.log("\nDry run, nothing written. Re-run with --apply, --live or --end.");
    return;
  }

  const backupFile = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    backupFile,
    JSON.stringify(
      { promoCodes: config.promoCodes ?? null, banner: config.banner ?? null, announcementPopup: config.announcementPopup ?? null },
      null,
      2,
    ),
  );
  console.log(`backup of the previous promoCodes/banner/pop-up → ${backupFile}`);

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: next as Prisma.InputJsonValue },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  console.log(`SAVED ${SLUG}:\n${summary((after?.config ?? {}) as Config)}`);
  console.log("done. The storefront caches branding: press Save on any store-admin branding screen (or redeploy) to see it live.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
