import { prisma } from "../src/lib/db/prisma";
const TENANT = "slimmetry";
async function main() {
  const row = await prisma.branding.findFirst({ where: { tenantId: TENANT } });
  const cfg = (row?.config as Record<string, unknown>) ?? {};
  const logoUrl = typeof cfg.logoUrl === "string" ? cfg.logoUrl : "";
  if (!logoUrl) throw new Error("no logoUrl set");
  await prisma.branding.update({ where: { tenantId: TENANT }, data: { config: { ...cfg, defaultProductImage: logoUrl } } });
  // report which products have no own image (they get the fallback)
  const prods = await prisma.product.findMany({ where: { tenantId: TENANT }, select: { name: true, images: true } });
  const imageless = prods.filter((p) => !Array.isArray(p.images) || (p.images as unknown[]).length === 0).map((p) => p.name);
  console.log("✓ defaultProductImage = logo. Imageless products now show it:", imageless.length ? imageless.join(", ") : "(none)");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
