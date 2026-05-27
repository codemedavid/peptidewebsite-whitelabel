/**
 * Seeds the platform owner — a PlatformUser whose id == the Supabase auth user
 * id (authorization lives in our DB; identity lives in Supabase Auth).
 *
 * Run: npm run db:seed:owner   (needs DATABASE_URL + Supabase env)
 *
 * Provide the owner one of two ways:
 *  1. OWNER_EMAIL + OWNER_PASSWORD + SUPABASE_SERVICE_ROLE_KEY
 *     → creates (or finds) the Supabase auth user, then upserts PlatformUser.
 *  2. OWNER_EMAIL + OWNER_USER_ID
 *     → you already created the auth user; we just upsert PlatformUser.
 */
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  // No getUserByEmail in this SDK version — page through the admin list.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

async function resolveOwnerUserId(): Promise<{ id: string; email: string }> {
  const email = process.env.OWNER_EMAIL;
  if (!email) throw new Error("Set OWNER_EMAIL.");

  if (process.env.OWNER_USER_ID) {
    return { id: process.env.OWNER_USER_ID, email };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.OWNER_PASSWORD;
  if (!url || !serviceKey || serviceKey.startsWith("placeholder")) {
    throw new Error(
      "Set OWNER_USER_ID, or provide NEXT_PUBLIC_SUPABASE_URL + a real SUPABASE_SERVICE_ROLE_KEY (and OWNER_PASSWORD) to auto-create the auth user.",
    );
  }
  if (!password) throw new Error("Set OWNER_PASSWORD to create the auth user.");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // owner can log in immediately
  });
  if (!error && data.user) return { id: data.user.id, email };

  // Most likely the user already exists — look it up.
  const existing = await findUserIdByEmail(admin, email);
  if (existing) return { id: existing, email };
  throw error ?? new Error(`Could not create or find Supabase user for ${email}.`);
}

async function main() {
  const { id, email } = await resolveOwnerUserId();
  await prisma.platformUser.upsert({
    where: { id },
    update: { email, role: "super_admin" },
    create: { id, email, role: "super_admin" },
  });
  console.log(`Platform owner seeded: ${email} (${id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
