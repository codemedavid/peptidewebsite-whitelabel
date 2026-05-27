"use client";

import { useEffect, useState } from "react";
import type { Brand } from "../types";
import { isLinkHidden } from "../visibility";

export function Header({
  brand,
  cartCount,
  onShopClick,
  onCartClick,
}: {
  brand: Brand;
  cartCount: number;
  onShopClick: () => void;
  onCartClick?: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Drop nav links that point at a toggled-off page.
  const nav = (brand.nav || []).filter((item) => !isLinkHidden(brand, item.href));

  // Lock background scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <>
    <header className="site-header">
      <div className="container site-header__row">
        {/* Logo */}
        <a href="#top" className="site-header__logo">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} />
          ) : (
            <div className="site-header__logo-mark">
              {brand.name?.[0]?.toUpperCase() || "B"}
            </div>
          )}
          {brand.headerShowBrand !== false && (
            <span className="site-header__brand">{brand.name}</span>
          )}
        </a>

        {/* Desktop nav */}
        <nav className="site-header__nav" aria-label="Primary">
          {nav.map((item) => (
            <a key={item.label} href={item.href} className="site-header__navlink">
              {item.label}
            </a>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="site-header__actions">
          {brand.headerShowCart !== false && (
            <button className="site-header__cart" aria-label="Cart" onClick={onCartClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
              </svg>
              {cartCount > 0 && (
                <span className="site-header__cart-count">{cartCount}</span>
              )}
            </button>
          )}

          {brand.headerShowCta !== false && (
            <button className="btn btn-primary site-header__cta" onClick={onShopClick}>
              {brand.ctaLabel || "Shop Now"}
            </button>
          )}

          <button
            className={`site-header__burger ${mobileOpen ? "is-open" : ""}`}
            aria-label="Menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((s) => !s)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>

    {/* Mobile drawer — rendered outside <header> so its backdrop-filter
        doesn't trap our position:fixed overlay inside the header band. */}
    <div
      className={`site-header__drawer ${mobileOpen ? "is-open" : ""}`}
      aria-hidden={!mobileOpen}
    >
        <button
          className="site-header__scrim"
          aria-label="Close menu"
          tabIndex={mobileOpen ? 0 : -1}
          onClick={() => setMobileOpen(false)}
        />
        <aside className="site-header__panel" role="dialog" aria-label="Menu" aria-modal="true">
          <div className="site-header__panel-head">
            <span className="site-header__panel-title font-display">{brand.name}</span>
            <button
              className="site-header__panel-close"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="site-header__panel-nav" aria-label="Mobile">
            {nav.map((item) => (
              <a key={item.label} href={item.href} onClick={() => setMobileOpen(false)}>
                {item.label}
              </a>
            ))}
          </nav>
          {brand.headerShowCta !== false && (
            <button
              className="btn btn-primary site-header__panel-cta"
              onClick={() => {
                setMobileOpen(false);
                onShopClick();
              }}
            >
              {brand.ctaLabel || "Shop Now"}
            </button>
          )}
        </aside>
      </div>
    </>
  );
}
