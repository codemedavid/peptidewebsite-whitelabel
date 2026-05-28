import { redirect } from "next/navigation";

/** Legacy entry point — tenants now sign in at /admin with a single password. */
export default function LegacyLoginRedirect() {
  redirect("/admin");
}
