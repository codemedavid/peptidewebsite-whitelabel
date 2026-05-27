"use client";

import { useRef, useState } from "react";
import type { Brand, Review } from "../types";
import { useStore } from "../store";

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
  const [productId, setPid] = useState(review.productId || "");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSave = title.trim() || subtitle.trim() || image;

  const handleImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Image is over 2 MB. Try a smaller file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setImage(String(e.target?.result ?? ""));
    reader.readAsDataURL(file);
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
              handleImage(e.dataTransfer.files?.[0]);
            }}
          >
            {image ? (
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
              onChange={(e) => handleImage(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className="admin-modal__row">
          <label className="admin-field__label">Connect to product</label>
          <select
            className="admin-select"
            value={productId}
            onChange={(e) => setPid(e.target.value)}
          >
            <option value="">— No product link —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="admin-field__hint">
            Links the review to a product. The card will show "for [product]" on the public page.
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
            style={{ minHeight: 80 }}
            placeholder="A short quote or description…"
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </div>

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-btn"
            disabled={!canSave}
            onClick={() =>
              onSave({ ...review, headline, title, subtitle, badge, image, productId })
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

  void brand;

  const commit = (next: ReviewEntry[]) => {
    setList(next);
    // Strip internal id/_new before writing to the store so Review[] type is satisfied
    setReviews(
      next.map(({ id: _id, _new: _n, ...rest }) => rest as Review),
    );
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt={r.title} />
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
                {r.productId && productName(r.productId) && (
                  <span className="review-admin-card__product-chip">
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
                    {productName(r.productId)}
                  </span>
                )}
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
      </main>
    </div>
  );
}
