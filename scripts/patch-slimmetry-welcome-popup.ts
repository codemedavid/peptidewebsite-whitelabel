import { prisma } from "../src/lib/db/prisma";
import { preparePopupForSave } from "../src/lib/storefront/announcement-popup";
const TENANT = "slimmetry";
async function main() {
  const row = await prisma.branding.findFirst({ where: { tenantId: TENANT } });
  const cfg = (row?.config as Record<string, unknown>) ?? {};
  const logoUrl = typeof cfg.logoUrl === "string" ? cfg.logoUrl : "";
  const announcementPopup = preparePopupForSave({
    enabled: true, kind: "announcement", layout: "stacked",
    title: "Welcome to Slimmetry",
    message: "Your partner in the journey to confidence. Browse our carefully curated, lab-verified peptides.",
    image: logoUrl ? { url: logoUrl, aspect: 1024 / 308 } : null,
    code: "", buttonLabel: "Start shopping",
    action: "page", linkPage: "catalog", productId: "", linkUrl: "",
    frequency: "every_visit", delaySeconds: 0, startDate: "", endDate: "",
  });
  await prisma.branding.update({ where: { tenantId: TENANT }, data: { config: { ...cfg, announcementPopup } } });
  console.log("✓ welcome pop-up set (logo + every visit, no delay)");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
