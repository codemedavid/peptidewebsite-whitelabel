import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getTenantSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Tenant backoffice login (<slug>.<root>/login). */
export default async function TenantLoginPage() {
  // Already a member of this tenant? Go to the dashboard.
  if (await getTenantSession()) redirect("/dashboard");

  return (
    <LoginForm
      redirectTo="/dashboard"
      title="Sign in"
      subtitle="Access your store dashboard."
    />
  );
}
