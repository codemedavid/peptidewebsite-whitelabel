"use client";

import { useState, useRef } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { saveProductAction, uploadProductImageAction } from "@/actions/products";
import { RESELLER_MIN_QTY } from "../checkout";
import {
  isGroupBuyPricingVisible,
  isResellerPricingVisible,
  isWholesalePricingVisible,
} from "../visibility";
import {
  VARIATION_PRESETS,
  applyVariationPreset,
  assignVariationImages,
  type VariationDraft,
} from "./variation-presets";
import { unpricedVariationNames } from "@/lib/storefront/variations";
import { resolveSelectableCategories } from "@/lib/storefront/categories";
import { assignableSortCategories } from "@/lib/storefront/sort-categories";

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

// `price` is kept as `number | string` so the input can be cleared to an empty
// string while editing (a bare `0` you can't delete is annoying); the save path
// coerces it back to a number. Shared with the preset helper.
type Variation = VariationDraft;

type VariationsEditorProps = {
  items: Variation[];
  currency: string;
  onChange: (items: Variation[]) => void;
  /** Uploads one file and resolves its hosted URL, or an error message. Injected
   *  rather than called directly so this editor stays a plain form component and
   *  the parent keeps owning every server action. */
  onUpload: (file: File) => Promise<{ url?: string; error?: string }>;
};

function VariationsEditor({ items, currency, onChange, onUpload }: VariationsEditorProps) {
  const add = () => onChange([...items, { name: "", price: "" }]);
  const upd = (i: number, patch: Partial<Variation>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const rm = (i: number) => onChange(items.filter((_, j) => j !== i));

  // Which row is mid-upload (so its thumb can show a spinner), and the last
  // failure. One message rather than one per row: uploads are sequential, and a
  // per-row error string would push the grid around while the seller works.
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState<{ done: number; total: number } | null>(null);
  const [imgErr, setImgErr] = useState("");
  const rowFileRef = useRef<HTMLInputElement | null>(null);
  const bulkFileRef = useRef<HTMLInputElement | null>(null);
  const pendingRow = useRef<number | null>(null);

  /** One row's photo. */
  const handleRowFile = async (file: File | undefined) => {
    const row = pendingRow.current;
    pendingRow.current = null;
    if (!file || row === null) return;
    setImgErr("");
    setBusyRow(row);
    const res = await onUpload(file);
    setBusyRow(null);
    if (res.error) {
      setImgErr(res.error);
      return;
    }
    if (res.url) upd(row, { image: res.url });
  };

  /**
   * Every colorway at once. Files upload one at a time (the server action takes
   * a single file, and a burst of 81 parallel requests would be throttled or
   * dropped), then assignVariationImages matches them to rows by filename.
   * A failure part-way keeps the photos that already succeeded rather than
   * discarding the whole batch — re-picking the stragglers is cheap, redoing
   * eighty uploads is not.
   */
  const handleBulkFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImgErr("");
    const picked = Array.from(files);
    const uploaded: { fileName: string; url: string }[] = [];
    let firstError = "";

    for (const [i, file] of picked.entries()) {
      setBulkBusy({ done: i, total: picked.length });
      const res = await onUpload(file);
      if (res.url) uploaded.push({ fileName: file.name, url: res.url });
      else if (res.error && !firstError) firstError = res.error;
    }

    setBulkBusy(null);
    if (uploaded.length > 0) onChange(assignVariationImages(items, uploaded));
    if (firstError) {
      setImgErr(
        `${firstError} (${uploaded.length} of ${picked.length} uploaded)`,
      );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr 130px 110px 36px",
            gap: 10,
            alignItems: "center",
          }}
        >
          {/* The option's own photo. A colorway option is unbuyable guesswork
              without one — this is the image the storefront card swipes to. */}
          <button
            type="button"
            className="admin-variation-thumb"
            title={it.image ? `Change photo for ${it.name || "this option"}` : "Add a photo"}
            aria-label={it.image ? `Change photo for ${it.name || "this option"}` : `Add a photo for ${it.name || "this option"}`}
            disabled={busyRow !== null || bulkBusy !== null}
            onClick={() => {
              pendingRow.current = i;
              rowFileRef.current?.click();
            }}
          >
            {busyRow === i ? (
              <span className="admin-variation-thumb__label">…</span>
            ) : it.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.image} alt="" />
            ) : (
              <span className="admin-variation-thumb__label">+</span>
            )}
          </button>
          <input
            className="admin-input"
            placeholder="Variation (e.g. 5mg)"
            value={it.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => upd(i, { name: e.target.value })}
          />
          <input
            className="admin-input"
            type="number"
            min="0"
            placeholder={`Price (${currency})`}
            value={it.price}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              upd(i, { price: e.target.value })
            }
          />
          <input
            className="admin-input"
            type="number"
            min="0"
            step="1"
            // Blank = this option shares the base product stock. A number tracks
            // its own inventory (see effectiveStock in lib/storefront/inventory).
            placeholder="Stock (shared)"
            title="Leave blank to share the product's stock; enter a number to track this option separately."
            value={it.stock ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              upd(i, { stock: e.target.value })
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
      {/* One picker reused by every row — 81 mounted <input type="file"> elements
          would be 81 nodes for a control only one row uses at a time. */}
      <input
        ref={rowFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          void handleRowFile(e.target.files?.[0]);
          // Clear it, or re-picking the same file fires no change event.
          e.target.value = "";
        }}
      />
      <input
        ref={bulkFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          void handleBulkFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {imgErr && (
        <div className="admin-form__hint" role="alert" style={{ color: "var(--sf-danger, #b42318)" }}>
          {imgErr}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button className="admin-image-btn admin-image-btn--secondary" onClick={add}>
          + Add variation
        </button>
        {items.length > 1 && (
          <button
            className="admin-image-btn admin-image-btn--secondary"
            disabled={bulkBusy !== null || busyRow !== null}
            title="Upload many photos at once — each file is matched to the option whose name it shares (silk-barbie.jpg → Silk Barbie)."
            onClick={() => bulkFileRef.current?.click()}
          >
            {bulkBusy
              ? `Uploading ${bulkBusy.done + 1} of ${bulkBusy.total}…`
              : "🖼️ Upload photos for all options"}
          </button>
        )}
        {VARIATION_PRESETS.map((preset) => {
          // Already in the list → the button would be a no-op, so retire it
          // rather than leave a control that silently does nothing.
          const used = items.some(
            (it) => it.name.trim().toLowerCase() === preset.toLowerCase(),
          );
          if (used) return null;
          return (
            <button
              key={preset}
              className="admin-image-btn admin-image-btn--secondary"
              onClick={() => onChange(applyVariationPreset(items, preset))}
            >
              + {preset}
            </button>
          );
        })}
      </div>
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
  const { products, setProducts, categories, sortCategories, toast } = useStore();

  const isEdit = !!initial?.id;
  const [name, setName]             = useState<string>(initial?.name || "");
  const [description, setDesc]      = useState<string>(initial?.description || "");
  const [category, setCategory]     = useState<string>(
    initial?.category || resolveSelectableCategories(categories)[0].id,
  );
  // Optional, unlike Category: a product with no sort group is a normal state
  // (it lists after the grouped ones), so this never blocks Save.
  const [sortCategory, setSortCategory] = useState<string>(initial?.sortCategory || "");
  const [price, setPrice]           = useState<number | string>(initial?.price ?? 0);
  const [purity, setPurity]         = useState<number | string>(
    initial?.purity?.replace("%", "") || "99",
  );
  const [molWeight, setMolWeight]   = useState<string>(initial?.molecularWeight || "");
  const [cas, setCas]               = useState<string>(initial?.cas || "");
  const [storage, setStorage]       = useState<string>(initial?.storage || "Store at -20°C");
  const [sequence, setSequence]     = useState<string>(initial?.sequence || "");
  // Order Ratio Control classification. "" = auto (the ratio engine's name
  // heuristic decides); peptide / bacWater / other override it explicitly.
  const [productClass, setProductClass] = useState<"" | "peptide" | "bacWater" | "other">(
    initial?.productClass || "",
  );
  const [isSet, setIsSet]           = useState<boolean>(initial?.isSet || false);
  const [setItems, setSetItems]     = useState<Inclusion[]>(initial?.inclusions || []);
  const [variations, setVariations] = useState<Variation[]>(initial?.variations || []);
  const [stock, setStock]           = useState<number | string>(initial?.stock ?? 0);
  const [featured, setFeatured]     = useState<boolean>(initial?.featured || false);
  const [available, setAvailable]   = useState<boolean>(initial?.available !== false);
  const [freeShipping, setFreeShipping] = useState<boolean>(initial?.freeShipping === true);
  // "Made to order": the item is manufactured after the order, so it sells with
  // no inventory (see lib/storefront/made-to-order). Only offered when the
  // operator granted the feature — but the STATE is seeded from the product
  // either way, so an unentitled owner editing a previously-marked product
  // saves it back unchanged instead of silently clearing the flag.
  const [madeToOrder, setMadeToOrder] = useState<boolean>(initial?.madeToOrder === true);
  const [discount, setDiscount]     = useState<number | string>(initial?.discountPrice ?? 0);
  const [discountOn, setDiscountOn] = useState<boolean>(initial?.discountEnabled || false);
  // Group Buy product: lists under the storefront's Group Buy section (priced by
  // gbPrice) instead of on-hand. gbPrice is the per-unit group-buy price.
  const [isGroupBuy, setIsGroupBuy] = useState<boolean>(initial?.productType === "gb");
  const [gbPrice, setGbPrice]       = useState<number | string>(initial?.gbPrice ?? 0);
  const [resellerVials, setResellerVials] = useState<number | string>(initial?.reseller?.vialsOnly ?? 0);
  const [resellerSet, setResellerSet]     = useState<number | string>(initial?.reseller?.completeSet ?? 0);
  const [resellerMin, setResellerMin]     = useState<number | string>(initial?.reseller?.minQty ?? RESELLER_MIN_QTY);
  // Wholesale (MOQ) pricing. Never auto-enabled: a product that carries no
  // config starts OFF, so granting the feature cannot change what an existing
  // catalogue charges until the owner opts each product in.
  const [wholesaleOn, setWholesaleOn]   = useState<boolean>(initial?.wholesale?.enabled === true);
  const [wholesaleMoq, setWholesaleMoq] = useState<number | string>(initial?.wholesale?.moq ?? "");
  const [wholesalePrice, setWholesalePrice] = useState<number | string>(initial?.wholesale?.price ?? "");
  const [image, setImage]           = useState<string>(initial?.image || "");
  const [imageDrag, setImageDrag]   = useState<boolean>(false);
  const [uploading, setUploading]   = useState<boolean>(false);
  const [uploadErr, setUploadErr]   = useState<string>("");
  const [saving, setSaving]         = useState<boolean>(false);

  const currency = brand.currency || "₱";
  const fileRef = useRef<HTMLInputElement>(null);
  // A named variation with no price would save as 0 (`Number("") || 0`) and the
  // storefront would sell it for nothing — one click of a preset button is
  // enough to create that row, so saving is blocked until every option is priced.
  const unpriced = unpricedVariationNames(variations);
  // Wholesale validation. An enabled rule needs BOTH a positive MOQ and a
  // positive price — a half-filled rule is blocked rather than saved silently,
  // because the mapping layer would drop it and the owner would believe
  // wholesale was live. Numbers typed while the toggle is OFF are kept and
  // saved, so switching it back on restores them; only an ENABLED rule blocks.
  const wholesaleMoqNum = Number(wholesaleMoq) || 0;
  const wholesalePriceNum = Number(wholesalePrice) || 0;
  const wholesaleError = !wholesaleOn
    ? ""
    : wholesaleMoqNum <= 0
      ? "Set a minimum order quantity above 0 to turn wholesale pricing on."
      : wholesalePriceNum <= 0
        ? "Set a wholesale price above 0 to turn wholesale pricing on."
        : "";
  // A wholesale price at or above the retail price is a warning, not a block —
  // it saves, but it will never apply: bulk can only ever LOWER a unit price.
  //
  // Compare against the LOWEST price a unit could actually pay, not the base
  // Price field. A product priced entirely through variations keeps a base price
  // of 0, so comparing against it warned "not below the ₱0 retail price" for
  // every valid configuration — and the engine compares per variation anyway.
  const variationPrices = variations
    .map((v) => Number(v.price) || 0)
    .filter((n) => n > 0);
  const lowestRetail = variationPrices.length
    ? Math.min(...variationPrices)
    : Number(price) || 0;
  const wholesaleWarning =
    wholesaleOn && !wholesaleError && lowestRetail > 0 && wholesalePriceNum >= lowestRetail
      ? `This is not below the ${currency}${lowestRetail.toLocaleString()} ${
          variationPrices.length ? "cheapest option" : "retail"
        } price, so it will never apply${variationPrices.length ? " to that option" : ""}.`
      : "";
  const canSave = !!(
    name.trim() &&
    description.trim() &&
    category &&
    Number(price) >= 0 &&
    unpriced.length === 0 &&
    !wholesaleError
  );

  // Real categories the owner can assign (the synthetic "all" tab is a filter,
  // not an assignable category). Falls back to a single "Uncategorized" entry
  // when the tenant has none, so deleting every category can't leave Save
  // permanently disabled with no product ever addable — see categories.ts.
  const selectableCats = resolveSelectableCategories(categories);
  // When editing a product whose category was since deleted, `category` holds an
  // id that no longer exists in the list. Keep it visible/selectable so touching
  // the dropdown doesn't silently reassign the product to a different category.
  const categoryOrphaned = !!category && !selectableCats.some((c) => c.id === category);

  // Sort groups the owner defined (built-ins are behaviors, not buckets). Same
  // orphan rule as above: a group deleted after this product was filed stays
  // selectable so opening the form can't silently refile it.
  const assignableSortCats = assignableSortCategories(sortCategories);
  const sortCategoryOrphaned =
    !!sortCategory && !assignableSortCats.some((c) => c.id === sortCategory);

  // Upload the chosen file to the tenant's ImageKit folder (server action) and
  // store the returned hosted URL. No more base64 in the DB — and if ImageKit
  // isn't configured the action returns a clear message we surface inline.
  /**
   * Upload one per-variation photo and hand back its hosted URL.
   *
   * Shares the product image action (and so its 10 MB cap, ImageKit folder and
   * media-library bookkeeping) but returns the result instead of setting state:
   * the variations editor owns its own busy/error display, and the bulk path
   * needs to await each file in turn.
   */
  const uploadVariationImage = async (
    file: File,
  ): Promise<{ url?: string; error?: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      // UploadImageResult is a union ({url} | {error}), so narrow rather than
      // reaching for an optional field that only exists on one arm.
      const res = await uploadProductImageAction(fd);
      if ("url" in res && res.url) return { url: res.url };
      return {
        error: ("error" in res && res.error) || "Upload failed — please try again.",
      };
    } catch {
      return { error: "Upload failed — please try again." };
    }
  };

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadErr("Please choose an image file.");
      return;
    }
    setUploadErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadProductImageAction(fd);
      if ("url" in res) {
        setImage(res.url);
      } else {
        setUploadErr(res.error);
      }
    } catch {
      setUploadErr("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!canSave || saving) return;
    const product: Product = {
      id: initial?.id || `p${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      category,
      ...(sortCategory ? { sortCategory } : {}),
      price: Number(price) || 0,
      currency,
      purity: purity ? `${purity}%` : "",
      molecularWeight: molWeight,
      cas,
      storage,
      sequence,
      ...(productClass ? { productClass } : {}),
      isSet,
      inclusions: setItems,
      variations: variations
        .map((v) => {
          const base = { name: v.name.trim(), price: Number(v.price) || 0 };
          // Forward a per-variation stock ONLY when the seller entered one; a
          // blank field stays untracked (shares the base stock). Mirrors
          // normalizeProductInput so the client and server agree.
          const s = v.stock;
          const tracked = typeof s === "number" || (typeof s === "string" && s.trim() !== "");
          const withStock = tracked
            ? { ...base, stock: Math.max(0, Math.floor(Number(s) || 0)) }
            : base;
          // Same opt-in rule for the option's photo: send it only when there is
          // one. The server re-validates it to http(s) (cleanVariations), so a
          // pasted junk value is dropped rather than stored.
          const image = (v.image ?? "").trim();
          return image ? { ...withStock, image } : withStock;
        })
        .filter((v) => v.name),
      stock: Number(stock) || 0,
      featured,
      available,
      freeShipping,
      madeToOrder,
      discountPrice: discountOn ? Number(discount) || 0 : 0,
      discountEnabled: discountOn,
      productType: isGroupBuy ? "gb" : "onhand",
      gbPrice: isGroupBuy ? Number(gbPrice) || 0 : 0,
      // Carried through untouched — this editor has no control for either flag
      // (they're set in Group Buys → Pricing). Omitting them made every save here
      // silently put a "not available" product back on sale, because the payload
      // is the WHOLE product: a missing key reads as "cleared", not "unchanged".
      purchasable: initial?.purchasable !== false,
      priceOnRequest: initial?.priceOnRequest === true,
      reseller: {
        vialsOnly: Number(resellerVials) || 0,
        completeSet: Number(resellerSet) || 0,
        minQty: Number(resellerMin) || 0,
      },
      // Sent whole so the numbers round-trip even while the toggle is off;
      // cleanWholesale drops the key when either number is missing.
      wholesale: {
        enabled: wholesaleOn,
        moq: wholesaleMoqNum,
        price: wholesalePriceNum,
      },
      image: image || null,
    };

    setSaving(true);
    try {
      const res = await saveProductAction(product);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      // The server returns the canonical product (with its DB id, which differs
      // from the temporary client id on create). Reconcile local state by it.
      const saved = res.product;
      setProducts((prev) => {
        const i = prev.findIndex((p) => p.id === product.id || (isEdit && p.id === initial?.id));
        if (i >= 0) {
          const next = [...prev];
          next[i] = saved;
          return next;
        }
        return [...prev, saved];
      });
      onSaved(saved);
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
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
        <button className="admin-form__save" onClick={save} disabled={!canSave || saving}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
          {saving ? "Saving…" : "Save"}
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
                {categoryOrphaned && (
                  <option value={category}>(removed) {category}</option>
                )}
                {selectableCats.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Sort Category</label>
              <select className="admin-select" value={sortCategory}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortCategory(e.target.value)}>
                <option value="">— None —</option>
                {/* A product whose sort group was deleted keeps pointing at it
                    until the owner chooses again, so the dropdown never silently
                    reassigns it (same rule as Category above). */}
                {sortCategoryOrphaned && (
                  <option value={sortCategory}>(removed) {sortCategory}</option>
                )}
                {assignableSortCats.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <p className="admin-field__hint">
                Groups this product in your shop&rsquo;s Sort menu. Optional — unassigned
                products still show, just after the grouped ones.
              </p>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Order ratio class</label>
              <select className="admin-select" value={productClass}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setProductClass(e.target.value as "" | "peptide" | "bacWater" | "other")}>
                <option value="">Auto (detect by name)</option>
                <option value="peptide">Peptide</option>
                <option value="bacWater">Bacteriostatic water</option>
                <option value="other">Other (accessory)</option>
              </select>
              <p className="admin-field__hint">
                Used by Order Ratio Control to pair peptides with bac water.
              </p>
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

        {/* ---------- Variations ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">🧬 Variations</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Offer the same product in multiple options — e.g. dosages or sizes like
            5mg / 10mg, or the shortcuts below for selling vials on their own
            versus the complete set — each with its own price ({currency}).
            Customers pick the option on the storefront. Leave empty to sell the
            product as a single option at the base price above.
          </div>
          <VariationsEditor
            items={variations}
            currency={currency}
            onChange={setVariations}
            onUpload={uploadVariationImage}
          />
          {unpriced.length > 0 && (
            <div
              className="admin-field__hint"
              role="alert"
              style={{ marginTop: 12, color: "var(--danger, #b42318)" }}
            >
              Set a price for {unpriced.join(", ")} before saving — an option
              without a price would be sold for free.
            </div>
          )}
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
                <span title="Pins this product to the very top of your catalog">
                  ⭐ Featured — pin to top
                </span>
              </label>
              <label className="admin-check">
                <input type="checkbox" checked={available}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAvailable(e.target.checked)} />
                <span>✅ Available</span>
              </label>
              <label className="admin-check">
                <input type="checkbox" checked={freeShipping}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFreeShipping(e.target.checked)} />
                <span>Free shipping</span>
              </label>
              {brand.madeToOrderEntitled === true && (
                <label className="admin-check">
                  <input type="checkbox" checked={madeToOrder}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMadeToOrder(e.target.checked)} />
                  <span title="Made after the order is placed — this product sells with no stock: never 'Sold out', no quantity cap, and confirming an order does not deduct inventory.">
                    🧵 Made to order — no stock needed
                  </span>
                </label>
              )}
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

        {/* ---------- Group Buy ---------- */}
        {/* Gated on the Group Buy MODULE (groupbuy.module), the same entitlement
            behind the Group Buys manager view. The checkbox writes
            productType:"gb", which the Group Buy page, the on-hand shelf and the
            on-hand gate all read — so this must not render for a tenant without
            the feature. See isGroupBuyPricingVisible. */}
        {isGroupBuyPricingVisible(brand) && (
        <div className="admin-form__card">
          <h2 className="admin-form__section">🛒 Group Buy</h2>
          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Group Buy Price ({currency})</label>
              <NumberField value={gbPrice} onChange={setGbPrice} min={0} disabled={!isGroupBuy} />
              <div className="admin-field__hint">
                {isGroupBuy
                  ? "Shown in the storefront's Group Buy section with the on-hand price and the saving."
                  : "Off — this product lists as on-hand (ships now)."}
              </div>
            </div>
            <div className="admin-form__inline-row" style={{ alignSelf: "start", paddingTop: 24 }}>
              <label className="admin-check">
                <input type="checkbox" checked={isGroupBuy}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsGroupBuy(e.target.checked)} />
                <span>🛒 Group Buy product</span>
              </label>
            </div>
          </div>
        </div>
        )}

        {/* ---------- Wholesale (MOQ) Pricing ---------- */}
        {/* Gated on the wholesale-pricing entitlement (storefront.reseller.wholesale,
            ANDed with its Reseller parent). Independent of the reseller page below:
            a tenant can price wholesale on the regular storefront without one. */}
        {isWholesalePricingVisible(brand) && (
        <div className="admin-form__card">
          <h2 className="admin-form__section">📦 Wholesale Pricing</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Sell this product at a lower unit price once the customer orders enough of
            it. The normal price is the Price field above (and each option&rsquo;s own
            price) — this replaces it only once the minimum is reached.
          </div>

          <label className="admin-check" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={wholesaleOn}
              onChange={(e) => setWholesaleOn(e.target.checked)}
            />
            <span>Enable wholesale pricing for this product</span>
          </label>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Minimum order quantity (units)</label>
              <NumberField value={wholesaleMoq} onChange={setWholesaleMoq} min={0} />
              <div className="admin-field__hint">
                Minimum combined quantity of this product required to unlock wholesale
                pricing.
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Wholesale unit price ({currency})</label>
              <NumberField value={wholesalePrice} onChange={setWholesalePrice} min={0} />
              <div className="admin-field__hint">
                This price applies to the entire quantity once the MOQ is reached.
              </div>
            </div>
          </div>

          {variations.length > 0 && (
            <div className="admin-field__hint" style={{ marginTop: 12 }}>
              All {variations.length} options of this product count toward the same
              minimum — {variations.slice(0, 4).map((v) => v.name.trim() || "?").join(" + ")}
              {variations.length > 4 ? " …" : ""} add up together.
            </div>
          )}

          {wholesaleError && (
            <div
              className="admin-field__hint"
              role="alert"
              style={{ marginTop: 12, color: "var(--danger, #b42318)" }}
            >
              {wholesaleError}
            </div>
          )}
          {wholesaleWarning && (
            <div className="admin-field__hint" style={{ marginTop: 12 }}>
              ⚠️ {wholesaleWarning}
            </div>
          )}
          {wholesaleOn && !wholesaleError && (
            <div className="admin-field__hint" style={{ marginTop: 12, lineHeight: 1.7 }}>
              Under {wholesaleMoqNum.toLocaleString()} units → {currency}
              {(Number(price) || 0).toLocaleString()} each
              <br />
              {wholesaleMoqNum.toLocaleString()} units or more → {currency}
              {wholesalePriceNum.toLocaleString()} each
            </div>
          )}
        </div>
        )}

        {/* ---------- Reseller Pricing ---------- */}
        {/* Entitlement-gated, same as the Reseller Portal manager view. Saved
            prices are preserved while hidden — the state above still seeds from
            `initial`, so the save path round-trips them untouched. */}
        {isResellerPricingVisible(brand) && (
        <div className="admin-form__card">
          <h2 className="admin-form__section">🤝 Reseller / Wholesale Pricing</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Wholesale prices shown on the storefront card alongside the retail price, and
            applied in the cart once a single product reaches the minimum order below.
            Leave a price at 0 to hide that tier; leave the minimum blank to use the
            default of {RESELLER_MIN_QTY}.
          </div>

          <div className="admin-form__row">
            <div className="admin-field">
              <label className="admin-field__label">Vials only ({currency})</label>
              <NumberField value={resellerVials} onChange={setResellerVials} min={0} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Complete set ({currency})</label>
              <NumberField value={resellerSet} onChange={setResellerSet} min={0} />
            </div>
          </div>

          <div className="admin-form__row admin-form__row--single" style={{ marginTop: 4 }}>
            <div className="admin-field">
              <label className="admin-field__label">Minimum order for wholesale (units)</label>
              <NumberField value={resellerMin} onChange={setResellerMin} min={1} />
            </div>
          </div>
        </div>
        )}

        {/* ---------- Product Image ---------- */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">🖼️ Product Image</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            Upload a product image (optional). This will appear on the customer-facing site.
          </div>

          <div
            className={`admin-image-drop ${imageDrag ? "is-dragover" : ""}`}
            onClick={() => { if (!uploading) fileRef.current?.click(); }}
            onDragOver={(e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setImageDrag(true); }}
            onDragLeave={() => setImageDrag(false)}
            onDrop={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setImageDrag(false);
              if (!uploading) void handleImage(e.dataTransfer.files?.[0]);
            }}
          >
            {uploading ? (
              <>
                <div className="admin-image-drop__icon">
                  <span className="sf-page-spinner__ring" style={{ width: 28, height: 28 }} />
                </div>
                <div className="admin-image-drop__title">Uploading…</div>
                <div className="admin-image-drop__sub">Sending to ImageKit</div>
              </>
            ) : image ? (
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handleImage(e.target.files?.[0])}
            />
          </div>

          {uploadErr && (
            <div
              className="admin-field__hint"
              style={{ marginTop: 10, color: "#c0392b" }}
              role="alert"
            >
              {uploadErr}
            </div>
          )}

          <div className="admin-image-actions">
            <button className="admin-image-btn" type="button" disabled={uploading}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); if (!uploading) fileRef.current?.click(); }}>
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
