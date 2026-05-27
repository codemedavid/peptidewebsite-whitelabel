/**
 * Sets (resets) the password for the platform owner's Supabase auth user and
 * confirms their email, so they can sign in to the admin immediately.
 *
 * Run: npx tsx scripts/reset-owner-password.ts
 * Needs: NEXT_PUBLIC_SUPABASE_URL, a REAL SUPABASE_SERVICE_ROLE_KEY,
 *        OWNER_USER_ID, and OWNER_PASSWORD in your environment / .env.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.OWNER_USER_ID;
  const password = process.env.OWNER_PASSWORD;

  if (!url) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL.");
  if (!serviceKey || serviceKey.startsWith("placeholder")) {
    throw new Error("Set a real SUPABASE_SERVICE_ROLE_KEY (not the placeholder).");
  }
  if (!userId) throw new Error("Set OWNER_USER_ID (the Supabase auth user UUID).");
  if (!password) throw new Error("Set OWNER_PASSWORD (the new password).");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Password reset + email confirmed for: ${data.user?.email} (${userId})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
