"use client";

// Intl & Local footer + floating contact button. Both are config-driven chrome
// rendered on every route. The footer's links go through the shared resolver
// (an info page with no text, or a contact link with no channel, is left out);
// the contact button steps aside for the cart: hidden while checkout is open,
// raised above the cart button when that is showing.

import type { IlFab, IlFooter } from "@/lib/storefront/intl-local/config";
import { IlLinkAnchor, useIlNav } from "./il-nav";
import { IlIcon, IlSocialIcon } from "./IlIcon";
import { bgProps } from "./il-style";
import type { IlResolvedSocial } from "./IntlLocalHeader";

/** Fill the copyright template's {year} / {brand} tokens. */
export function fillCopyright(template: string, brand: string, year = new Date().getFullYear()): string {
  return template.replace(/\{year\}/g, String(year)).replace(/\{brand\}/g, brand);
}

export function IntlLocalFooter({ footer, storeName, socials }: { footer: IlFooter; storeName: string; socials: IlResolvedSocial[] }) {
  const { resolve } = useIlNav();
  if (!footer.show) return null;
  const brand = footer.brandName || storeName;
  // Drop links with nowhere to go up front, so they leave no empty <li> gap.
  const links = footer.links.filter((l) => l.show && l.label.trim() && resolve(l.link));
  const p = bgProps(footer.background, "il-footer", footer.textColor);
  return (
    <footer className={p.className} style={p.style}>
      <div className="il-wrap il-footer__inner">
        <div className="il-footer__brand">
          {brand && <p className="il-footer__name">{brand}</p>}
          {footer.tagline && <p className="il-footer__tagline">{footer.tagline}</p>}
        </div>
        {links.length > 0 && (
          <nav aria-label="Footer">
            <ul className="il-footer__links">
              {links.map((l) => (
                <li key={l.id}>
                  <IlLinkAnchor link={l.link}>{l.label}</IlLinkAnchor>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {socials.length > 0 && (
          <ul className="il-footer__socials">
            {socials.map((s) => (
              <li key={s.id}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                  <IlSocialIcon name={s.icon} size={20} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {footer.copyright && <p className="il-wrap il-footer__copy">{fillCopyright(footer.copyright, brand)}</p>}
    </footer>
  );
}

export function IntlLocalFab({ fab, isHidden, isRaised }: { fab: IlFab; isHidden: boolean; isRaised: boolean }) {
  const { resolve } = useIlNav();
  if (!fab.show || isHidden || (!fab.showDesktop && !fab.showMobile) || !resolve(fab.link)) return null;
  const style: Record<string, string> = {};
  if (fab.color) style["--il-fab-bg"] = fab.color;
  if (fab.textColor) style["--il-fab-fg"] = fab.textColor;
  const cls = [
    "il-fab",
    `il-fab--${fab.position}`,
    isRaised ? "il-fab--raised" : "",
    fab.showDesktop ? "" : "il-fab--no-desktop",
    fab.showMobile ? "" : "il-fab--no-mobile",
    fab.label ? "" : "il-fab--round",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={style}>
      <IlLinkAnchor link={fab.link} className="il-fab__btn">
        <IlIcon name={fab.icon === "none" ? "chat" : fab.icon} size={20} />
        {fab.label ? <span>{fab.label}</span> : <span className="il-sr">Contact us</span>}
      </IlLinkAnchor>
    </div>
  );
}
