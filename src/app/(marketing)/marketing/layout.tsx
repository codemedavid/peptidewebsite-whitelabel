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
    default: "Jonina — Get Your Business Website Ready Fast",
    template: "%s · Jonina",
  },
  description:
    "Jonina builds professional, mobile-ready websites for peptide sellers, beauty businesses, resellers, online shops, and small businesses — branded and ready to take orders.",
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "Jonina — Get Your Business Website Ready Fast",
    description:
      "Professional, mobile-ready websites with WhatsApp checkout, QR payments, and an easy admin dashboard. Launch in days.",
    type: "website",
  },
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700;800&display=swap";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await assertApex();

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
              <a href="/#demos">Demos</a>
              <a href="/#pricing">Pricing</a>
              <a href="/#faq">FAQ</a>
            </nav>
            <Link href="/get-started" className="mk-btn mk-btn-primary">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mk-footer">
        <div className="mk-container">
          <div className="mk-footer-grid">
            <div>
              <Link href="/" className="mk-logo" style={{ fontSize: "1.3rem" }}>
                {SITE.brand}
                <span>{SITE.brandSuffix}</span>
              </Link>
              <p className="mk-muted" style={{ marginTop: 12, maxWidth: 320, fontSize: 14.5 }}>
                Done-for-you websites that look premium and start taking orders fast — built for
                small businesses, resellers, and online shops.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <a href="/#features">Features</a>
              <a href="/#demos">Demo Websites</a>
              <a href="/#pricing">Packages</a>
              <a href="/#faq">FAQ</a>
            </div>
            <div>
              <h4>Get Started</h4>
              <Link href="/get-started">Start your website</Link>
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
            </div>
          </div>
          <div className="mk-footer-bottom">
            <span>
              © {new Date().getFullYear()} {SITE.brand}
              {SITE.brandSuffix}. All rights reserved.
            </span>
            <span>Built with care in the Philippines 🌸</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
