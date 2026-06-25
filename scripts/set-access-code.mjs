// Provisioning helper for the per-tenant visitor access-code gate.
//
//   node scripts/set-access-code.mjs <slug> <code> [--enable]
//
// Hashes <code> (scrypt, same format as Tenant.adminPasswordHash), writes it to
// the tenant's accessCodeHash, and bumps accessCodeVersion (which signs out every
// current visitor). Pass --enable to also turn the gate ON in branding.config.
//
// Note: the store owner can also do all of this from the storefront admin →
// "Access Code" panel; this script is for ops / seeding.

import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  const args = process.argv.slice(2);
  const enable = args.includes("--enable");
  const [slug, code] = args.filter((a) => !a.startsWith("--"));

  if (!slug || !code) {
    console.error("Usage: node scripts/set-access-code.mjs <slug> <code> [--enable]");
    process.exit(1);
  }
  if (code.length < 6) {
    console.error("Access code must be at least 6 characters.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) {
      console.error(`No tenant with slug "${slug}".`);
      process.exit(1);
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { accessCodeHash: hashPassword(code), accessCodeVersion: { increment: 1 } },
      select: { accessCodeVersion: true },
    });

    if (enable) {
      const branding = await prisma.branding.findUnique({
        where: { tenantId: tenant.id },
        select: { config: true },
      });
      const config = { ...(branding?.config ?? {}), accessGate: { enabled: true, heading: "Enter access code" } };
      await prisma.branding.upsert({
        where: { tenantId: tenant.id },
        update: { config },
        create: { tenantId: tenant.id, config },
      });
    }

    console.log(
      `✅ Access code set for "${slug}" (version ${updated.accessCodeVersion}). Gate is ${enable ? "ON" : "unchanged"}.`,
    );
    console.log("   All previously-unlocked visitors have been signed out.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
