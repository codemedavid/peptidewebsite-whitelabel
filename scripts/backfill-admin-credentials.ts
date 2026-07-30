/**
 * Backfill the storefront `#admin` credential for every existing tenant.
 *
 * Signing in to `<slug>.<root>/#admin` now requires an EMAIL and a PASSWORD,
 * both verified against Tenant.storeAdminEmail / Tenant.storeAdminPasswordHash,
 * and it fails closed: a tenant with neither cannot be signed into at all.
 * Every store predates those columns, so this script must run BEFORE the new
 * login ships — otherwise every store owner is locked out of their own admin.
 *
 * For each tenant it:
 *   1. Hashes the legacy plaintext password in branding.config.adminPassword
 *      into storeAdminPasswordHash (that field also leaked to every storefront
 *      visitor, so it is deleted from the config in the same write).
 *   2. Derives a sign-in email, first match wins:
 *        onboarding submission → branding.config.orderNotifications.email
 *      Both are addresses the client themself supplied, so the owner recognises
 *      the one they end up with.
 *   3. Reports — never guesses — any tenant left without an email or without a
 *      password. Those need the operator to set them in tenant settings.
 *
 * It also flags duplicate staff emails within a tenant, which would make the
 * new @@unique([tenantId, email]) index fail to build on `prisma db push`.
 *
 * Run it BEFORE `prisma db push` too: the duplicate-staff-email check is the
 * one that tells you whether the new unique index can even be created, and it
 * still runs when the new Tenant columns don't exist yet.
 *
 * DRY RUN BY DEFAULT — prints the plan and writes nothing:
 *   npm run backfill:admin-credentials
 *   npm run backfill:admin-credentials -- --apply
 */

import { PrismaClient, Prisma } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password-hash";
import { normalizeLoginEmail } from "../src/lib/auth/login-email";
import { isValidEmail } from "../src/lib/analytics/events";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

type Plan = {
  slug: string;
  email: string | null;
  emailSource: string;
  setsPassword: boolean;
  clearsLegacyPlaintext: boolean;
  blocked: string | null;
};

function configOf(config: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

/** The legacy plaintext password, if this tenant still carries one. */
function legacyPassword(config: Record<string, unknown>): string {
  return typeof config.adminPassword === "string" ? config.adminPassword.trim() : "";
}

/** The order-notification recipient — an address the owner already receives at. */
function notifyEmail(config: Record<string, unknown>): string {
  const slice = config.orderNotifications;
  if (!slice || typeof slice !== "object") return "";
  const email = (slice as Record<string, unknown>).email;
  return typeof email === "string" ? email : "";
}

/** Duplicate staff emails inside one tenant would make @@unique([tenantId, email])
 *  fail to build. Checked separately so it still works before `db:push`. */
async function reportDuplicateStaffEmails() {
  const staff = await prisma.storefrontStaff.findMany({
    select: { tenantId: true, email: true },
  });
  const seen = new Map<string, number>();
  for (const s of staff) {
    const key = `${s.tenantId}::${normalizeLoginEmail(s.email)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    console.log(`\n⚠ ${dupes.length} duplicate staff email(s) — \`prisma db push\` will FAIL`);
    console.log("  until each is made unique within its tenant:\n");
    for (const [key, n] of dupes) console.log(`  • ${key.replace("::", "  ")} ×${n}`);
  } else {
    console.log("\n✓ no duplicate staff emails — the new unique index can be created");
  }
}

async function main() {
  console.log(APPLY ? "\nAPPLYING changes\n" : "\nDRY RUN — nothing will be written\n");

  let tenants;
  try {
    tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        slug: true,
        storeAdminEmail: true,
        storeAdminPasswordHash: true,
        branding: { select: { config: true } },
      },
      orderBy: { slug: "asc" },
    });
  } catch {
    // The credential columns aren't in the database yet. The duplicate check is
    // still worth running — it's the gate on whether db:push can succeed.
    console.log("Tenant.storeAdminEmail / storeAdminPasswordHash are not in the database yet.");
    console.log("Run `npm run db:push` first, then re-run this script to backfill.");
    await reportDuplicateStaffEmails();
    return;
  }

  const plans: Plan[] = [];

  for (const tenant of tenants) {
    const config = configOf(tenant.branding?.config);
    const plaintext = legacyPassword(config);

    // Prefer what the client filled in themselves, then where their order
    // alerts already go. Only ever adopt an address that actually parses.
    const submission = await prisma.onboardingSubmission.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: { email: true },
    });

    const candidates: ReadonlyArray<readonly [string, string]> = [
      ["existing", tenant.storeAdminEmail ?? ""],
      ["onboarding", submission?.email ?? ""],
      ["orderNotifications", notifyEmail(config)],
    ];
    const picked = candidates.find(([, value]) => isValidEmail(normalizeLoginEmail(value)));

    const email = picked ? normalizeLoginEmail(picked[1]) : null;
    const setsPassword = !tenant.storeAdminPasswordHash && plaintext.length > 0;
    const willHavePassword = Boolean(tenant.storeAdminPasswordHash) || setsPassword;

    const blocked = !email
      ? "no email found — set one in admin → tenant settings"
      : !willHavePassword
        ? "no password found — set one in admin → tenant settings"
        : null;

    plans.push({
      slug: tenant.slug,
      email,
      emailSource: picked ? picked[0] : "—",
      setsPassword,
      clearsLegacyPlaintext: plaintext.length > 0,
      blocked,
    });

    if (!APPLY) continue;

    const data: { storeAdminEmail?: string; storeAdminPasswordHash?: string } = {};
    if (email && email !== tenant.storeAdminEmail) data.storeAdminEmail = email;
    if (setsPassword) data.storeAdminPasswordHash = hashPassword(plaintext);
    if (Object.keys(data).length > 0) {
      await prisma.tenant.update({ where: { id: tenant.id }, data });
    }

    // Drop the leaked plaintext even when nothing else changed — it is a secret
    // sitting in a blob that gets serialized into every public page.
    if (plaintext) {
      const { adminPassword: _removed, ...rest } = config;
      await prisma.branding.update({
        where: { tenantId: tenant.id },
        data: { config: rest as Prisma.InputJsonValue },
      });
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  for (const p of plans) {
    const bits = [
      p.email ? `email=${p.email} (${p.emailSource})` : "email=MISSING",
      p.setsPassword ? "password=hashed from legacy" : "password=unchanged",
      p.clearsLegacyPlaintext ? "clears plaintext" : "",
    ].filter(Boolean);
    console.log(`  ${p.blocked ? "✗" : "✓"} ${p.slug.padEnd(24)} ${bits.join("  ")}`);
  }

  const blocked = plans.filter((p) => p.blocked);
  if (blocked.length > 0) {
    console.log(`\n${blocked.length} tenant(s) CANNOT sign in until an operator acts:\n`);
    for (const p of blocked) console.log(`  • ${p.slug} — ${p.blocked}`);
  }

  await reportDuplicateStaffEmails();

  console.log(
    `\n${plans.length} tenant(s) examined, ${plans.length - blocked.length} ready.` +
      (APPLY ? "\n" : "\nRe-run with --apply to write these changes.\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
