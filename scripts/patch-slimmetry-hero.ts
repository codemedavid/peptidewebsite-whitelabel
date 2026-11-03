import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
const TENANT = "slimmetry";
async function main() {
  const row = await prisma.branding.findFirst({ where: { tenantId: TENANT } });
  const cfg = { ...(row?.config as Record<string, unknown> ?? {}) };
  delete cfg.heroHighlight; // let the wellness CSS gradient control the accent
  cfg.heroVariant = "wellness";
  cfg.heroEyebrow = "TRUSTED BY THE SLIMMETRY COMMUNITY";
  await prisma.branding.update({ where: { tenantId: TENANT }, data: { config: cfg as Prisma.InputJsonValue } });
  console.log("✓ heroHighlight removed; wellness + eyebrow set");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
