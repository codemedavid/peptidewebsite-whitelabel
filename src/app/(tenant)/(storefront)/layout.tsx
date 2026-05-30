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
import "@/storefront/storefront.css";

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

  const fonts = (branding?.fonts ?? {}) as { heading?: string; body?: string };
  // Hero typography lives on the storefront Brand config; load its distinct
  // title/body fonts (if any) alongside the theme fonts.
  const heroConfig = (branding?.config ?? {}) as {
    heroTitleFont?: string;
    heroBodyFont?: string;
    heroFieldStyles?: Record<string, { font?: string }>;
  };
  // Per-field hero text styling can each pick a distinct font — load them too,
  // or the storefront would render those fields in a fallback face.
  const fieldFonts = Object.values(heroConfig.heroFieldStyles ?? {}).map((s) => s?.font);
  const fontsHref = googleFontsUrl(
    fonts.heading ?? "Inter",
    fonts.body ?? "Inter",
    heroConfig.heroTitleFont,
    heroConfig.heroBodyFont,
    ...fieldFonts,
  );

  // The home page renders the full white-label storefront app, which brings its
  // own header/footer/navigation. Other storefront routes (e.g. product detail)
  // keep the lightweight shared chrome below.
  const pathname = (await headers()).get("x-pathname") ?? "/";
  const isStorefrontHome = pathname === "/";

  return (
    <div style={cssVars} className="min-h-screen bg-background text-foreground">
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
