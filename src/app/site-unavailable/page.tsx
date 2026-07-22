import type { Metadata } from "next";

/**
 * Deactivated-tenant landing: where getTenantId() bounces a storefront whose
 * tenant is suspended (lib/tenant/gate.ts). A real store lives here — it's
 * just switched off — so the copy says "not available" rather than the
 * unknown-tenant "not found". Noindexed so a suspended store doesn't get
 * indexed (or have its snippet replaced) as "not available".
 */
export const metadata: Metadata = {
  title: "Website currently not available",
  robots: { index: false, follow: false },
};

export default function SiteUnavailablePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold">Website currently not available</h1>
      <p className="text-muted-foreground">
        This store is temporarily offline. Please check back later.
      </p>
    </main>
  );
}
