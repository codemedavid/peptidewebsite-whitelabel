"use client";

import { useRef, useState } from "react";
import type { Brand, Review } from "../types";
import { useStore } from "../store";
import { uploadStorefrontImageAction } from "@/actions/media";
import { FONT_OPTIONS, FONT_WEIGHTS, type HeroFieldStyle } from "@/lib/theme/tokens";
import {
  MAX_REVIEW_PRODUCTS,
  MIN_REVIEW_FONT_SIZE,
  MAX_REVIEW_FONT_SIZE,
  reviewProductIds,
} from "@/lib/storefront/reviews";
import { canOpenReviewViewer } from "@/lib/storefront/review-viewer";
import { ReviewViewer } from "../components/ReviewViewer";
import { DESIGN_FONTS_HREF } from "../tweaks/designFonts";

// Internal type used only in the admin manager: a Review that carries a
// stable runtime id (not persisted) and an optional _new flag.
type ReviewEntry = Review & { id: string; _new?: boolean };

function ReviewModal({
  review,
  onCancel,
  onSave,
}: {
  review: ReviewEntry;
  onCancel: () => void;
  onSave: (r: ReviewEntry) => void;
}) {
  const { products } = useStore();
  const [headline, setHeadline] = useState(review.headline || "");
  const [title, setTitle] = useState(review.title || "");
  const [subtitle, setSubtitle] = useState(review.subtitle || "");
  const [badge, setBadge] = useState(review.badge || "Testimonial");
  const [image, setImage] = useState(review.image || "");
  // Multi-connect: a testimonial can name several products, and each one shows
  // it under its description in the storefront's product detail modal. Seeded
  // from the legacy single `productId` so an older review keeps its link.
  const [productIds, setPids] = useState<string[]>(
    review.productIds?.length ? review.productIds : review.productId ? [review.productId] : [],
  );
  // Description typography. Unset attributes inherit the tenant default
  // (Brand.reviewDescStyle) and then the stylesheet — that is why every control
  // has an explicit "Default" option rather than a pre-filled value.
  const [descStyle, setDescStyle] = useState<HeroFieldStyle>(review.descStyle ?? {});
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSave = (title.trim() || subtitle.trim() || image) && !uploading;

  // Merge one attribute into the style, pruning the key when it is cleared so
  // "Default" really means unset (and never a stored empty string).
  const patchStyle = (patch: Partial<HeroFieldStyle>) =>
    setDescStyle((prev) => {
      const next = { ...prev, ...patch };
      (Object.keys(patch) as (keyof HeroFieldStyle)[]).forEach((k) => {
        if (next[k] === undefined || next[k] === "") delete next[k];
      });
      return next;
    });

  const toggleProduct = (pid: string) =>
    setPids((prev) =>
      prev.includes(pid)
        ? prev.filter((x) => x !== pid)
        : prev.length >= MAX_REVIEW_PRODUCTS
          ? prev
          : [...prev, pid],
    );

  // Upload the review image to the tenant's ImageKit folder; store the URL.
  const handleImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "review");
      const res = await uploadStorefrontImageAction(fd);
      if ("url" in res) setImage(res.url);
      else alert(res.error);
    } catch {
      alert("Image upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-modal" onClick={onCancel}>
      <div
        className="admin-modal__card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <h2 className="admin-modal__title">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ color: "var(--brand-accent)" }}
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {review._new ? "Add Review" : "Edit Review"}
        </h2>

        <div className="admin-modal__row">
          <label className="admin-field__label">Image</label>
          <div
            className={`admin-coa-modal__drop ${drag ? "is-dragover" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void handleImage(e.dataTransfer.files?.[0]);
            }}
          >
            {uploading ? (
              <div style={{ padding: 24 }}>Uploading…</div>
            ) : image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Review preview" />
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <button
                    className="admin-btn admin-btn--ghost"
                    style={{ padding: "6px 14px", fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileRef.current?.click();
                    }}
                  >
                    Replace
                  </button>
                  <button
                    className="admin-btn admin-btn--ghost"
                    style={{ padding: "6px 14px", fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setImage("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ margin: "0 auto 8px" }}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21" />
                </svg>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  Click or drop a screenshot / photo
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--brand-text-muted)",
                    marginTop: 4,
                  }}
                >
                  PNG, JPG — under 2 MB
                </div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => void handleImage(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">
            Connect to products {productIds.length > 0 && `(${productIds.length})`}
          </label>
          <div
            style={{
              maxHeight: 190,
              overflowY: "auto",
              display: "grid",
              gap: 2,
              border: "1px solid var(--brand-border, rgba(0,0,0,0.12))",
              borderRadius: 10,
              padding: 8,
            }}
          >
            {products.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--brand-text-muted)", padding: 4 }}>
                No products yet — add one first.
              </div>
            )}
            {products.map((p) => {
              const on = productIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    padding: "4px 6px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: on ? "color-mix(in srgb, var(--brand-accent) 12%, transparent)" : "transparent",
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleProduct(p.id)} />
                  <span>{p.name}</span>
                </label>
              );
            })}
          </div>
          <div className="admin-field__hint">
            Pick any number of products (up to {MAX_REVIEW_PRODUCTS}). This review shows under the
            description of every product you tick, and the reviews page links back to each of them.
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Headline (image overlay)</label>
          <input
            className="admin-input"
            value={headline}
            placeholder="e.g. Plateau breaker 🔥"
            onChange={(e) => setHeadline(e.target.value)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Title</label>
            <input
              className="admin-input"
              value={title}
              placeholder="Card title"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Badge</label>
            <input
              className="admin-input"
              value={badge}
              placeholder="e.g. Testimonial"
              onChange={(e) => setBadge(e.target.value)}
            />
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Subtitle</label>
          <textarea
            className="admin-textarea"
            value={subtitle}
            placeholder="A short quote or description…"
            style={{
              minHeight: 80,
              fontFamily: descStyle.font ? `'${descStyle.font}', sans-serif` : undefined,
              fontWeight: descStyle.weight,
              fontStyle: descStyle.italic ? "italic" : undefined,
            }}
            onChange={(e) => setSubtitle(e.target.value)}
          />
          <div className="admin-field__hint">
            The typography below applies to this description everywhere it appears — the reviews
            page and every connected product. Leave a control on "Default" to inherit the store's
            style.
          </div>
        </div>

        {/* The picker previews real families, so load them here (same as the
            brand tweaks panel) rather than shipping them to every shopper. */}
        <link rel="stylesheet" href={DESIGN_FONTS_HREF} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Description font</label>
            <select
              className="admin-select"
              value={descStyle.font ?? ""}
              onChange={(e) => patchStyle({ font: e.target.value || undefined })}
            >
              <option value="">Default (store font)</option>
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: `'${f}', sans-serif` }}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Weight</label>
            <select
              className="admin-select"
              value={descStyle.weight ?? ""}
              onChange={(e) =>
                patchStyle({ weight: e.target.value ? (Number(e.target.value) as (typeof FONT_WEIGHTS)[number]) : undefined })
              }
            >
              <option value="">Default</option>
              {FONT_WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Size (px)</label>
            <input
              className="admin-input"
              type="number"
              min={MIN_REVIEW_FONT_SIZE}
              max={MAX_REVIEW_FONT_SIZE}
              value={descStyle.size ?? ""}
              placeholder="Default"
              onChange={(e) =>
                patchStyle({ size: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Color</label>
            <input
              className="admin-input"
              type="color"
              value={descStyle.color ?? "#333333"}
              onChange={(e) => patchStyle({ color: e.target.value })}
            />
          </div>
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label">Style</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={descStyle.italic === true}
                onChange={(e) => patchStyle({ italic: e.target.checked || undefined })}
              />
              Italic
            </label>
          </div>
        </div>

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-btn"
            disabled={!canSave}
            onClick={() =>
              onSave({
                ...review,
                headline,
                title,
                subtitle,
                badge,
                image,
                // Keep the legacy single field pointing at the first connected
                // product so older readers still resolve one.
                productId: productIds[0] ?? "",
                productIds,
                descStyle: Object.keys(descStyle).length > 0 ? descStyle : undefined,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminReviewsManager({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { reviews, setReviews, products } = useStore();
  const [list, setList] = useState<ReviewEntry[]>(
    reviews.map((r, i) => ({ ...r, id: (r as ReviewEntry).id || `rv_seed_${i}` })),
  );
  const [editing, setEditing] = useState<ReviewEntry | null>(null);
  // The owner asked for this first: the manager thumb crops their screenshot,
  // so they couldn't check what a shopper would actually see. Same viewer the
  // storefront uses, so what they proof here is what ships.
  const [viewing, setViewing] = useState<ReviewEntry | null>(null);

  const commit = (next: ReviewEntry[]) => {
    setList(next);
    // Strip only the internal _new flag — `id` is a real Review field now, and
    // the storefront + normalizer both key off it, so it must survive the save.
    setReviews(next.map(({ _new: _n, ...rest }) => rest as Review));
  };

  const startAdd = () =>
    setEditing({
      id: `rv${Date.now()}`,
      headline: "",
      title: "",
      subtitle: "",
      badge: "Testimonial",
      image: "",
      productId: "",
      productIds: [],
      _new: true,
    });

  const save = (r: ReviewEntry) => {
    const exists = list.some((x) => x.id === r.id);
    const { _new: _drop, ...clean } = r;
    commit(exists ? list.map((x) => (x.id === r.id ? clean : x)) : [...list, clean]);
    setEditing(null);
  };

  const remove = (id: string) => {
    if (!confirm("Delete this review?")) return;
    commit(list.filter((r) => r.id !== id));
  };

  const productName = (pid: string | undefined) =>
    pid ? products.find((p) => p.id === pid)?.name : undefined;

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onBack();
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ color: "var(--brand-accent)" }}
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Reviews
            </span>
          </h1>
          <div style={{ display: "flex", gap: 10 }}>
            <a
              className="admin-btn admin-btn--ghost"
              href="#reviews"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview Public Page
            </a>
            <button className="admin-btn" onClick={startAdd}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Review
            </button>
          </div>
        </div>

        <div className="reviews-admin-grid">
          {list.map((r) => (
            <div key={r.id} className="review-admin-card">
              <div className="review-admin-card__thumb">
                {r.image ? (
                  <button
                    type="button"
                    className="review-admin-card__zoom"
                    onClick={() => setViewing(r)}
                    disabled={!canOpenReviewViewer(r)}
                    aria-label={`View ${r.title || "this review"} full size`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.image} alt={r.title} />
                  </button>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21" />
                  </svg>
                )}
                {reviewProductIds(r).map((pid) => {
                  const name = productName(pid);
                  return name ? (
                    <span key={pid} className="review-admin-card__product-chip">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                      {name}
                    </span>
                  ) : null;
                })}
              </div>
              <div className="review-admin-card__body">
                <h3 className="review-admin-card__title">{r.title || "Untitled"}</h3>
                <p className="review-admin-card__sub">{r.subtitle}</p>
              </div>
              <div className="review-admin-card__foot">
                <button
                  className="admin-btn admin-btn--ghost"
                  style={{ padding: "6px 14px", fontSize: 13 }}
                  onClick={() => setEditing({ ...r })}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                  Edit
                </button>
                <button
                  className="admin-icon-btn admin-icon-btn--danger"
                  onClick={() => remove(r.id)}
                  title="Delete"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="admin-empty-set" style={{ gridColumn: "1 / -1" }}>
              No reviews yet.
              <button className="admin-empty-set__cta" onClick={startAdd}>
                + Add your first review
              </button>
            </div>
          )}
        </div>

        {editing && (
          <ReviewModal review={editing} onCancel={() => setEditing(null)} onSave={save} />
        )}

        {viewing && (
          <ReviewViewer review={viewing} brand={brand} onClose={() => setViewing(null)} />
        )}
      </main>
    </div>
  );
}
