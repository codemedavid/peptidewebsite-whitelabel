"use client";

// Store-admin editor for the homepage hero — a two-column workspace: the copy
// form on the left, a live customer-eye preview on the right that updates as
// the owner types. It edits the SAME branding.config.hero* fields the platform
// operator can set in the Branding editor's Hero tab (chip, the two headline
// lines, the tagline, and the two CTA labels), and additionally lets the owner
// choose where each CTA button links — a page on the storefront or a custom
// URL. Colors, fonts, layout and the hero variant stay operator-controlled.
//
// Saves through saveHeroContentAction (read-modify-write into branding.config)
// and mirror into the live brand via setTweak so the open storefront's hero
// updates without a reload. The preview is a faithful-but-simplified render
// themed entirely from the tenant's --brand-* tokens, so it looks right for
// every white-label store, not just the one this design was drawn against.

import { useRef, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { isPageVisible } from "../visibility";
import { saveHeroContentAction } from "@/actions/storefront-admin";
import { AdminHeroMedia } from "./AdminHeroMedia";
import {
  normalizeHeroMedia,
  heroMediaAspect,
  heroMediaPosition,
  heroMediaScrimAlpha,
  type HeroMedia,
} from "@/lib/storefront/hero-media";

type LinkType = "page" | "custom";

interface HeroFields {
  chip: string;
  line1: string;
  line2: string;
  sub: string;
  cta1: string;
  cta2: string;
  cta1LinkType: LinkType;
  cta1LinkPage: string;
  cta1LinkUrl: string;
  cta2LinkType: LinkType;
  cta2LinkPage: string;
  cta2LinkUrl: string;
  // Image-hero config. `media.mode` is what the owner PICKED; the storefront
  // still falls back to the written hero until an image is actually uploaded.
  media: HeroMedia;
}

// Every storefront page a CTA can point at, with a friendly label. Home and the
// catalog are always available; the rest surface only when the tenant has that
// page switched on (same visibility rule the storefront nav uses).
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

const CAP_SHORT = 120;
const CAP_LONG = 400;
const CAP_URL = 500;

function fieldsFromBrand(brand: Brand): HeroFields {
  return {
    chip: brand.heroChipLabel ?? "",
    line1: brand.heroLine1 ?? "",
    line2: brand.heroLine2 ?? "",
    sub: brand.heroSub ?? "",
    cta1: brand.heroCta1 ?? "",
    cta2: brand.heroCta2 ?? "",
    cta1LinkType: brand.heroCta1LinkType === "custom" ? "custom" : "page",
    cta1LinkPage: brand.heroCta1LinkPage ?? "catalog",
    cta1LinkUrl: brand.heroCta1LinkUrl ?? "",
    cta2LinkType: brand.heroCta2LinkType === "custom" ? "custom" : "page",
    cta2LinkPage: brand.heroCta2LinkPage ?? "reviews",
    cta2LinkUrl: brand.heroCta2LinkUrl ?? "",
    media: normalizeHeroMedia(brand),
  };
}

function toPayload(f: HeroFields) {
  return {
    heroChipLabel: f.chip.trim(),
    heroLine1: f.line1.trim(),
    heroLine2: f.line2.trim(),
    heroSub: f.sub.trim(),
    heroCta1: f.cta1.trim(),
    heroCta2: f.cta2.trim(),
    heroCta1LinkType: f.cta1LinkType,
    heroCta1LinkPage: f.cta1LinkPage,
    heroCta1LinkUrl: f.cta1LinkType === "custom" ? f.cta1LinkUrl.trim() : "",
    heroCta2LinkType: f.cta2LinkType,
    heroCta2LinkPage: f.cta2LinkPage,
    heroCta2LinkUrl: f.cta2LinkType === "custom" ? f.cta2LinkUrl.trim() : "",
    heroMedia: f.media,
  };
}

// The normalized server payload uses hero* Brand keys; fold the CTA link values
// back into the local HeroFields shape so the saved baseline matches exactly
// (e.g. a page-type button clears its custom URL server-side).
function linkFieldsFromPayload(p: ReturnType<typeof toPayload>): Partial<HeroFields> {
  return {
    cta1LinkType: p.heroCta1LinkType,
    cta1LinkPage: p.heroCta1LinkPage,
    cta1LinkUrl: p.heroCta1LinkUrl,
    cta2LinkType: p.heroCta2LinkType,
    cta2LinkPage: p.heroCta2LinkPage,
    cta2LinkUrl: p.heroCta2LinkUrl,
    // Run the media block through the SAME normalizer the server applies, so a
    // trimmed alt or a dropped custom URL doesn't leave the form looking dirty.
    media: normalizeHeroMedia(p),
  };
}

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

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CtaLinkPicker({
  n,
  type,
  page,
  url,
  pageOptions,
  onType,
  onPage,
  onUrl,
}: {
  n: 1 | 2;
  type: LinkType;
  page: string;
  url: string;
  pageOptions: { route: string; label: string }[];
  onType: (v: LinkType) => void;
  onPage: (v: string) => void;
  onUrl: (v: string) => void;
}) {
  return (
    <div className="hero-editor__linkbox">
      <div className="hero-editor__linkbox-head">
        <LinkIcon /> Links to
      </div>
      <select
        className="admin-select"
        aria-label={`Button ${n} link type`}
        value={type}
        onChange={(e) => onType(e.target.value === "custom" ? "custom" : "page")}
      >
        <option value="page">A page on your site</option>
        <option value="custom">Custom URL</option>
      </select>
      {type === "page" ? (
        <select
          className="admin-select"
          aria-label={`Button ${n} destination page`}
          value={page}
          onChange={(e) => onPage(e.target.value)}
        >
          {pageOptions.map((o) => (
            <option key={o.route} value={o.route}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="admin-input"
          type="url"
          inputMode="url"
          maxLength={CAP_URL}
          placeholder="https://"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
        />
      )}
    </div>
  );
}

export function AdminHeroSettings({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { setTweak, toast } = useStore();
  const [fields, setFields] = useState<HeroFields>(() => fieldsFromBrand(brand));
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  // Preview-only: which viewport the right-hand column mimics.
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  // Snapshot of the last-saved state, used to detect unsaved changes.
  const savedRef = useRef<HeroFields>(fieldsFromBrand(brand));
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDirty = JSON.stringify(fields) !== JSON.stringify(savedRef.current);

  const pageOptions = PAGE_OPTIONS.filter((o) => o.alwaysOn || isPageVisible(brand, o.route));

  const set = <K extends keyof HeroFields>(key: K, value: HeroFields[K]) => {
    setShowSaved(false);
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = toPayload(fields);
      const res = await saveHeroContentAction(payload);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // Reset the dirty baseline to the values we just persisted (with the
      // server-normalized link fields folded back in) so the "Unsaved changes"
      // pill clears and a page-type button's stale custom URL doesn't re-dirty.
      savedRef.current = { ...fields, ...linkFieldsFromPayload(payload) };
      setFields(savedRef.current);
      // Mirror into the live brand so the open storefront's hero picks up the
      // new copy + links immediately (the DB copy serves every other device).
      setTweak(payload);
      setShowSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setShowSaved(false), 2200);
      toast("Hero section saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  const setMedia = (patch: Partial<HeroMedia>) => {
    setShowSaved(false);
    setFields((prev) => ({ ...prev, media: { ...prev.media, ...patch } }));
  };

  const previewBadge = (fields.chip || brand.name || "").toUpperCase();
  const accentColor = brand.heroHighlight || "var(--brand-accent)";

  const isText = fields.media.mode === "text";
  // What a customer would actually SEE: image mode only wins once an image
  // exists, matching resolveHeroMedia() on the storefront.
  const showsImage = !isText && Boolean(fields.media.url);
  const scrimAlpha = heroMediaScrimAlpha(fields.media);

  return (
    <div className="admin hero-editor">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <BackIcon />
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>✨</span>
          Hero Section
          <span className="hero-editor__mode-tag">{isText ? "Written" : "Image"}</span>
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
            <h2 className="admin-form__section" style={{ margin: "0 0 8px" }}>Homepage Hero</h2>
            <p className="admin-field__hint" style={{ fontSize: 14, lineHeight: 1.6 }}>
              The big banner at the top of your storefront homepage. Choose how it
              looks — write your own copy, or upload a single image and use that
              instead. Colors, fonts and layout are set by your provider.
            </p>

            <div className="hero-editor__modes">
              <button
                type="button"
                className={`hero-editor__mode${isText ? " is-active" : ""}`}
                aria-pressed={isText}
                onClick={() => setMedia({ mode: "text" })}
              >
                <span className="hero-editor__mode-dot" aria-hidden="true" />
                <span className="hero-editor__mode-title">Written hero</span>
                <span className="hero-editor__mode-desc">
                  Headline, tagline and buttons styled by your theme.
                </span>
              </button>
              <button
                type="button"
                className={`hero-editor__mode${!isText ? " is-active" : ""}`}
                aria-pressed={!isText}
                onClick={() => setMedia({ mode: "image" })}
              >
                <span className="hero-editor__mode-dot" aria-hidden="true" />
                <span className="hero-editor__mode-title">Uploaded image</span>
                <span className="hero-editor__mode-desc">
                  Use one full-width image as the whole banner.
                </span>
              </button>
            </div>
          </div>

          {!isText && (
            <AdminHeroMedia media={fields.media} onChange={setMedia} pageOptions={pageOptions} />
          )}

          {/* Content — the written hero's copy. Still editable in image mode when
              the overlay is on, since the overlay reuses this headline + CTA. */}
          {(isText || fields.media.overlay) && (
          <div className="hero-editor__card">
            <div className="hero-editor__eyebrow"><span /> Content</div>

            <div className="admin-field" style={{ marginBottom: 18 }}>
              <label className="admin-field__label">Badge / chip label</label>
              <input
                className="admin-input"
                value={fields.chip}
                maxLength={CAP_SHORT}
                placeholder={brand.name || "e.g. NEW ARRIVAL"}
                onChange={(e) => set("chip", e.target.value)}
              />
              <div className="admin-field__hint">
                The small pill above the headline. Leave blank to show your store name.
              </div>
            </div>

            <div className="admin-form__row">
              <div className="admin-field">
                <label className="admin-field__label">Headline — line 1</label>
                <input
                  className="admin-input"
                  value={fields.line1}
                  maxLength={CAP_SHORT}
                  placeholder="Premium products,"
                  onChange={(e) => set("line1", e.target.value)}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label">
                  Headline — line 2 <span style={{ color: "var(--brand-text-muted)", fontWeight: 500 }}>(accent)</span>
                </label>
                <input
                  className="admin-input"
                  value={fields.line2}
                  maxLength={CAP_SHORT}
                  placeholder="for everyone"
                  onChange={(e) => set("line2", e.target.value)}
                />
              </div>
            </div>
            <div className="admin-field__hint" style={{ marginTop: -6, marginBottom: 18 }}>
              Leave line 2 blank for a single-line headline.
            </div>

            <div className="admin-field">
              <label className="admin-field__label">Tagline</label>
              <textarea
                className="admin-textarea"
                rows={3}
                value={fields.sub}
                maxLength={CAP_LONG}
                placeholder="A short sentence describing what your store offers."
                onChange={(e) => set("sub", e.target.value)}
              />
              <div className="hero-editor__counter">
                <span className="admin-field__hint">The supporting text under the headline.</span>
                <span className="admin-field__hint">{fields.sub.length} / {CAP_LONG}</span>
              </div>
            </div>
          </div>
          )}

          {/* Call to action */}
          {(isText || fields.media.overlay) && (
          <div className="hero-editor__card">
            <div className="hero-editor__eyebrow"><span /> Call to action</div>

            <div className="admin-form__row">
              <div className="admin-field">
                <label className="admin-field__label">Primary button label</label>
                <input
                  className="admin-input"
                  value={fields.cta1}
                  maxLength={CAP_SHORT}
                  placeholder="Shop Now"
                  onChange={(e) => set("cta1", e.target.value)}
                />
                <CtaLinkPicker
                  n={1}
                  type={fields.cta1LinkType}
                  page={fields.cta1LinkPage}
                  url={fields.cta1LinkUrl}
                  pageOptions={pageOptions}
                  onType={(v) => set("cta1LinkType", v)}
                  onPage={(v) => set("cta1LinkPage", v)}
                  onUrl={(v) => set("cta1LinkUrl", v)}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label">Secondary button label</label>
                <input
                  className="admin-input"
                  value={fields.cta2}
                  maxLength={CAP_SHORT}
                  placeholder="Learn More"
                  onChange={(e) => set("cta2", e.target.value)}
                />
                <CtaLinkPicker
                  n={2}
                  type={fields.cta2LinkType}
                  page={fields.cta2LinkPage}
                  url={fields.cta2LinkUrl}
                  pageOptions={pageOptions}
                  onType={(v) => set("cta2LinkType", v)}
                  onPage={(v) => set("cta2LinkPage", v)}
                  onUrl={(v) => set("cta2LinkUrl", v)}
                />
                <div className="admin-field__hint">Leave the label blank to hide the second button.</div>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Preview column */}
        <aside className="hero-editor__preview-col">
          <div className="hero-editor__preview-head">
            <span className="hero-editor__eyebrow" style={{ margin: 0 }}><span /> Live preview</span>
            <div className="hero-editor__device" role="group" aria-label="Preview width">
              <button
                type="button"
                className={device === "desktop" ? "is-active" : ""}
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                Desktop
              </button>
              <button
                type="button"
                className={device === "mobile" ? "is-active" : ""}
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                Mobile
              </button>
            </div>
          </div>
          <div className="hero-editor__preview-frame">
            <div
              className="hero-editor__preview-stage"
              style={{ maxWidth: device === "mobile" ? 380 : "100%" }}
            >
            {showsImage ? (
              <div
                className="hero-editor__pv-media"
                style={{
                  aspectRatio: device === "mobile" ? "4 / 3" : heroMediaAspect(fields.media.ratio),
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fields.media.url}
                  alt={fields.media.alt}
                  style={{ objectPosition: heroMediaPosition(fields.media.focus) }}
                />
                {scrimAlpha > 0 && (
                  <div
                    className="hero-editor__pv-media-scrim"
                    style={{ background: `rgba(0,0,0,${scrimAlpha})` }}
                  />
                )}
                {fields.media.overlay && (
                  <div className="hero-editor__pv-media-overlay">
                    <h3 className="hero-editor__pv-headline">
                      {fields.line1 || "Premium products,"}
                      {fields.line2 && <> <em>{fields.line2}</em></>}
                    </h3>
                    <span className="hero-editor__pv-btn hero-editor__pv-btn--primary">
                      {fields.cta1 || "Shop Now"}
                    </span>
                  </div>
                )}
              </div>
            ) : !isText ? (
              <div className="hero-editor__pv-empty">
                <div className="hero-editor__pv-empty-title">No image uploaded yet</div>
                <div className="admin-field__hint">
                  Upload one on the left and it appears here instantly. Until then your
                  storefront keeps showing the written hero.
                </div>
              </div>
            ) : (
            <div className="hero-editor__preview-hero">
              {previewBadge && <span className="hero-editor__pv-chip">{previewBadge}</span>}
              <h3 className="hero-editor__pv-headline">
                {fields.line1 || "Premium products,"}
                {fields.line2 && (
                  <>
                    <br />
                    <em className="hero-editor__pv-accent" style={{ color: accentColor }}>
                      {fields.line2}
                    </em>
                  </>
                )}
              </h3>
              {fields.sub && <p className="hero-editor__pv-sub">{fields.sub}</p>}
              <div className="hero-editor__pv-ctas">
                <span className="hero-editor__pv-btn hero-editor__pv-btn--primary">
                  {fields.cta1 || "Shop Now"}
                </span>
                {fields.cta2 && (
                  <span className="hero-editor__pv-btn hero-editor__pv-btn--secondary">{fields.cta2}</span>
                )}
              </div>
            </div>
            )}
            </div>
          </div>
          <p className="hero-editor__preview-note">
            Preview colors and layout reflect your storefront theme and update
            automatically as you type.
          </p>
        </aside>
      </div>
    </div>
  );
}
