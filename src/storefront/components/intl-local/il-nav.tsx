"use client";

// The navigation layer every Intl & Local link goes through. One provider owns
// (a) the resolver context — which pages are on, the store's contact channel,
// which info pages have text — and (b) the one `go` that performs a resolved
// target, so a menu item, a card CTA and a footer link can never disagree
// about what "Shop" or "Contact" means. It also owns the info-page dialog.
//
// Links that resolve to null are simply not rendered (see lib/storefront/
// intl-local/links.ts): no dead buttons.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Brand, Category } from "../../types";
import { isPageVisible } from "../../visibility";
import { channelUrl } from "../../checkout";
import {
  resolveIlLink,
  targetHref,
  type IlLink,
  type IlLinkContext,
  type IlTarget,
} from "@/lib/storefront/intl-local/links";
import type { IlButton, IlInfoPage } from "@/lib/storefront/intl-local/config";

export type IlNavApi = {
  resolve: (link: IlLink) => IlTarget | null;
  go: (target: IlTarget) => void;
};

const IlNavContext = createContext<IlNavApi | null>(null);

/** The first enabled contact channel with a destination, as a URL. */
function firstContactUrl(brand: Brand): string {
  const ch = (brand.contactChannels ?? []).find((c) => c.enabled && c.destination.trim());
  return ch ? channelUrl(ch, "") : "";
}

export function buildIlLinkContext(brand: Brand, categories: Category[], infoPages: IlInfoPage[]): IlLinkContext {
  return {
    isPageVisible: (route) => isPageVisible(brand, route),
    contactUrl: firstContactUrl(brand),
    infoIds: new Set(infoPages.filter((p) => p.body.trim()).map((p) => p.id)),
    categoryIds: new Set(categories.map((c) => c.id)),
    dualMarket: brand.dualMarket === true,
  };
}

export type IlNavHandlers = {
  onRoute: (route: string) => void;
  onHome: () => void;
  onCatalog: (category: string) => void;
  /** True while the home is the current screen (sections are on the page). */
  onHomeScreen: boolean;
};

export function IlNavProvider({
  brand,
  categories,
  infoPages,
  handlers,
  children,
}: {
  brand: Brand;
  categories: Category[];
  infoPages: IlInfoPage[];
  /** Omitted in the admin preview: links resolve (so the preview hides what the
   *  live site hides) but clicking does nothing. */
  handlers?: IlNavHandlers;
  children: ReactNode;
}) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const ctx = useMemo(() => buildIlLinkContext(brand, categories, infoPages), [brand, categories, infoPages]);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const go = useCallback((t: IlTarget) => {
    const h = handlersRef.current;
    if (!h) return;
    switch (t.kind) {
      case "home":
        return h.onHome();
      case "route":
        return h.onRoute(t.route);
      case "catalog":
        return h.onCatalog(t.category);
      case "external":
        // mailto:/tel: must stay in the tab; web links open a new one.
        if (/^(mailto|tel):/i.test(t.url)) window.location.href = t.url;
        else window.open(t.url, "_blank", "noopener,noreferrer");
        return;
      case "info":
        return setOpenInfo(t.id);
      case "section": {
        const scroll = () =>
          document.getElementById(`il-${t.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (h.onHomeScreen) return scroll();
        h.onHome();
        window.setTimeout(scroll, 80);
        return;
      }
    }
  }, []);

  const api = useMemo<IlNavApi>(() => ({ resolve: (l) => resolveIlLink(l, ctx), go }), [ctx, go]);
  const page = openInfo ? infoPages.find((p) => p.id === openInfo) : undefined;

  return (
    <IlNavContext.Provider value={api}>
      {children}
      {page && <IlInfoDialog page={page} onClose={() => setOpenInfo(null)} />}
    </IlNavContext.Provider>
  );
}

export function useIlNav(): IlNavApi {
  const api = useContext(IlNavContext);
  if (!api) throw new Error("useIlNav() outside <IlNavProvider>");
  return api;
}

/** An anchor for an IlLink, or nothing at all when the link has no target. */
export function IlLinkAnchor({
  link,
  className,
  children,
  onNavigate,
  role,
}: {
  link: IlLink;
  className?: string;
  children: ReactNode;
  /** Called after navigating (closes a menu). */
  onNavigate?: () => void;
  role?: string;
}) {
  const { resolve, go } = useIlNav();
  const target = resolve(link);
  if (!target) return null;
  const external = target.kind === "external" && !/^(mailto|tel):/i.test(target.url);
  return (
    <a
      className={className}
      href={targetHref(target)}
      role={role}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={(e) => {
        // Let modified clicks (new tab) behave natively for real URLs.
        if (external && (e.metaKey || e.ctrlKey || e.shiftKey)) return;
        e.preventDefault();
        go(target);
        onNavigate?.();
      }}
    >
      {children}
    </a>
  );
}

/** True when a configured button would actually render. */
export function useButtonVisible(btn: IlButton): boolean {
  const { resolve } = useIlNav();
  return btn.show && !!btn.label.trim() && !!resolve(btn.link);
}

export function IlButtonLink({ btn, className = "" }: { btn: IlButton; className?: string }) {
  const visible = useButtonVisible(btn);
  if (!visible) return null;
  const style: Record<string, string> = {};
  if (btn.color) style["--ilb-bg"] = btn.color;
  if (btn.textColor) style["--ilb-fg"] = btn.textColor;
  return (
    <span className="il-btn-wrap" style={style}>
      <IlLinkAnchor link={btn.link} className={`il-btn il-btn--${btn.style} ${className}`.trim()}>
        {btn.label}
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </IlLinkAnchor>
    </span>
  );
}

function IlInfoDialog({ page, onClose }: { page: IlInfoPage; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="il-info"
      aria-labelledby="il-info-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="il-info__panel">
        <header className="il-info__head">
          <h2 id="il-info-title">{page.title}</h2>
          <button type="button" className="il-info__close" aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </header>
        <div className="il-info__body">
          {page.body.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </div>
    </dialog>
  );
}
