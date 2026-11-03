"use client";

// Intl & Local CHROME: the utility top bar + the header with its dropdown
// menus (desktop) and slide-in drawer (phones). Replaces the shared <Header>
// for this layout on every route. Every label, link, colour and switch comes
// from config; a menu entry whose link has nowhere to go is not drawn, and a
// dropdown left with no entries collapses into a plain link (or disappears).

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { IlNavChild, IlNavItem, IntlLocalConfig } from "@/lib/storefront/intl-local/config";
import { sectionLink } from "@/lib/storefront/intl-local/links";
import { logoCurveCss } from "@/lib/storefront/logo-curve";
import { imageUrl } from "@/lib/media/image-url";
import { IlLinkAnchor, useIlNav } from "./il-nav";
import { IlIcon, IlSocialIcon } from "./IlIcon";
import { bgProps } from "./il-style";

export type IlResolvedSocial = { id: string; icon: string; href: string; label: string };

type Props = {
  config: IntlLocalConfig;
  storeName: string;
  storeLogoUrl: string;
  logoCurve?: number;
  socials: IlResolvedSocial[];
  cartCount: number;
  onCart: () => void;
  onHome: () => void;
  onSearch: (query: string) => void;
};

/** Entries of a dropdown that will actually render. */
function useVisibleChildren(item: IlNavItem): IlNavChild[] {
  const { resolve } = useIlNav();
  return item.children.filter((c) => c.show && c.label.trim() && resolve(c.link));
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DesktopItem({ item, open, onOpen, onClose }: { item: IlNavItem; open: boolean; onOpen: () => void; onClose: () => void }) {
  const children = useVisibleChildren(item);
  if (!item.show || !item.label.trim()) return null;
  if (children.length === 0) {
    return (
      <li className="il-nav__item">
        <IlLinkAnchor link={item.link} className="il-nav__link">
          {item.label}
        </IlLinkAnchor>
      </li>
    );
  }
  const panelId = `il-menu-${item.id}`;
  return (
    <li
      className={`il-nav__item${open ? " is-open" : ""}`}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
          (e.currentTarget.querySelector("button") as HTMLButtonElement | null)?.focus();
        }
      }}
    >
      <button
        type="button"
        className="il-nav__link il-nav__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? onClose() : onOpen())}
      >
        {item.label}
        <Chevron />
      </button>
      <div id={panelId} className="il-nav__panel" hidden={!open}>
        <p className="il-nav__panel-title">{item.label}</p>
        <ul>
          {children.map((c) => (
            <li key={c.id}>
              <IlLinkAnchor link={c.link} className="il-nav__sublink" onNavigate={onClose}>
                {c.label}
              </IlLinkAnchor>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function DrawerItem({ item, onNavigate }: { item: IlNavItem; onNavigate: () => void }) {
  const children = useVisibleChildren(item);
  const [open, setOpen] = useState(false);
  if (!item.show || !item.label.trim()) return null;
  if (children.length === 0) {
    return (
      <li>
        <IlLinkAnchor link={item.link} className="il-drawer__link" onNavigate={onNavigate}>
          {item.label}
        </IlLinkAnchor>
      </li>
    );
  }
  return (
    <li className={open ? "is-open" : undefined}>
      <button type="button" className="il-drawer__link il-drawer__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {item.label}
        <Chevron />
      </button>
      {open && (
        <ul className="il-drawer__sub">
          {children.map((c) => (
            <li key={c.id}>
              <IlLinkAnchor link={c.link} className="il-drawer__sublink" onNavigate={onNavigate}>
                {c.label}
              </IlLinkAnchor>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function IntlLocalHeader({ config, storeName, storeLogoUrl, logoCurve, socials, cartCount, onCart, onHome, onSearch }: Props) {
  const { topBar, header, nav } = config;
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const brandName = header.brandName || storeName;
  const logo = header.logoUrl || storeLogoUrl;

  // Click anywhere outside the menu bar closes an open dropdown.
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openId]);

  // The drawer is modal on phones: lock the page behind it, close on Escape.
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawer]);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    onSearch(query.trim());
    setSearching(false);
    setDrawer(false);
  };

  const headerStyle: Record<string, string> = { "--il-logo-h": `${header.logoHeight}px` };
  if (header.bgColor) headerStyle["--il-header-bg"] = header.bgColor;
  if (header.textColor) headerStyle["--il-header-ink"] = header.textColor;
  const bar = bgProps(topBar.background, "il-topbar", topBar.textColor);

  return (
    <>
      {topBar.show && (topBar.text || topBar.subscribeLabel || (topBar.showSocials && socials.length > 0)) && (
        <div className={bar.className} style={bar.style}>
          <div className="il-wrap il-topbar__inner">
            {topBar.text && <p className="il-topbar__text">{topBar.text}</p>}
            <div className="il-topbar__end">
              {topBar.subscribeLabel && config.newsletter.show && (
                <IlLinkAnchor link={sectionLink("newsletter")} className="il-topbar__link">
                  <IlIcon name="mail" size={15} />
                  {topBar.subscribeLabel}
                </IlLinkAnchor>
              )}
              {topBar.showSocials &&
                socials.map((s) => (
                  <a key={s.id} className="il-topbar__social" href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                    <IlSocialIcon name={s.icon} size={16} />
                  </a>
                ))}
            </div>
          </div>
        </div>
      )}

      <header className={`il-header${header.sticky ? " is-sticky" : ""}`} style={headerStyle}>
        <div className="il-wrap il-header__inner">
          <button type="button" className="il-header__burger" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <a
            className="il-brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onHome();
            }}
          >
            {header.showLogo && logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="il-brand__logo"
                // Height-led: a wide wordmark keeps its shape instead of being
                // cropped into a square.
                src={imageUrl(logo, { height: header.logoHeight * 2 })}
                alt=""
                height={header.logoHeight}
                style={{ borderRadius: logoCurveCss(logoCurve) }}
              />
            )}
            {brandName && <span className="il-brand__name">{brandName}</span>}
          </a>

          <nav ref={navRef} className="il-nav" aria-label="Main navigation">
            <ul className="il-nav__list">
              {nav.map((item) => (
                <DesktopItem
                  key={item.id}
                  item={item}
                  open={openId === item.id}
                  onOpen={() => setOpenId(item.id)}
                  onClose={() => setOpenId((cur) => (cur === item.id ? null : cur))}
                />
              ))}
            </ul>
          </nav>

          <div className="il-header__tools">
            {header.showSearch && (
              <button type="button" className="il-iconbtn" aria-label="Search products" aria-expanded={searching} onClick={() => setSearching((v) => !v)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>
            )}
            {header.showCart && (
              <button type="button" className="il-iconbtn il-cart" aria-label={`Cart (${cartCount})`} onClick={onCart}>
                <IlIcon name="cart" size={22} />
                {cartCount > 0 && <span className="il-cart__count">{cartCount}</span>}
              </button>
            )}
          </div>
        </div>

        {searching && (
          <form className="il-search il-wrap" role="search" onSubmit={submitSearch}>
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              aria-label="Search products"
            />
            <button type="submit" className="il-btn il-btn--solid">
              Search
            </button>
          </form>
        )}
      </header>

      {drawer && (
        <div className="il-drawer" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="il-drawer__scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <div className="il-drawer__panel">
            <div className="il-drawer__head">
              <span className="il-brand__name">{brandName}</span>
              <button type="button" className="il-iconbtn" aria-label="Close menu" onClick={() => setDrawer(false)}>
                ×
              </button>
            </div>
            {header.showSearch && (
              <form className="il-search il-search--drawer" role="search" onSubmit={submitSearch}>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" />
              </form>
            )}
            <ul className="il-drawer__list">
              {nav.map((item) => (
                <DrawerItem key={item.id} item={item} onNavigate={() => setDrawer(false)} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
