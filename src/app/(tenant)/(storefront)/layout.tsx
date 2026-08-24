import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getTenantId, getTenantIdOrNull } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { resolveCssVars } from "@/lib/theme/resolve-css-vars";
import { googleFontsUrl } from "@/lib/theme/tokens";
import { ComplianceBanner } from "@/modules/sections/ComplianceBanner";
import { Monogram } from "@/components/Monogram";
import { Gate } from "@/components/Gate";
import { FEATURES } from "@/lib/features/catalog";
import { evaluateVisitorGate } from "@/lib/auth/gate-enforcement";
import { AccessCodeGate } from "@/storefront/components/AccessCodeGate";
import { BrandSplash } from "@/storefront/components/BrandSplash";
import { normalizeBrandSplash } from "@/lib/storefront/brand-splash";
import { brandLoaderDesign, brandLoaderVars } from "@/lib/storefront/brand-loader";
import { GateHeartbeat } from "@/storefront/components/GateHeartbeat";
import "@/storefront/storefront.css";
import "@/storefront/boutique.css";
import "@/storefront/editorial.css";
// Imported last so the splash rules never land in storefront.css's cascade
// (see brand-splash.css header: that file has a recorded override hazard).
import "@/storefront/brand-splash.css";

/** Per-tenant SEO: title, description, favicon all derive from tenant config. */
export async function generateMetadata(): Promise<Metadata> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { title: "Store not found" };

  const { tenant, branding, settings } = await getTenantContext(tenantId);
  const name = settings?.storeName ?? tenant.name;
  const config = (branding?.config ?? {}) as { metaDescription?: string };
  // Tenant-editable link-preview / SEO line (admin → Settings → Storefront copy).
  // Falls back to a generic vertical default when the tenant hasn't set one.
  const description =
    (typeof config.metaDescription === "string" && config.metaDescription.trim()) ||
    `${name} — premium peptides with third-party certificates of analysis.`;

  return {
    title: { default: name, template: `%s · ${name}` },
    description,
    icons: { icon: "/api/favicon" },
    openGraph: { title: name, description, type: "website" },
  };
}

// Google Fonts used by the white-label storefront design (and the tweakable
// font options). React 19 hoists these <link>s into <head>.
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenantId = await getTenantId();
  const { tenant, branding, settings } = await getTenantContext(tenantId);
  const cssVars = resolveCssVars(branding);
  const compliance = (settings?.compliance ?? {}) as { researchUseOnly?: string };
  const name = settings?.storeName ?? tenant.name;

  // ── Visitor access-code gate ────────────────────────────────────────────────
  // One decision (evaluateVisitorGate) drives BOTH the wall here and the
  // heartbeat endpoint /api/gate/session, so the two can't disagree. When the
  // gate is on and this visitor has no valid cookie for this tenant at the
  // current code version, render the access wall server-side INSTEAD of the store
  // — the gated store HTML never reaches an unauthenticated browser. When the
  // visitor IS unlocked, mount the heartbeat: the storefront is a hash-routed SPA
  // that never re-hits the server on its own, so without it a later code rotation
  // wouldn't boot an idle visitor until a hard refresh. The gate state is read
  // fresh (security boundary); skipped in demo and when the entitlement is off.
  const gateDecision = await evaluateVisitorGate(tenantId);
  if (gateDecision.status === "blocked") {
    const colors = (branding?.colors ?? {}) as { primary?: string };
    // The wall also carries the `#admin` sign-in (see AccessCodeGate): the hash
    // is invisible to this server render, so without it the store owner would
    // have to know the VISITOR code before they could reach their own login.
    // Pass the admin login's copy along so that surface stays white-labeled.
    const adminCopy = (branding?.config ?? {}) as {
      adminLoginTitle?: string;
      adminLoginSub?: string;
    };
    return (
      <div style={cssVars} className="min-h-screen">
        <AccessCodeGate
          storeName={name}
          logoUrl={branding?.logoUrl}
          brandColor={colors.primary || "#0f172a"}
          heading={gateDecision.heading}
          adminLoginTitle={adminCopy.adminLoginTitle}
          adminLoginSub={adminCopy.adminLoginSub}
        />
      </div>
    );
  }
  const gateHeartbeat = gateDecision.status === "unlocked" ? <GateHeartbeat /> : null;

  // ── Branded loading screen ─────────────────────────────────────────────────
  // Default ON for every tenant: normalizeBrandSplash fails on, so a store
  // nobody has configured still boots through its own mark and colors instead
  // of a generic skeleton. Operator-only — configured on the platform's
  // per-tenant Branding page, invisible to the store owner. Rendered below the
  // access wall on purpose: a blocked visitor gets the gate, not a loading
  // screen for a store they cannot see yet.
  const splash = normalizeBrandSplash(
    (branding?.config as { brandSplash?: unknown } | null)?.brandSplash,
  );
  // The splash used to end at that first render, and every navigation after it
  // fell back to unbranded chrome. These two carry the same config down to the
  // route-change loader as inherited CSS — the surfaces that render it (a
  // `loading.tsx` wall, a next/dynamic fallback) are handed no props of their
  // own, so the root is the only place the tenant's mark can reach them from.
  const loaderVars = brandLoaderVars(splash, name, branding?.logoUrl);
  const loaderDesign = brandLoaderDesign(splash);

  const fonts = (branding?.fonts ?? {}) as { heading?: string; body?: string };
  // Hero typography lives on the storefront Brand config; load its distinct
  // title/body fonts (if any) alongside the theme fonts.
  const heroConfig = (branding?.config ?? {}) as {
    headingFont?: string;
    bodyFont?: string;
    heroTitleFont?: string;
    heroBodyFont?: string;
    buttonFont?: string;
    priceFont?: string;
    heroFieldStyles?: Record<string, { font?: string }>;
    reviewDescStyle?: { font?: string };
    reviews?: { descStyle?: { font?: string } }[];
  };
  // Per-field hero text styling can each pick a distinct font — load them too,
  // or the storefront would render those fields in a fallback face.
  const fieldFonts = Object.values(heroConfig.heroFieldStyles ?? {}).map((s) => s?.font);
  // Testimonial descriptions carry their own per-review font (plus a tenant-wide
  // default), so load those families too — a configured face that is never
  // requested renders as a silent fallback.
  const reviewFonts = [
    heroConfig.reviewDescStyle?.font,
    ...(heroConfig.reviews ?? []).map((r) => r?.descStyle?.font),
  ];
  const fontsHref = googleFontsUrl(
    fonts.heading ?? "Inter",
    fonts.body ?? "Inter",
    // The storefront home renders the Brand config's fonts (config wins over the
    // structured fonts JSON — see (storefront)/page.tsx layering). If the two
    // ever drift, the configured families must still be loaded or the header /
    // footer brand text and headings silently fall back to Georgia/system-ui.
    heroConfig.headingFont,
    heroConfig.bodyFont,
    heroConfig.heroTitleFont,
    heroConfig.heroBodyFont,
    // Button font lives on the storefront Brand config (not the structured
    // fonts JSON); load it so CTAs render in the chosen face, not a fallback.
    heroConfig.buttonFont,
    // Price font lives on the Brand config; load it so pinned price faces render
    // instead of falling back. Unset tenants inherit the already-loaded body font.
    heroConfig.priceFont,
    ...fieldFonts,
    ...reviewFonts,
  );

  // The home page renders the full white-label storefront app, which brings its
  // own header/footer/navigation. Other storefront routes (e.g. product detail)
  // keep the lightweight shared chrome below.
  const pathname = (await headers()).get("x-pathname") ?? "/";
  const isStorefrontHome = pathname === "/";

  return (
    <div
      style={{ ...cssVars, ...loaderVars }}
      data-splash-design={loaderDesign}
      className="min-h-screen bg-background text-foreground"
    >
      {gateHeartbeat}
      {splash.enabled ? (
        <BrandSplash splash={splash} storeName={name} brandingLogoUrl={branding?.logoUrl} />
      ) : null}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* Preload the font CSS so the network request starts before HTML parsing
          reaches the stylesheet tag; the actual <link rel="stylesheet"> still
          applies the rules (and Google's CSS sets font-display: swap so text
          paints without waiting on the font binaries). */}
      <link rel="preload" as="style" href={fontsHref} />
      <link rel="stylesheet" href={fontsHref} />

      {isStorefrontHome ? (
        children
      ) : (
        <>
          <ComplianceBanner text={compliance.researchUseOnly} />

          <header className="border-b border-border">
            <div className="container flex h-16 items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2 font-heading text-lg font-bold text-brand"
              >
                {branding?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={branding.logoUrl} alt={name} className="h-8 w-auto" />
                ) : (
                  <>
                    <Monogram name={name} />
                    {name}
                  </>
                )}
              </Link>
              <nav className="flex items-center gap-6 text-sm">
                <Gate feature={FEATURES.SITE_PRODUCTS}>
                  <Link href="/products" className="transition-colors hover:text-accent">
                    Catalog
                  </Link>
                </Gate>
                <Gate feature={FEATURES.SITE_BLOG}>
                  <Link href="/blog" className="transition-colors hover:text-accent">
                    Research
                  </Link>
                </Gate>
              </nav>
            </div>
          </header>

          <main>{children}</main>

          <footer className="border-t border-border">
            <div className="container py-10 text-sm text-muted-foreground">
              © {new Date().getFullYear()} {name}. For research use only.
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
