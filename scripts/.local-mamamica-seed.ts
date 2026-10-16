// LOCAL ONLY: creates the `mamamica` test store in the local PGlite DB (127.0.0.1:5499).
// Refuses to run against any other database.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password-hash";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("@127.0.0.1:5499/")) throw new Error(`Refusing: DATABASE_URL is not the local test DB (${url.split("@")[1]})`);
const prisma = new PrismaClient();

async function main() {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "enterprise" } });
  const community = await prisma.feature.findUniqueOrThrow({ where: { key: "mobile.community" } });
  const ownerPassword = randomBytes(9).toString("base64url");
  const tenant = await prisma.tenant.upsert({
    where: { slug: "mamamica" },
    update: { storeAdminPasswordHash: hashPassword(ownerPassword) },
    create: {
      name: "Mama Mica Glow",
      slug: "mamamica",
      status: "active",
      planId: plan.id,
      storeAdminEmail: "owner@mamamica.test",
      storeAdminPasswordHash: hashPassword(ownerPassword),
      branding: { create: { themeId: "lavender-dream", config: { name: "Mama Mica Glow", currency: "₱" } } },
      settings: { create: { storeName: "Mama Mica Glow" } },
      featureOverrides: { create: [{ featureId: community.id, enabled: true }] },
    },
  });
  const products = [
    { sku: "MM-GLOW-5", slug: "glow-blend", name: "Glow Blend 5mg", priceCents: 250000, stock: 20, description: "Test product for the local Mamamica store." },
    { sku: "MM-BAC-10", slug: "bac-water", name: "Bacteriostatic Water 10ml", priceCents: 35000, stock: 50, description: "Test product for the local Mamamica store." },
    { sku: "MM-KIT-1", slug: "starter-kit", name: "Starter Kit", priceCents: 120000, stock: 10, description: "Test product for the local Mamamica store." },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
      update: {},
      create: { tenantId: tenant.id, status: "active", ...p },
    });
  }
  writeFileSync(process.argv[2], `Local Mamamica store admin (local test DB only)\nemail: owner@mamamica.test\npassword: ${ownerPassword}\n`, { mode: 0o600 });
  console.log(`mamamica store ready (${tenant.id}); ${products.length} products; owner login saved to file`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
