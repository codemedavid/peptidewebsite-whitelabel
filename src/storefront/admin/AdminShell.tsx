"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Brand } from "../types";
import { AdminIcon, tintStyle } from "./shared";
import { searchNavItems, visibleNavGroups } from "./admin-nav";
import type { StaffActor } from "./staff-permissions";

/**
 * The store-admin workspace chrome (Tenant Admin Redesign → 1A): a grouped
 * sidebar, a search-first topbar and a content region that hosts whichever view
 * is active. Navigation is DATA-driven (admin-nav.ts) and every entry is already
 * filtered by entitlement + permission there, so this component never decides
 * who may see what — it only renders and routes clicks back to AdminPage.
 */
export function AdminShell({
  brand,
  actor,
  activeView,
  displayName,
  onNavigate,
  onLogout,
  onExitToSite,
  children,
}: {
  brand: Brand;
  actor: StaffActor;
  activeView: string;
  displayName: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  onExitToSite: () => void;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => visibleNavGroups(brand, actor), [brand, actor]);
  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const results = useMemo(() => searchNavItems(allItems, query), [allItems, query]);

  // ⌘K / Ctrl-K focuses the tool search, matching the design's affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Any navigation closes the mobile drawer and clears a pending search.
  const go = (view: string) => {
    setQuery("");
    setDrawerOpen(false);
    onNavigate(view);
  };

  const initials =
    (displayName || brand.name || "A")
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "A";

  return (
    <div className="adm" data-drawer={drawerOpen ? "open" : undefined}>
      <aside className="adm-side" aria-label="Admin navigation">
        <div className="adm-side__brand">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="adm-side__logo" />
          ) : (
            <span className="adm-side__mark">{brand.name?.[0]?.toUpperCase() || "B"}</span>
          )}
          <span className="adm-side__names">
            <span className="adm-side__name">{brand.name}</span>
            <span className="adm-side__kicker">Admin</span>
          </span>
        </div>

        <nav className="adm-side__nav">
          {groups.map((group) => (
            <div key={group.id} className="adm-navgroup">
              <div className="adm-navgroup__label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className="adm-navitem"
                  aria-current={item.view === activeView ? "page" : undefined}
                  data-active={item.view === activeView ? "true" : undefined}
                  onClick={() => go(item.locked ? "upgrade" : item.view)}
                >
                  <span className="adm-navitem__icon" style={tintStyle(item.tint, "fg")}>
                    <AdminIcon name={item.icon} />
                  </span>
                  <span className="adm-navitem__label">{item.label}</span>
                  {item.isNew && <span className="adm-navitem__tag">New</span>}
                  {item.locked && <span className="adm-navitem__lock">BUSINESS</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="adm-side__foot">
          <button type="button" className="adm-side__logout" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-top">
          <button
            type="button"
            className="adm-top__burger"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="adm-search">
            <span className="adm-search__icon" aria-hidden="true">
              <AdminIcon name="help" />
            </span>
            <input
              ref={searchRef}
              className="adm-search__input"
              type="search"
              value={query}
              placeholder="Search tools…"
              aria-label="Search admin tools"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) go(results[0].view);
              }}
            />
            <kbd className="adm-search__kbd">⌘K</kbd>
            {results.length > 0 && (
              <div className="adm-search__results" role="listbox">
                {results.map((r) => (
                  <button
                    key={r.view}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="adm-search__result"
                    onClick={() => go(r.locked ? "upgrade" : r.view)}
                  >
                    <span className="adm-search__result-label">{r.label}</span>
                    <span className="adm-search__result-hint">{r.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="adm-top__spacer" />

          <button type="button" className="adm-top__link" onClick={onExitToSite}>
            View website ↗
          </button>
          <span className="adm-top__rule" aria-hidden="true" />
          <span className="adm-top__who">
            <span className="adm-top__avatar">{initials}</span>
            <span className="adm-top__name">
              {displayName || brand.name}
              {actor.kind === "staff" && <span className="adm-top__role">Staff</span>}
            </span>
          </span>
        </header>

        <main className="adm-content">{children}</main>
      </div>

      {drawerOpen && (
        <button
          type="button"
          className="adm-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
