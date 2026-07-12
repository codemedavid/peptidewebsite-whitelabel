import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SITE } from "@/marketing/config";
import "./marketing.css";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

// Marketing is served from the apex only. Route groups are host-agnostic, so
// `<slug>.<root>/marketing` would otherwise leak the sales site onto every tenant
// storefront — guard it here and 404 anywhere that isn't the apex.
async function assertApex() {
  const host = ((await headers()).get("x-tenant-host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (host && host !== ROOT) notFound();
}

export const metadata: Metadata = {
  title: {
    default: "Jonina — Business Automation, Done-For-You",
    template: "%s · Jonina",
  },
  description:
    "Jonina builds automated, order-ready storefronts for peptide sellers and small PH online businesses — branded, done-for-you, and answering customers 24/7.",
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "Jonina — Business Automation, Done-For-You",
    description:
      "Stop being the customer support of your own business. Automated storefronts with WhatsApp checkout, QR payments, and an easy admin dashboard — live in days.",
    type: "website",
  },
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&display=swap";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await assertApex();

  // The automation funnel (/automation) is a self-contained, white premium-SaaS
  // landing page that ships its own header + footer and Tailwind styling, so it
  // opts out of the `.mk` marketing shell. Apex guard above still applies.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === "/automation") return <>{children}</>;

  return (
    <div className="mk">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="preload" as="style" href={FONTS} />
      <link rel="stylesheet" href={FONTS} />

      <header className="mk-header">
        <div className="mk-container mk-header-inner">
          <Link href="/" className="mk-logo">
            {SITE.brand}
            <span>{SITE.brandSuffix}</span>
          </Link>
          <div className="mk-nav-cta">
            <nav className="mk-nav mk-nav-links" aria-label="Primary">
              <a href="/#features">Features</a>
              <a href="/#pricing">Pricing</a>
              <a href="/#faq">FAQ</a>
            </nav>
            <Link href="/get-started" className="mk-btn mk-btn-dark">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mk-footer">
        <div className="mk-container mk-footer-inner">
          <Link href="/" className="mk-logo">
            {SITE.brand}
            <span>{SITE.brandSuffix}</span>
          </Link>
          <div className="mk-footer-links">
            <a href="/#features">Features</a>
            <a href="/#pricing">Packages</a>
            <a href="/#faq">FAQ</a>
            <Link href="/terms">Terms</Link>
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
          </div>
          <div>
            © {new Date().getFullYear()} {SITE.brand}
            {SITE.brandSuffix} · Built with care in the Philippines
          </div>
        </div>
      </footer>
    </div>
  );
}
