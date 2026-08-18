"use client";

// The EDITORIAL layout's chrome: a persistent left rail instead of a top header.
//
// It replaces <Header> for this layout only, and carries exactly what the header
// carried — the tenant's mark, their nav, cart, and (on this layout) search —
// arranged as a column. Below the rail's breakpoint it collapses to a compact
// top bar plus an off-canvas drawer, because a fixed 268px column on a phone is
// most of the screen.
//
// White-label: every string here is the tenant's own (brand.name, brand.nav) or
// a generic UI word. The nav itself comes from buildStorefrontNav, shared with
// <Header>, so the two surfaces cannot drift.

import { useEffect, useState } from "react";
import type { Brand } from "../types";
import { buildStorefrontNav } from "@/lib/storefront/nav";
import { logoCurveCss } from "@/lib/storefront/logo-curve";

export function EditorialRail({
  brand,
  cartCount,
  onCartClick,
  onHome,
  query,
  onQuery,
}: {
  brand: Brand;
  cartCount: number;
  onCartClick?: () => void;
  onHome: () => void;
  /** Catalog search, owned by the app so the rail and the grid share one term. */
  query: string;
  onQuery: (q: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const nav = buildStorefrontNav(brand);

  // Lock background scroll + close on Escape while the drawer is open. Same
  // contract as the header drawer: a panel that can only be dismissed by
  // re-tapping its trigger is a keyboard trap.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const mark =
    brand.headerShowLogo !== false &&
    (brand.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt=""
        className="ed-rail__logo"
        style={{ borderRadius: logoCurveCss(brand.logoCurve) }}
      />
    ) : (
      <span className="ed-rail__logo ed-rail__logo--mark font-display" aria-hidden="true">
        {brand.name?.[0]?.toUpperCase() || "B"}
      </span>
    ));

  return (
    <>
      {/* Compact bar — shown only below the rail's breakpoint (CSS decides, so
          there is no resize listener and no hydration mismatch). */}
      <div className="ed-topbar">
        <button
          type="button"
          className="ed-topbar__burger"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>

        <button type="button" className="ed-topbar__brand" onClick={onHome}>
          {mark}
          {brand.headerShowBrand !== false && (
            <span className="ed-topbar__name font-display">{brand.name}</span>
          )}
        </button>

        {brand.headerShowCart !== false && (
          <button type="button" className="ed-topbar__cart" onClick={onCartClick}>
            Cart
            <span className="ed-rail__badge">{cartCount}</span>
          </button>
        )}
      </div>

      {open && (
        <button
          type="button"
          className="ed-rail__scrim"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}

      <aside className={`ed-rail ${open ? "is-open" : ""}`} aria-label="Store navigation">
        <button type="button" className="ed-rail__mast" onClick={onHome}>
          {mark}
          {brand.headerShowBrand !== false && (
            <span className="ed-rail__name font-display">{brand.name}</span>
          )}
        </button>

        <nav className="ed-rail__nav" aria-label="Primary">
          {nav.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="ed-rail__link"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ed-rail__utils">
          <label className="ed-rail__search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search products"
            />
          </label>

          {brand.headerShowCart !== false && (
            <button type="button" className="ed-rail__util" onClick={onCartClick}>
              <span>Cart</span>
              <span className="ed-rail__badge">{cartCount}</span>
            </button>
          )}
        </div>

        {/* The rail's foot repeats the store's own name — the one piece of
            standing identity a sidebar layout can carry without inventing copy. */}
        <p className="ed-rail__foot">{brand.name}</p>
      </aside>
    </>
  );
}
