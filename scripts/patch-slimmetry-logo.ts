import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db/prisma";
import { uploadTenantMedia } from "../src/lib/imagekit/server";
const TENANT = "slimmetry";
const LOGO = "/private/tmp/claude-501/-Users-ynadonaire-peptide-website-whitelabel-v1/6dbf97db-f28d-4a9b-87d5-96ae97291452/scratchpad/slim/logo/logo.jpg";
async function main() {
  const row = await prisma.branding.findFirst({ where: { tenantId: TENANT } });
  const cfg = (row?.config as Record<string, unknown>) ?? {};
  // Reuse the already-uploaded logo if present; only re-upload if missing.
  let url = typeof cfg.logoUrl === "string" && cfg.logoUrl.includes("ik.imagekit.io") ? cfg.logoUrl : "";
  if (!url) {
    const up = await uploadTenantMedia({ tenantId: TENANT, file: readFileSync(LOGO), fileName: "slimmetry-logo.jpg", tags: ["branding"] });
    url = up.url;
  }
  const config = { ...cfg, logoUrl: url, headerShowLogo: true, headerShowBrand: false };
  await prisma.branding.update({ where: { tenantId: TENANT }, data: { config, logoUrl: url } });
  console.log("✓ logo set + brand-name text hidden:", url);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
