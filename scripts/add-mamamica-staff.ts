/**
 * Add (or re-grant) a full-access staff account on the Mama Mica Glow store,
 * on ITS OWN Pepweb instance (Mamamica's Supabase, schema "pepweb"). Idempotent:
 * re-running re-grants every module and reactivates the account, but never
 * resets an existing password.
 *
 *   set -a; source MamaMicaGlow/.env.mamamica; set +a
 *   STAFF_EMAIL=someone@example.com STAFF_NAME="Their Name" \
 *     STAFF_PASSWORD_FILE=MamaMicaGlow/.env.mamamica-staff \
 *     npx tsx scripts/add-mamamica-staff.ts
 *
 * A new account's password is written to STAFF_PASSWORD_FILE (never printed).
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password-hash";
import { STAFF_MODULE_KEYS } from "../src/storefront/admin/staff-permissions";

const SLUG = "mamamica";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — see the header of this script.`);
  return v;
}

async function main() {
  const dbUrl = requireEnv("DIRECT_URL");
  if (!new URL(dbUrl).searchParams.get("schema")) throw new Error("Refusing to run: DIRECT_URL has no ?schema= (is this Pepweb's own DB?)");
  const email = requireEnv("STAFF_EMAIL").toLowerCase();
  const fullName = requireEnv("STAFF_NAME");
  const passwordFile = requireEnv("STAFF_PASSWORD_FILE");

  const db = new PrismaClient({ datasourceUrl: dbUrl });
  try {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
    if (tenant.storeAdminEmail?.toLowerCase() === email) throw new Error("That email is the store owner's — the owner already has full access.");

    const existing = await db.storefrontStaff.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
    if (existing) {
      await db.storefrontStaff.update({ where: { id: existing.id }, data: { status: "active", permissions: STAFF_MODULE_KEYS } });
      console.log(`Staff ${email} already existed — reactivated with all ${STAFF_MODULE_KEYS.length} modules.`);
      return;
    }

    const password = randomBytes(12).toString("base64url");
    await db.storefrontStaff.create({
      data: {
        tenantId: tenant.id,
        fullName,
        email,
        username: email.split("@")[0],
        passwordHash: hashPassword(password),
        permissions: STAFF_MODULE_KEYS,
      },
    });
    writeFileSync(passwordFile, `${email}\n${password}\n`, { mode: 0o600 });
    console.log(`Staff ${email} created with all ${STAFF_MODULE_KEYS.length} modules. Password written to ${passwordFile}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
