"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type SignInState = { error?: string };

const schema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
  // Where to land after login. Defaults are set per login page via a hidden field.
  redirectTo: z.string().startsWith("/").default("/"),
});

/**
 * Email/password sign-in (Supabase Auth). Sets the session cookies via the
 * server client, then redirects. Used by both the platform admin and tenant
 * dashboard login pages — the page supplies `redirectTo`.
 */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    redirectTo: String(formData.get("redirectTo") ?? "/"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  redirect(parsed.data.redirectTo);
}

/** Clear the session and bounce back to the login page. */
export async function signOutAction(redirectTo: string = "/login"): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(redirectTo);
}
