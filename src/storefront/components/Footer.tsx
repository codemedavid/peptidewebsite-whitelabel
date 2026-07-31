import type { Brand } from "../types";
import { logoCurveCss } from "@/lib/storefront/logo-curve";
import {
  normalizeFooterStyle,
  buildFooterQuickLinks,
  type FooterQuickIcon,
} from "@/lib/storefront/footer-style";
import { buildFooterColumns, buildFooterSocials } from "@/lib/storefront/footer-links";

function QuickIcon({ name }: { name: FooterQuickIcon }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "shield")
    return (
      <svg {...props}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  if (name === "phone")
    return (
      <svg {...props}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  // chat
  return (
    <svg {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SocialIcon({ name }: { name: string }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "instagram")
    return (
      <svg {...props}>
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  if (name === "facebook")
    return (
      <svg {...props}>
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    );
  if (name === "twitter")
    return (
      <svg {...props}>
        <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" />
      </svg>
    );
  if (name === "tiktok")
    return (
      <svg {...props}>
        <path d="M15 3v9.5a4.5 4.5 0 1 1-4.5-4.5" />
        <path d="M15 3a5 5 0 0 0 5 5" />
      </svg>
    );
  if (name === "telegram")
    return (
      <svg {...props}>
        <path d="M21.5 3.5 2.5 10.8l5.6 2.1 2.1 5.6z" />
        <path d="M21.5 3.5 8.1 12.9" />
      </svg>
    );
  if (name === "whatsapp" || name === "viber")
    return (
      <svg {...props}>
        <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5.2A8.5 8.5 0 1 1 21 11.5z" />
        <path d="M8.6 8.6c.5 2.9 2.6 5.1 5.5 5.6l1-1.4 2 1v1.6c-3.9.5-8.3-3.4-8.7-8.1z" />
      </svg>
    );
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function Footer({ brand }: { brand: Brand }) {
  // Both collections come from lib/storefront/footer-links, which is the single
  // place that decides what a footer link has to be to render: columns lose the
  // placeholder Legal block and links to toggled-off pages, socials need a real
  // http(s) profile URL. See that module for the full rule set.
  const cols = buildFooterColumns(brand);
  const socials = buildFooterSocials(brand);
  const hasBrandSide = brand.footerShowBrand !== false || socials.length > 0;
  const copyright = (brand.footerCopyright || "© {year} {brand}. All rights reserved.")
    .replaceAll("{year}", String(new Date().getFullYear()))
    .replaceAll("{brand}", brand.name || "");

  // Compact footer (HP Glow, Image #2): a dark single-row footer with logo +
  // tagline, pill quick-links (Lab Reports / FAQ / Viber), and a centered
  // "Made with ♥ …" line. Derived from existing config via buildFooterQuickLinks.
  if (normalizeFooterStyle(brand.footerStyle) === "compact") {
    const quickLinks = buildFooterQuickLinks(brand);
    return (
      <footer className="site-footer site-footer--compact">
        <div className="container site-footer__compact">
          <div className="site-footer__brand-row">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={brand.name} className="site-footer__logo" style={{ borderRadius: logoCurveCss(brand.logoCurve) }} />
            ) : (
              <div className="site-footer__logo site-footer__logo--fallback">
                {brand.name?.[0]?.toUpperCase() || "B"}
              </div>
            )}
            <span className="site-footer__compact-name">
              <strong>{brand.name}</strong>
              {brand.footerShowBlurb !== false && brand.footerBlurb && (
                <span className="site-footer__compact-tagline">{brand.footerBlurb}</span>
              )}
            </span>
          </div>
          {quickLinks.length > 0 && (
            <nav className="site-footer__quicklinks" aria-label="Footer links">
              {quickLinks.map((l) => (
                <a
                  key={l.key}
                  href={l.href}
                  className={`site-footer__pill site-footer__pill--${l.variant}`}
                  {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  <QuickIcon name={l.icon} />
                  {l.label}
                </a>
              ))}
            </nav>
          )}
        </div>
        <div className="container site-footer__made">
          Made with <span className="site-footer__made-heart" aria-hidden="true">♥</span> {copyright}
        </div>
      </footer>
    );
  }

  return (
    <footer className="site-footer">
      <div
        className="container site-footer__inner"
        data-cols={cols.length > 0 ? "1" : "0"}
        data-brand={hasBrandSide ? "1" : "0"}
      >
        {hasBrandSide && (
          <div className="site-footer__brand">
            {brand.footerShowBrand !== false && (
              <div className="site-footer__brand-row">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt={brand.name} className="site-footer__logo" style={{ borderRadius: logoCurveCss(brand.logoCurve) }} />
                ) : (
                  <div className="site-footer__logo site-footer__logo--fallback">
                    {brand.name?.[0]?.toUpperCase() || "B"}
                  </div>
                )}
                <span className="site-footer__brandname font-display">{brand.name}</span>
              </div>
            )}
            {brand.footerShowBrand !== false &&
              brand.footerShowBlurb !== false &&
              brand.footerBlurb && (
                <p className="site-footer__blurb">{brand.footerBlurb}</p>
              )}
            {socials.length > 0 && (
              <div className="site-footer__socials">
                {socials.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    aria-label={s.label}
                    className="site-footer__social"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <SocialIcon name={s.icon} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {cols.length > 0 && (
          <div className="site-footer__cols">
            {cols.map((col, ci) => (
              <div key={ci} className="site-footer__col">
                <div className="eyebrow">{col.title}</div>
                <ul>
                  {(col.links || []).map((l, li) => (
                    <li key={li}>
                      <a href={l.href || "#"}>{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {brand.footerShowLegal !== false && (
        <>
          <hr className="hairline" />
          <div className="container site-footer__legal">
            <span>{copyright}</span>
            {brand.footerDisclaimer && <span>{brand.footerDisclaimer}</span>}
          </div>
        </>
      )}
    </footer>
  );
}
