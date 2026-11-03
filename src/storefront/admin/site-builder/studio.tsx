"use client";

// The Intl & Local STUDIO — the editor's tab strip + panels as one controlled
// component, shared by the store admin (AdminSiteBuilder) and the platform
// admin's Branding editor. It owns no draft and no save: the caller holds the
// config and decides where it goes. Plumbing (categories, uploads, the
// International switch, subscribers) comes from SiteBuilderEnv (./env).

import { useMemo } from "react";
import type { Brand } from "../../types";
import type { IntlLocalConfig } from "@/lib/storefront/intl-local/config";
import { buildIlLinkContext } from "../../components/intl-local/il-nav";
import { useSiteBuilderEnv } from "./env";
import { FooterPanel, GeneralPanel, HeaderPanel, type PanelProps } from "./panels-site";
import { HeroPanel, MarketsPanel, SectionsPanel } from "./panels-home";
import "./site-builder.css";

export const STUDIO_TABS = [
  { id: "general", label: "General", Panel: GeneralPanel },
  { id: "header", label: "Header & menu", Panel: HeaderPanel },
  { id: "hero", label: "Hero", Panel: HeroPanel },
  { id: "markets", label: "Markets", Panel: MarketsPanel },
  { id: "sections", label: "Sections", Panel: SectionsPanel },
  { id: "footer", label: "Footer", Panel: FooterPanel },
] as const;

export type StudioTab = (typeof STUDIO_TABS)[number]["id"];

/**
 * Which tab edits a clicked part of the live site — the preview's "click to
 * edit" mode hands over the element's region (il-* section id or chrome).
 */
export function studioTabFor(region: string): StudioTab {
  if (region === "header" || region === "topbar" || region === "nav") return "header";
  if (region === "footer" || region === "fab") return "footer";
  if (region === "il-hero") return "hero";
  if (region === "il-markets") return "markets";
  return region.startsWith("il-") ? "sections" : "general";
}

export function IntlLocalStudio({
  brand,
  value,
  onChange,
  tab,
  onTab,
}: {
  brand: Brand;
  value: IntlLocalConfig;
  /** Receives an updater, like a state setter, so rapid edits never clobber. */
  onChange: PanelProps["update"];
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
}) {
  const { categories } = useSiteBuilderEnv();
  const env = useMemo(
    () => ({ ctx: buildIlLinkContext(brand, categories, value.infoPages), infoPages: value.infoPages }),
    [brand, categories, value.infoPages],
  );
  const current = STUDIO_TABS.find((t) => t.id === tab) ?? STUDIO_TABS[0];
  const Panel = current.Panel;
  return (
    <div className="sb-studio">
      <nav className="sb-tabs" role="tablist" aria-label="Layout areas">
        {STUDIO_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`sb-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="sb-panel"
            className={tab === t.id ? "is-active" : ""}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="sb-panel" id="sb-panel" role="tabpanel" aria-labelledby={`sb-tab-${current.id}`}>
        <Panel cfg={value} update={onChange} env={env} brand={brand} />
      </div>
    </div>
  );
}
