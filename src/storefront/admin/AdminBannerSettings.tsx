"use client";

// Store-admin editor for the announcement banner — the promo bar under the
// header. A two-column workspace: the config form on the left, a live
// customer-eye preview on the right that reuses the REAL <AnnouncementBanner>
// so what the owner previews is exactly what ships. The owner picks a layout
// (single / carousel / marquee), writes one or more messages (each optionally
// linking to a page or a custom URL), and tunes the per-mode options.
//
// Saves through saveBannerAction (read-modify-write into branding.config, with
// the payload sanitized server-side) and mirrors into the live brand via
// setTweak so the open storefront updates without a reload.

import { useRef, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { isPageVisible } from "../visibility";
import { saveBannerAction } from "@/actions/storefront-admin";
import { AnnouncementBanner } from "../components/AnnouncementBanner";
import {
  normalizeBanner,
  BANNER_MODES,
  MAX_BANNER_SLIDES,
  type StorefrontBanner,
  type BannerLinkType,
  type BannerMode,
  type BannerSpeed,
} from "@/lib/storefront/banner";

const CAP_TEXT = 160;
const CAP_URL = 500;

// Same page set the hero CTA picker offers; the editor only surfaces pages the
// tenant currently has switched on (home + catalog are always available).
const PAGE_OPTIONS: { route: string; label: string; alwaysOn?: boolean }[] = [
  { route: "home", label: "Home", alwaysOn: true },
  { route: "catalog", label: "Shop / Catalog", alwaysOn: true },
  { route: "reviews", label: "Reviews" },
  { route: "faq", label: "FAQ" },
  { route: "coa", label: "Lab Results (COA)" },
  { route: "protocols", label: "Protocols" },
  { route: "calculator", label: "Reconstitution Calculator" },
  { route: "track", label: "Track Order" },
  { route: "merchant", label: "Wholesale" },
];

const MODE_LABEL: Record<BannerMode, { title: string; hint: string }> = {
  single: { title: "Single", hint: "One fixed message" },
  carousel: { title: "Carousel", hint: "Messages auto-rotate" },
  marquee: { title: "Live scroll", hint: "Slides sideways" },
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

export function AdminBannerSettings({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const [banner, setBanner] = useState<StorefrontBanner>(() => normalizeBanner(brand.banner));
  const savedRef = useRef<StorefrontBanner>(normalizeBanner(brand.banner));
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter for stable React keys on newly-added slides (ids are
  // re-derived server-side on save).
  const nextId = useRef(0);

  const isDirty = JSON.stringify(banner) !== JSON.stringify(savedRef.current);
  const pageOptions = PAGE_OPTIONS.filter((o) => o.alwaysOn || isPageVisible(brand, o.route));

  const update = (patch: Partial<StorefrontBanner>) => {
    setShowSaved(false);
    setBanner((b) => ({ ...b, ...patch }));
  };
  const updateSlide = (id: string, patch: Partial<StorefrontBanner["slides"][number]>) =>
    update({ slides: banner.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const addSlide = () => {
    if (banner.slides.length >= MAX_BANNER_SLIDES) return;
    update({
      slides: [
        ...banner.slides,
        { id: `new-${nextId.current++}`, text: "", linkType: "none", linkPage: "catalog", linkUrl: "" },
      ],
    });
  };
  const removeSlide = (id: string) => update({ slides: banner.slides.filter((s) => s.id !== id) });
  const moveSlide = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= banner.slides.length) return;
    const slides = [...banner.slides];
    [slides[index], slides[next]] = [slides[next], slides[index]];
    update({ slides });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveBannerAction(banner);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Re-normalize so the dirty baseline matches exactly what the server kept
      // (blank slides dropped, links sanitized, colors filtered).
      const clean = normalizeBanner(banner);
      savedRef.current = clean;
      setBanner(clean);
      setTweak({ banner: clean });
      setShowSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setShowSaved(false), 2200);
      toast("Announcement banner saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  // Force the preview on regardless of the enable switch, so the owner can see
  // the layout while building it (a note flags that it is currently hidden).
  const previewBrand: Brand = { ...brand, banner: { ...banner, enabled: true } };

  return (
    <div className="admin hero-editor">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <BackIcon />
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>📣</span>
          Announcement Banner
          {isDirty && <span className="hero-editor__pill">Unsaved changes</span>}
        </h1>
        <div className="admin-form__bar-spacer" />
        {showSaved && <span className="hero-editor__saved">✓ Saved</span>}
        <button className="admin-form__save" onClick={save} disabled={saving}>
          <SaveIcon />
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="hero-editor__body">
        {/* Form column */}
        <div className="hero-editor__form">
          <div className="hero-editor__intro">
            <h2 className="admin-form__section" style={{ margin: "0 0 8px" }}>Banner under your header</h2>
            <p className="admin-field__hint" style={{ fontSize: 14, lineHeight: 1.6 }}>
              A slim bar that appears directly under your site header — great for
              promos, shipping notices or launches. Turn it on, pick a style, and
              add your messages.
            </p>
          </div>

          {/* Enable + mode */}
          <div className="hero-editor__card">
            <div className="hero-editor__eyebrow"><span /> Display</div>

            <label className="admin-field" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={banner.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              <span className="admin-field__label" style={{ margin: 0 }}>
                Show the announcement banner
              </span>
            </label>

            <div className="admin-field" style={{ marginTop: 14 }}>
              <label className="admin-field__label">Style</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {BANNER_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn ${banner.mode === m ? "btn-primary" : "btn-ghost"}`}
                    aria-pressed={banner.mode === m}
                    style={{ flexDirection: "column", alignItems: "flex-start", padding: "8px 12px", minWidth: 120 }}
                    onClick={() => update({ mode: m })}
                  >
                    <strong>{MODE_LABEL[m].title}</strong>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>{MODE_LABEL[m].hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="hero-editor__card">
            <div className="hero-editor__eyebrow"><span /> Messages</div>
            {banner.slides.length === 0 && (
              <p className="admin-field__hint">No messages yet — add your first one below.</p>
            )}
            {banner.slides.map((slide, i) => (
              <div key={slide.id} className="admin-field" style={{ border: "1px solid var(--brand-border, #eee)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="admin-field__label" style={{ margin: 0 }}>Message {i + 1}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn-ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveSlide(i, -1)}>↑</button>
                    <button type="button" className="btn btn-ghost" aria-label="Move down" disabled={i === banner.slides.length - 1} onClick={() => moveSlide(i, 1)}>↓</button>
                    <button type="button" className="btn btn-ghost" aria-label="Remove message" onClick={() => removeSlide(slide.id)}>✕</button>
                  </div>
                </div>
                <input
                  className="admin-input"
                  value={slide.text}
                  maxLength={CAP_TEXT}
                  placeholder="e.g. Free shipping on orders over $150"
                  onChange={(e) => updateSlide(slide.id, { text: e.target.value })}
                />
                <div className="admin-form__row" style={{ marginTop: 8 }}>
                  <div className="admin-field">
                    <label className="admin-field__label">Links to</label>
                    <select
                      className="admin-select"
                      value={slide.linkType}
                      onChange={(e) => updateSlide(slide.id, { linkType: e.target.value as BannerLinkType })}
                    >
                      <option value="none">Nothing (just text)</option>
                      <option value="page">A page on your site</option>
                      <option value="custom">Custom URL</option>
                    </select>
                  </div>
                  <div className="admin-field">
                    {slide.linkType === "page" && (
                      <>
                        <label className="admin-field__label">Destination page</label>
                        <select
                          className="admin-select"
                          value={slide.linkPage}
                          onChange={(e) => updateSlide(slide.id, { linkPage: e.target.value })}
                        >
                          {pageOptions.map((o) => (
                            <option key={o.route} value={o.route}>{o.label}</option>
                          ))}
                        </select>
                      </>
                    )}
                    {slide.linkType === "custom" && (
                      <>
                        <label className="admin-field__label">Custom URL</label>
                        <input
                          className="admin-input"
                          type="url"
                          inputMode="url"
                          maxLength={CAP_URL}
                          placeholder="https://"
                          value={slide.linkUrl}
                          onChange={(e) => updateSlide(slide.id, { linkUrl: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={banner.slides.length >= MAX_BANNER_SLIDES}
              onClick={addSlide}
            >
              + Add message
            </button>
            {banner.mode === "single" && banner.slides.length > 1 && (
              <div className="admin-field__hint" style={{ marginTop: 8 }}>
                “Single” shows only the first message. Switch to Carousel or Live
                scroll to show them all.
              </div>
            )}
          </div>

          {/* Options */}
          <div className="hero-editor__card">
            <div className="hero-editor__eyebrow"><span /> Options</div>
            <div className="admin-form__row">
              <div className="admin-field">
                <label className="admin-field__label">Background color <span style={{ color: "var(--brand-text-muted)", fontWeight: 500 }}>(optional)</span></label>
                <input
                  className="admin-input"
                  placeholder="e.g. #101820 (blank = brand accent)"
                  value={banner.bgColor}
                  onChange={(e) => update({ bgColor: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label">Text color <span style={{ color: "var(--brand-text-muted)", fontWeight: 500 }}>(optional)</span></label>
                <input
                  className="admin-input"
                  placeholder="e.g. #ffffff"
                  value={banner.textColor}
                  onChange={(e) => update({ textColor: e.target.value })}
                />
              </div>
            </div>

            {banner.mode === "carousel" && (
              <div className="admin-field">
                <label className="admin-field__label">Rotate every {(banner.autoplayMs / 1000).toFixed(0)}s</label>
                <input
                  type="range"
                  min={2000}
                  max={20000}
                  step={1000}
                  value={banner.autoplayMs}
                  onChange={(e) => update({ autoplayMs: Number(e.target.value) })}
                />
              </div>
            )}

            {banner.mode === "marquee" && (
              <div className="admin-field">
                <label className="admin-field__label">Scroll speed</label>
                <select
                  className="admin-select"
                  value={banner.speed}
                  onChange={(e) => update({ speed: e.target.value as BannerSpeed })}
                >
                  <option value="slow">Slow</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                </select>
              </div>
            )}

            {(banner.mode === "carousel" || banner.mode === "marquee") && (
              <label className="admin-field" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={banner.pauseOnHover}
                  onChange={(e) => update({ pauseOnHover: e.target.checked })}
                />
                <span className="admin-field__label" style={{ margin: 0 }}>Pause when a visitor hovers</span>
              </label>
            )}
          </div>
        </div>

        {/* Preview column */}
        <aside className="hero-editor__preview-col">
          <div className="hero-editor__preview-head">
            <span className="hero-editor__eyebrow" style={{ margin: 0 }}><span /> Live preview</span>
            <span className="hero-editor__preview-tag">as seen by customers</span>
          </div>
          <div className="hero-editor__preview-frame">
            <div className="sf-root">
              <AnnouncementBanner brand={previewBrand} onRoute={() => {}} />
            </div>
            {banner.slides.length === 0 && (
              <p className="admin-field__hint" style={{ padding: 12 }}>Add a message to see the banner.</p>
            )}
          </div>
          <p className="hero-editor__preview-note">
            {banner.enabled
              ? "Preview reflects your storefront theme and updates as you edit."
              : "The banner is currently turned off — the preview shows how it would look once enabled."}
          </p>
        </aside>
      </div>
    </div>
  );
}
