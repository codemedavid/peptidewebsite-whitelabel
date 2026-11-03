"use client";

// Store admin → Website Layout: the editor for the Intl & Local template.
//
// A two-column workspace like the Hero editor: the form (six tabs — General,
// Header & menu, Hero, Markets, Sections, Footer) on the left, a live preview
// of the unsaved draft on the right. Nothing reaches the live site until Save;
// Save runs the draft through the same normalizer the server applies, and the
// result is mirrored into the open storefront via setTweak (a reload would end
// the admin session). "Use this layout" switches the store's home onto the
// template — and switching off puts back the layout the store had before.

import { useMemo, useState } from "react";
import type { Brand } from "../../types";
import { useStore } from "../../store";
import {
  listNewsletterSubscribersAction,
  saveIntlLocalAction,
  saveIntlMarketAction,
  unsubscribeNewsletterAction,
  type SaveIntlLocalResult,
} from "@/actions/intl-local";
import { DEFAULT_INTL_LOCAL, type IntlLocalConfig } from "@/lib/storefront/intl-local/config";
import { normalizeIntlLocalConfig } from "@/lib/storefront/intl-local/normalize";
import { isIntlLocalLayout } from "@/lib/storefront/home-layout";
import { normalizeIntlMarket } from "@/lib/storefront/intl-market";
import type { PanelProps } from "./panels-site";
import { SitePreview } from "./SitePreview";
import { SiteBuilderEnvProvider, type SiteBuilderEnv } from "./env";
import { IntlLocalStudio, type StudioTab } from "./studio";
import "./site-builder.css";

export type SaveLayout = (input: { config: IntlLocalConfig; activate?: boolean }) => Promise<SaveIntlLocalResult>;

export function AdminSiteBuilder({
  brand,
  onBack,
  saveLayout = saveIntlLocalAction,
  notice,
}: {
  brand: Brand;
  onBack: () => void;
  /** Where Save goes. Defaults to the store's branding config; the dev-only
   *  sample page passes a browser-only store instead. */
  saveLayout?: SaveLayout;
  /** An optional line above the editor (the sample page explains itself). */
  notice?: string;
}) {
  const { setTweak, toast, categories } = useStore();
  const initial = useMemo(() => normalizeIntlLocalConfig(brand.intlLocal ?? DEFAULT_INTL_LOCAL), [brand.intlLocal]);
  const [draft, setDraft] = useState<IntlLocalConfig>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [tab, setTab] = useState<StudioTab>("general");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "reset" | null>(null);
  const active = isIntlLocalLayout(brand.homeLayout);
  const dirty = JSON.stringify(draft) !== baseline;

  const update: PanelProps["update"] = (fn) => setDraft((cur) => fn(cur));

  // The store admin's plumbing for the shared studio (see ./env): the owner's
  // categories, store-admin actions, and the International switch that saves
  // the moment it's flipped.
  const siteEnv = useMemo<SiteBuilderEnv>(
    () => ({
      toast,
      categories,
      intl: {
        enabled: normalizeIntlMarket(brand.intlMarket).enabled,
        savesImmediately: true,
        setEnabled: async (enabled) => {
          const res = await saveIntlMarketAction({ enabled });
          if ("error" in res) return res;
          // dualMarket also needs the layout to be live — mirror the server rule.
          setTweak({ intlMarket: res.intlMarket, dualMarket: enabled && brand.homeLayout === "intl-local" });
          return { ok: true };
        },
      },
      subscribers: { list: listNewsletterSubscribersAction, unsubscribe: unsubscribeNewsletterAction },
    }),
    [toast, categories, brand.intlMarket, brand.homeLayout, setTweak],
  );

  const save = async (activate?: boolean) => {
    setSaving(true);
    try {
      const clean = normalizeIntlLocalConfig(draft);
      const res = await saveLayout({ config: clean, activate });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setDraft(clean);
      setBaseline(JSON.stringify(clean));
      setTweak({ intlLocal: clean, homeLayout: res.homeLayout as Brand["homeLayout"] });
      toast(activate === true ? "Your store now uses this layout" : activate === false ? "Switched back to your previous layout" : "Saved");
    } catch {
      toast("Couldn't save — please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SiteBuilderEnvProvider env={siteEnv}>
    <div className="admin hero-editor sb">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={() => (dirty ? setConfirm("leave") : onBack())} aria-label="Back to dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="admin-form__title">
          Website Layout
          <span className={`sb-status${active ? " is-on" : ""}`}>{active ? "Live on your store" : "Not in use"}</span>
          {dirty && <span className="hero-editor__pill">Unsaved changes</span>}
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      {confirm && (
        <div className="sb-confirm" role="alertdialog" aria-live="assertive">
          <p>
            {confirm === "leave"
              ? "You have unsaved changes. Leave without saving?"
              : "Replace everything with the template's default text, colours and menus? Nothing changes on your site until you save."}
          </p>
          <div>
            <button type="button" className="sb-chip" onClick={() => setConfirm(null)}>
              Keep editing
            </button>
            <button
              type="button"
              className="sb-chip sb-chip--danger"
              onClick={() => {
                if (confirm === "leave") return onBack();
                setDraft(normalizeIntlLocalConfig(DEFAULT_INTL_LOCAL));
                setConfirm(null);
              }}
            >
              {confirm === "leave" ? "Discard changes" : "Restore defaults"}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="sb-callout sb-notice" role="note">
          {notice}
        </p>
      )}

      <div className="hero-editor__body sb-body">
        <div className="sb-form">
          <section className="hero-editor__card sb-intro">
            <h2 className="admin-form__section">Intl &amp; Local layout</h2>
            <p className="admin-field__hint">
              A storefront with a mega-menu, local and international market cards, learn cards, and community and newsletter bands.
              Every word, link, image and colour below is yours to change. Your products, cart and checkout stay exactly as they are.
            </p>
            <div className="sb-intro__actions">
              {active ? (
                <button type="button" className="sb-chip" disabled={saving} onClick={() => void save(false)}>
                  Stop using this layout
                </button>
              ) : (
                <button type="button" className="admin-form__save" disabled={saving} onClick={() => void save(true)}>
                  {dirty ? "Save & use this layout" : "Use this layout on my store"}
                </button>
              )}
              <button type="button" className="sb-chip" onClick={() => setConfirm("reset")}>
                Restore defaults
              </button>
            </div>
          </section>

          <IntlLocalStudio brand={brand} value={draft} onChange={update} tab={tab} onTab={setTab} />
        </div>

        <aside className="hero-editor__preview-col sb-preview-col">
          <SitePreview brand={brand} categories={categories} config={draft} />
        </aside>
      </div>
    </div>
    </SiteBuilderEnvProvider>
  );
}
