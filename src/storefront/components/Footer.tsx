import type { Brand } from "../types";
import { isLinkHidden } from "../visibility";

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
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function Footer({ brand }: { brand: Brand }) {
  // Strip links to toggled-off pages, then drop any column left with no links.
  const cols = (brand.footerColumns || [])
    .map((col) => ({
      ...col,
      links: (col.links || []).filter((l) => !isLinkHidden(brand, l.href)),
    }))
    .filter((col) => col.links.length > 0);
  const socials = (brand.footerSocials || []).filter((s) => s.show !== false);
  const hasBrandSide =
    brand.footerShowBrand !== false ||
    (brand.footerShowSocials !== false && socials.length > 0);
  const copyright = (brand.footerCopyright || "© {year} {brand}. All rights reserved.")
    .replaceAll("{year}", String(new Date().getFullYear()))
    .replaceAll("{brand}", brand.name || "");

  return (
    <footer className="site-footer">
      <div
        className="container site-footer__inner"
        data-cols={brand.footerShowColumns !== false && cols.length > 0 ? "1" : "0"}
        data-brand={hasBrandSide ? "1" : "0"}
      >
        {hasBrandSide && (
          <div className="site-footer__brand">
            {brand.footerShowBrand !== false && (
              <div className="site-footer__brand-row">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt={brand.name} className="site-footer__logo" />
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
            {brand.footerShowSocials !== false && socials.length > 0 && (
              <div className="site-footer__socials">
                {socials.map((s) => (
                  <a key={s.label} href={s.href} aria-label={s.label} className="site-footer__social">
                    <SocialIcon name={s.icon} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {brand.footerShowColumns !== false && cols.length > 0 && (
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
