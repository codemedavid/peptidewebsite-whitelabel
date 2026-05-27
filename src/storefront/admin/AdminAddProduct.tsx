"use client";

import { useState, useRef } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NumberFieldProps = {
  value: number | string;
  onChange: (v: number | string) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
};

function NumberField({ value, onChange, min = 0, max, disabled }: NumberFieldProps) {
  const v = value === "" ? "" : Number(value);
  const step = (delta: number) => {
    let n = (Number(v) || 0) + delta;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    onChange(n);
  };
  return (
    <div className="admin-number">
      <input
        className="admin-input"
        type="number"
        value={value}
        disabled={disabled}
        min={min}
        max={max}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      <div className="admin-number__spin">
        <button type="button" onClick={() => step(1)} disabled={disabled} aria-label="Increase">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button type="button" onClick={() => step(-1)} disabled={disabled} aria-label="Decrease">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
  );
}

type Inclusion = { name: string; qty: number };

type SetInclusionsEditorProps = {
  items: Inclusion[];
  onChange: (items: Inclusion[]) => void;
};

function SetInclusionsEditor({ items, onChange }: SetInclusionsEditorProps) {
  const add = () => onChange([...items, { name: "", qty: 1 }]);
  const upd = (i: number, patch: Partial<Inclusion>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const rm = (i: number) => onChange(items.filter((_, j) => j !== i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 36px", gap: 10 }}>
          <input
            className="admin-input"
            placeholder="Item name (e.g. Sterile water)"
            value={it.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => upd(i, { name: e.target.value })}
          />
          <input
            className="admin-input"
            type="number"
            min="1"
            value={it.qty}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              upd(i, { qty: Number(e.target.value) || 1 })
            }
          />
          <button
            className="admin-image-btn admin-image-btn--secondary"
            style={{ padding: 0, width: 36, justifyContent: "center" }}
            onClick={() => rm(i)}
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="admin-image-btn admin-image-btn--secondary"
        style={{ alignSelf: "flex-start" }}
        onClick={add}
      >
        + Add inclusion
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminAddProduct({
  brand,
  initial,
  onCancel,
  onSaved,
}: {
  brand: Brand;
  initial: Product | null;
  onCancel: () => void;
  onSaved: (p: Product) => void;
}) {
  const { products, setProducts, categories } = useStore();

  const isEdit = !!initial?.id;
  const [name, setName]             = useState<string>(initial?.name || "");
  const [description, setDesc]      = useState<string>(initial?.description || "");
  const [category, setCategory]     = useState<string>(
    initial?.category || (categories?.find((c) => c.id !== "all")?.id || ""),
  );
  const [price, setPrice]           = useState<number | string>(initial?.price ?? 0);
  const [purity, setPurity]         = useState<number | string>(
    initial?.purity?.replace("%", "") || "99",
  );
  const [molWeight, setMolWeight]   = useState<string>(initial?.molecularWeight || "");
  const [cas, setCas]               = useState<string>(initial?.cas || "");
  const [storage, setStorage]       = useState<string>(initial?.storage || "Store at -20°C");
  const [sequence, setSequence]     = useState<string>(initial?.sequence || "");
  const [isSet, setIsSet]           = useState<boolean>(initial?.isSet || false);
  const [setItems, setSetItems]     = useState<Inclusion[]>(initial?.inclusions || []);
  const [stock, setStock]           = useState<number | string>(initial?.stock ?? 0);
  const [featured, setFeatured]     = useState<boolean>(initial?.featured || false);
  const [available, setAvailable]   = useState<boolean>(initial?.available !== false);
  const [discount, setDiscount]     = useState<number | string>(initial?.discountPrice ?? 0);
  const [discountOn, setDiscountOn] = useState<boolean>(initial?.discountEnabled || false);
  const [image, setImage]           = useState<string>(initial?.image || "");
  const [imageDrag, setImageDrag]   = useState<boolean>(false);

  const currency = brand.currency || "₱";
  const fileRef = useRef<HTMLInputElement>(null);
  const canSave = name.trim() && description.trim() && category && Number(price) >= 0;

  const handleImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => setImage(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const save = () => {
    if (!canSave) return;
    const product: Product = {
      id: initial?.id || `p${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      category,
      price: Number(price) || 0,
      currency,
      purity: purity ? `${purity}%` : "",
      molecularWeight: molWeight,
      cas,
      storage,
      sequence,
      isSet,
      inclusions: setItems,
      stock: Number(stock) || 0,
      featured,
      available,
      discountPrice: discountOn ? Number(discount) || 0 : 0,
      discountEnabled: discountOn,
      image: image || null,
    };

    if (isEdit) {
      setProducts((prev) => {
        const i = prev.findIndex((p) => p.id === product.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = product;
          return next;
        }
        return [...prev, product];
      });
    } else {
      setProducts((prev) => [...prev, product]);
    }
    onSaved(product);
  };

  // Suppress unused variable warning — products is used only to satisfy the
  // store destructure contract; mutations go through setProducts.
  void products;

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onCancel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>✨</span>
          {isEdit ? "Edit Product" : "Add New"}
        </h1>
        <div className="admin-form__bar-spacer"></div>
        <button className="admin-form__cancel" onClick={onCancel}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Cancel
        </button>
        <button className="admin-form__save" onClick={save} disabled={!canSave}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          Save
        </button>
      </header>

      <div className="admin-form__body">

        {/* ---------- Basic Information ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">📝 Basic Information</h2>

          <div className="admin-form__row admin-form__row--single">
            <div className="admin-field">
              <label className="admin-field__label">Product Name<span className="req">*</span></label>
              <input className="admin-input" value={name} placeholder="e.g., BPC-157 5mg"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
            </div>
          </div>

          <div className="admin-form__row admin-form__row--single">
            <div className="admin-field">
              <label className="admin-field__label">Description<span className="req">*</span></label>
              <textarea className="admin-textarea" value={description}
                placeholder="Detailed product description…"
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDesc(e.target.value)} />
            </div>
          </div>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Category<span className="req">*</span></label>
              <select className="admin-select" value={category}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)}>
                {(categories || []).filter((c) => c.id !== "all").map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Base Price ({currency})<span className="req">*</span></label>
              <NumberField value={price} onChange={setPrice} min={0} />
            </div>
          </div>
        </div>

        {/* ---------- Scientific Details ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">🧪 Scientific Details</h2>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Purity (%)</label>
              <NumberField value={purity} onChange={setPurity} min={0} max={100} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Molecular Weight</label>
              <input className="admin-input" value={molWeight}
                placeholder="e.g., 1419.55 g/mol"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMolWeight(e.target.value)} />
            </div>
          </div>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">CAS Number</label>
              <input className="admin-input" value={cas}
                placeholder="e.g., 137525-51-0"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCas(e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Storage Conditions</label>
              <input className="admin-input" value={storage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStorage(e.target.value)} />
            </div>
          </div>

          <div className="admin-form__row admin-form__row--single">
            <div className="admin-field">
              <label className="admin-field__label">Sequence</label>
              <input className="admin-input" value={sequence}
                placeholder="e.g., GEPPPGKPADDAGLV"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSequence(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ---------- Complete Set Inclusions ---------- */}
        <div className="admin-form__card">
          <div className="admin-section-head">
            <h2 className="admin-form__section" style={{ margin: 0 }}>📦 Complete Set Inclusions</h2>
            <label className="admin-check">
              <input type="checkbox" checked={isSet}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsSet(e.target.checked)} />
              This is a SET product
            </label>
          </div>

          {!isSet ? (
            <div className="admin-empty-set">
              Enable &quot;This is a SET product&quot; to add inclusions
              <button className="admin-empty-set__cta" onClick={() => setIsSet(true)}>
                Enable SET feature
              </button>
            </div>
          ) : (
            <SetInclusionsEditor items={setItems} onChange={setSetItems} />
          )}
        </div>

        {/* ---------- Inventory & Availability ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">📦 Inventory &amp; Availability</h2>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Stock Quantity</label>
              <NumberField value={stock} onChange={setStock} min={0} />
            </div>
            <div className="admin-form__inline-row" style={{ alignSelf: "end", paddingBottom: 12 }}>
              <label className="admin-check">
                <input type="checkbox" checked={featured}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFeatured(e.target.checked)} />
                <span>⭐ Featured</span>
              </label>
              <label className="admin-check">
                <input type="checkbox" checked={available}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAvailable(e.target.checked)} />
                <span>✅ Available</span>
              </label>
            </div>
          </div>
        </div>

        {/* ---------- Discount Pricing ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">💰 Discount Pricing</h2>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Discount Price ({currency})</label>
              <NumberField value={discount} onChange={setDiscount} min={0} disabled={!discountOn} />
            </div>
            <div className="admin-form__inline-row" style={{ alignSelf: "end", paddingBottom: 12 }}>
              <label className="admin-check">
                <input type="checkbox" checked={discountOn}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDiscountOn(e.target.checked)} />
                <span>🏷️ Enable Discount</span>
              </label>
            </div>
          </div>
        </div>

        {/* ---------- Product Image ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">🖼️ Product Image</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Upload a product image (optional). This will appear on the customer-facing site.
          </div>

          <div
            className={`admin-image-drop ${imageDrag ? "is-dragover" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setImageDrag(true); }}
            onDragLeave={() => setImageDrag(false)}
            onDrop={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setImageDrag(false);
              handleImage(e.dataTransfer.files?.[0]);
            }}
          >
            {image ? (
              <div className="admin-image-drop__preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="preview" />
              </div>
            ) : (
              <>
                <div className="admin-image-drop__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21"/>
                  </svg>
                </div>
                <div className="admin-image-drop__title">Click to upload product image</div>
                <div className="admin-image-drop__sub">or drag and drop</div>
                <div className="admin-image-drop__formats">
                  All image formats (JPG, PNG, WebP, GIF, BMP, TIFF, SVG, HEIC) — max 10MB
                </div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleImage(e.target.files?.[0])}
            />
          </div>

          <div className="admin-image-actions">
            <button className="admin-image-btn" type="button"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); fileRef.current?.click(); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Choose File
            </button>
            <span style={{ fontSize: 14, color: "var(--brand-text-muted)" }}>or enter URL below</span>
            {image && (
              <button className="admin-image-btn admin-image-btn--secondary" type="button"
                onClick={() => setImage("")}>
                Clear
              </button>
            )}
          </div>

          <div className="admin-form__row admin-form__row--single" style={{ marginTop: 16 }}>
            <div className="admin-field">
              <label className="admin-field__label">Or enter image URL</label>
              <input
                className="admin-input"
                value={image.startsWith("data:") ? "" : image}
                placeholder="https://…"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImage(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
