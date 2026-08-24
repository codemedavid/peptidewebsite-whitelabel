"use client";

import { useEffect, useRef, useState } from "react";
import { imageUrl, LOGO_WIDTH } from "@/lib/media/image-url";
import type { Brand } from "../types";
import { buildStorefrontNav } from "@/lib/storefront/nav";
import { logoCurveCss } from "@/lib/storefront/logo-curve";
import type { CategoryTile } from "@/lib/storefront/boutique-home";

/** Category-first discovery in the header — search plus a panel of the tenant's
 *  own categories with live counts (the boutique layout supplies it; every other
 *  layout omits it and the header renders exactly as before). */
export type HeaderDiscovery = {
  tiles: CategoryTile[];
  query: string;
  onQuery: (q: string) => void;
  onCategory: (id: string) => void;
};

export function Header({
  brand,
  cartCount,
  onShopClick,
  onCartClick,
  discovery,
}: {
  brand: Brand;
  cartCount: number;
  onShopClick: () => void;
  onCartClick?: () => void;
  /** Opt-in discovery bar. Absent = the classic header, unchanged. */
  discovery?: HeaderDiscovery;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const catsRef = useRef<HTMLDivElement | null>(null);
  // The owner's stored nav, minus toggled-off pages, plus the auto-surfaced
  // Group Buy / Resellers / Calculator links. Shared with the editorial
  // layout's sidebar rail so the two nav surfaces can never drift.
  const nav = buildStorefrontNav(brand);

  // Close the category panel on Escape or a click outside it — a dropdown that
  // can only be dismissed by re-clicking its trigger is a keyboard trap.
  useEffect(() => {
    if (!catsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCatsOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!catsRef.current?.contains(e.target as Node)) setCatsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [catsOpen]);

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
          {brand.headerShowLogo !== false &&
            (brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(brand.logoUrl, { width: LOGO_WIDTH })}
                alt={brand.name}
                decoding="async"
                style={{ borderRadius: logoCurveCss(brand.logoCurve) }}
              />
            ) : (
              <div className="site-header__logo-mark">
                {brand.name?.[0]?.toUpperCase() || "B"}
              </div>
            ))}
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

    {discovery && (
      <div className="bq-bar">
        <div className="container bq-bar__row">
          <div className="bq-bar__cats" ref={catsRef}>
            <button
              type="button"
              className="bq-bar__cats-btn"
              aria-expanded={catsOpen}
              aria-haspopup="true"
              onClick={() => setCatsOpen((o) => !o)}
              disabled={discovery.tiles.length === 0}
            >
              <span>All categories</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {catsOpen && discovery.tiles.length > 0 && (
              <div className="bq-bar__panel" role="menu">
                {discovery.tiles.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    role="menuitem"
                    className="bq-bar__panel-item"
                    onClick={() => {
                      discovery.onCategory(tile.id);
                      setCatsOpen(false);
                    }}
                  >
                    <span className="bq-bar__panel-label">{tile.label}</span>
                    <span className="bq-bar__panel-count">{tile.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="bq-bar__search" aria-label="Search products">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={discovery.query}
              onChange={(e) => discovery.onQuery(e.target.value)}
              placeholder="Search products…"
            />
          </label>
        </div>
      </div>
    )}

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
