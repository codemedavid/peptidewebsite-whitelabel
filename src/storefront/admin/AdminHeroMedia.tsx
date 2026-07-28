"use client";

// The image-mode panels of the store-admin Hero editor: upload one full-width
// banner and use it INSTEAD of the written hero. Split out of AdminHeroSettings
// so each file stays a readable size — the parent owns the mode switch, the
// save and the preview; this owns the banner itself.
//
// The upload goes through the shared uploadStorefrontImageAction (the tenant's
// own ImageKit folder, or an inline data URL in demo / unconfigured setups), so
// the hero banner lands in the same place as every other store-admin image.
// Nothing here writes to the DB: it edits the in-memory HeroMedia the parent
// persists via saveHeroContentAction.

import { useRef, useState } from "react";
import { useStore } from "../store";
import { uploadStorefrontImageAction } from "@/actions/media";
import type { HeroMedia, HeroMediaRatio, HeroMediaFocus } from "@/lib/storefront/hero-media";

const RATIO_OPTIONS: { value: HeroMediaRatio; label: string }[] = [
  { value: "wide", label: "Wide strip (3:1)" },
  { value: "standard", label: "Standard (2:1)" },
  { value: "tall", label: "Tall (3:2)" },
];

const FOCUS_OPTIONS: { value: HeroMediaFocus; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

const CAP_ALT = 200;
const CAP_URL = 500;
// Mirrors STOREFRONT_IMAGE_MAX_BYTES on the server — checked here too so an
// oversized pick fails instantly instead of after a long upload.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function prettySize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileMeta(file: File): string {
  const ext = (file.type.split("/")[1] || "image").toUpperCase();
  return `${prettySize(file.size)} · ${ext}`;
}

/** Derive a starting alt text from the filename ("gold-vials.jpg" → "gold vials"). */
function altFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <path d="M12 3v13" />
    </svg>
  );
}

export function AdminHeroMedia({
  media,
  onChange,
  pageOptions,
}: {
  media: HeroMedia;
  onChange: (patch: Partial<HeroMedia>) => void;
  pageOptions: { route: string; label: string }[];
}) {
  const { toast } = useStore();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Filename + size are presentational only (they describe the pick that is
  // still on screen), so they live in local state rather than branding.config.
  const [fileInfo, setFileInfo] = useState<{ name: string; meta: string } | null>(null);
  const dropInputRef = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File | undefined | null) => {
    if (!file || uploading) return;
    if (!file.type.startsWith("image/")) {
      toast("That file isn't an image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`Image too large (${prettySize(file.size)}) — the limit is 10 MB.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "branding");
      const res = await uploadStorefrontImageAction(fd);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setFileInfo({ name: file.name, meta: fileMeta(file) });
      onChange({
        url: res.url,
        // Only seed alt text when the owner hasn't written their own.
        ...(media.alt.trim() ? {} : { alt: altFromName(file.name) }),
      });
    } catch {
      toast("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setFileInfo(null);
    onChange({ url: "" });
  };

  return (
    <>
      <div className="hero-editor__card">
        <div className="hero-editor__eyebrow"><span /> Banner image</div>

        {!media.url ? (
          <>
            <div
              className={`hero-editor__drop${dragging ? " is-dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragging) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(e.dataTransfer.files?.[0]);
              }}
              onClick={() => dropInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dropInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="hero-editor__drop-icon"><UploadIcon /></span>
              <div className="hero-editor__drop-title">
                {uploading ? "Uploading…" : "Drop an image here, or browse"}
              </div>
              <div className="admin-field__hint">
                JPG, PNG or WebP · at least 2000×1000px · up to 10 MB
              </div>
              <input
                ref={dropInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </div>
            <div className="admin-field__hint" style={{ marginTop: 12 }}>
              While no image is uploaded, your storefront keeps showing the written hero.
            </div>
          </>
        ) : (
          <>
            <div className="hero-editor__filecard">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="hero-editor__filecard-thumb" src={media.url} alt="" />
              <div className="hero-editor__filecard-meta">
                <div className="hero-editor__filecard-name">
                  {fileInfo?.name ?? "Current banner"}
                </div>
                <div className="admin-field__hint">
                  {fileInfo?.meta ?? "Uploaded to your store's media library"}
                </div>
              </div>
              <div className="hero-editor__filecard-actions">
                <label className="hero-editor__ghost-btn">
                  {uploading ? "Uploading…" : "Replace"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />
                </label>
                <button
                  type="button"
                  className="hero-editor__ghost-btn hero-editor__ghost-btn--danger"
                  onClick={removeImage}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="admin-form__row" style={{ marginTop: 22 }}>
              <div className="admin-field">
                <label className="admin-field__label">Banner height</label>
                <select
                  className="admin-select"
                  value={media.ratio}
                  onChange={(e) => onChange({ ratio: e.target.value as HeroMediaRatio })}
                >
                  {RATIO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <label className="admin-field__label">Focus point</label>
                <select
                  className="admin-select"
                  value={media.focus}
                  onChange={(e) => onChange({ focus: e.target.value as HeroMediaFocus })}
                >
                  {FOCUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="admin-field__hint" style={{ marginTop: -6 }}>
              Focus point keeps the important part of the photo visible on phones.
            </div>

            <div className="admin-field" style={{ marginTop: 22 }}>
              <label className="admin-field__label">Image description (alt text)</label>
              <input
                className="admin-input"
                value={media.alt}
                maxLength={CAP_ALT}
                placeholder="Describe the image for screen readers"
                onChange={(e) => onChange({ alt: e.target.value })}
              />
              <div className="admin-field__hint">
                Read aloud to shoppers using a screen reader, and shown if the image fails to load.
              </div>
            </div>

            <div className="hero-editor__linkbox" style={{ marginTop: 22 }}>
              <div className="hero-editor__linkbox-head">Where does the banner link?</div>
              <div className="admin-field__hint" style={{ marginTop: -4 }}>
                The whole image becomes clickable.
              </div>
              <select
                className="admin-select"
                aria-label="Banner link type"
                value={media.linkType}
                onChange={(e) =>
                  onChange({ linkType: e.target.value as HeroMedia["linkType"] })
                }
              >
                <option value="page">A page on your site</option>
                <option value="custom">Custom URL</option>
                <option value="none">Nothing — not clickable</option>
              </select>
              {media.linkType === "page" && (
                <select
                  className="admin-select"
                  aria-label="Banner destination page"
                  value={media.linkPage}
                  onChange={(e) => onChange({ linkPage: e.target.value })}
                >
                  {pageOptions.map((o) => (
                    <option key={o.route} value={o.route}>{o.label}</option>
                  ))}
                </select>
              )}
              {media.linkType === "custom" && (
                <input
                  className="admin-input"
                  type="url"
                  inputMode="url"
                  maxLength={CAP_URL}
                  placeholder="https://"
                  value={media.linkUrl}
                  onChange={(e) => onChange({ linkUrl: e.target.value })}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="hero-editor__card">
        <div className="hero-editor__switchrow">
          <div>
            <div className="hero-editor__switchrow-title">Show text over the image</div>
            <div className="admin-field__hint">
              Off means the image speaks for itself. On reuses the headline and buttons
              from your written hero.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={media.overlay}
            aria-label="Show text over the image"
            className={`hero-editor__switch${media.overlay ? " is-on" : ""}`}
            onClick={() => onChange({ overlay: !media.overlay })}
          >
            <span className="hero-editor__switch-knob" />
          </button>
        </div>

        {media.overlay && (
          <div className="hero-editor__scrim">
            <div className="hero-editor__scrim-head">
              <label className="admin-field__label" htmlFor="hero-scrim">
                Dark scrim over image
              </label>
              <span className="admin-field__hint">{media.scrim}%</span>
            </div>
            <input
              id="hero-scrim"
              type="range"
              min={0}
              max={70}
              step={5}
              value={media.scrim}
              onChange={(e) => onChange({ scrim: Number(e.target.value) })}
            />
            <div className="admin-field__hint">
              Add a scrim so text stays readable on busy photos.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
