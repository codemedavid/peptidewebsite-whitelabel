// Slimmetry: enable the Lab Reports (COA) page, link the hero's "View Lab Reports"
// CTA to it, seed her 3 Janoshik reports as link cards, and enable the
// announcement pop-up (pointing at the lab reports). Idempotent.
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db/prisma";
import { preparePopupForSave } from "../src/lib/storefront/announcement-popup";

const TENANT = "slimmetry";
const COA_FEATURE_ID = "cmrp0wffq000nmomh0oy4rukd"; // features.key = storefront.coa
const DIR = "/private/tmp/claude-501/-Users-ynadonaire-peptide-website-whitelabel-v1/6dbf97db-f28d-4a9b-87d5-96ae97291452/scratchpad/slim/export";

type RawCoa = { id: string; product_name: string; batch: string; test_date: string;
  purity_percentage: number; laboratory: string; image_url: string };

async function main() {
  // 1) Grant the COA entitlement (operator override).
  await prisma.tenantFeatureOverride.upsert({
    where: { tenantId_featureId: { tenantId: TENANT, featureId: COA_FEATURE_ID } },
    update: { enabled: true, expiresAt: null },
    create: { tenantId: TENANT, featureId: COA_FEATURE_ID, enabled: true },
  });

  // 2) Build her 3 lab reports as link cards (Janoshik verification URLs, no image).
  const raw: RawCoa[] = JSON.parse(readFileSync(`${DIR}/coa_reports.json`, "utf8"));
  const coaReports = raw.map((r) => ({
    id: r.id,
    name: r.product_name,
    lab: r.laboratory || "Janoshik Analytical",
    date: (r.test_date || "").slice(0, 10),
    purity: r.purity_percentage ? `${r.purity_percentage}%` : "",
    image: "",
    link: r.image_url || "",
  }));

  // 3) Announcement pop-up → Lab Reports.
  const announcementPopup = preparePopupForSave({
    enabled: true, kind: "announcement", layout: "stacked",
    title: "Every batch, lab-verified",
    message: "Independent Janoshik purity reports for our peptides. Check the results before you order.",
    image: null, code: "", buttonLabel: "View Lab Reports",
    action: "page", linkPage: "coa", productId: "", linkUrl: "",
    frequency: "once", delaySeconds: 3, startDate: "", endDate: "",
  });

  const row = await prisma.branding.findFirst({ where: { tenantId: TENANT } });
  const config = {
    ...(row?.config as Record<string, unknown> ?? {}),
    showPageCOA: true,
    heroCta2LinkType: "page", heroCta2LinkPage: "coa",
    coaReports, announcementPopup,
  };
  await prisma.branding.update({ where: { tenantId: TENANT }, data: { config } });
  console.log(`✓ COA entitlement granted, page on, CTA linked, ${coaReports.length} reports, pop-up enabled`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
