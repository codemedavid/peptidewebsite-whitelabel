import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getPlatformUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Platform-operator login (admin.<root>/login). */
export default async function AdminLoginPage() {
  // Demo admin is open — no login needed; send them straight in.
  if (isDemoMode()) redirect("/");
  // Already signed in as an operator? Skip the form.
  if (await getPlatformUser()) redirect("/");

  return (
    <LoginForm
      redirectTo="/"
      title="Platform Admin"
      subtitle="Sign in to manage tenants."
    />
  );
}
