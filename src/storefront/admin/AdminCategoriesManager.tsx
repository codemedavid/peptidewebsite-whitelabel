"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Brand, Category, Product } from "../types";
import { useStore } from "../store";
import { uploadStorefrontImageAction } from "@/actions/media";
import { imageUrl } from "@/lib/media/image-url";
import { categoryImage, withCategoryImage } from "@/lib/storefront/categories";
import { isShowcaseLayout } from "@/lib/storefront/home-layout";
import { groupByCategoryOrder } from "@/lib/storefront/product-order";
import { saveProductsFollowCategoriesAction } from "@/actions/storefront-admin";
import {
  countByCategory,
  moveToIndex,
  OTHER_SECTION_ID,
  OTHER_SECTION_LABEL,
} from "@/lib/storefront/category-sections";
import { useSortableList } from "./useSortableList";
import { AdminCategoryProductsArranger } from "./AdminCategoryProductsArranger";

/** Matches the server's cap (uploadStorefrontImageAction), checked here first so
 *  an oversized pick fails instantly instead of after a long upload. */
const MAX_CATEGORY_IMAGE_BYTES = 10 * 1024 * 1024;
const THUMB_PX = 96;

/**
 * The round picture a category shows on the SHOWCASE home (its badge). Click
 * to upload the owner's own; × goes back to automatic — the first product photo
 * in the category, which is also what is previewed (tagged "Auto") until then.
 */
function CategoryImagePicker({
  category,
  autoImage,
  onChange,
}: {
  category: Category;
  autoImage: string | undefined;
  onChange: (image: string | undefined) => void;
}) {
  const { toast } = useStore();
  const [uploading, setUploading] = useState(false);
  const custom = categoryImage(category.image);
  const shown = custom ?? autoImage;
  const name = category.label || category.id;

  const upload = async (file: File | undefined | null) => {
    if (!file || uploading) return;
    if (file.size > MAX_CATEGORY_IMAGE_BYTES) {
      toast("That image is over 10 MB — please pick a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "category");
      const res = await uploadStorefrontImageAction(fd);
      if ("error" in res) {
        toast(`Couldn't upload the image: ${res.error}`);
        return;
      }
      const url = categoryImage(res.url);
      if (!url) {
        toast("That image is too large to store for this store. Please pick a smaller file.");
        return;
      }
      onChange(url);
      toast(`Image set for “${name}”.`);
    } catch {
      toast("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`admin-cat-img${custom ? " is-custom" : ""}${uploading ? " is-busy" : ""}`}>
      <label
        className="admin-cat-img__pick"
        title={custom ? `Change the image for ${name}` : `Upload an image for ${name}`}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(shown, { width: THUMB_PX })} alt="" width={THUMB_PX} height={THUMB_PX} />
        ) : (
          <span className="admin-cat-img__empty" aria-hidden="true">+</span>
        )}
        {!custom && shown && <span className="admin-cat-img__tag">Auto</span>}
        {uploading && <span className="admin-cat-img__busy">…</span>}
        <input
          type="file"
          accept="image/*"
          aria-label={custom ? `Change the image for ${name}` : `Upload an image for ${name}`}
          disabled={uploading}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {custom && (
        <button
          type="button"
          className="admin-cat-img__clear"
          aria-label={`Remove the image for ${name} (use the product photo)`}
          title="Remove — use the product photo"
          onClick={() => onChange(undefined)}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** The photo a category shows when the owner has uploaded none: its first
 *  product photo (same rule as the storefront's buildCategoryTiles). */
function autoCategoryImage(products: readonly Product[], id: string): string | undefined {
  return products.find((p) => p.category === id && !!p.image)?.image || undefined;
}

export function AdminCategoriesManager({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { categories, setCategories, products, setProducts, setTweak, toast } = useStore();
  // "Products follow this order" — saved the moment it is flipped, like the
  // other store switches. When on, the shop's All Products view lists products
  // category by category in the order below.
  const [follow, setFollow] = useState(brand.productsFollowCategories === true);
  const [savingFollow, setSavingFollow] = useState(false);

  const [cats, setCats] = useState<Category[]>(
    categories.filter((c) => c.id !== "all"),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The just-added category whose name input should grab focus so the owner can
  // type its name immediately (otherwise the prefilled "New Category" row reads
  // as an inert blank box).
  const [focusId, setFocusId] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Drag-to-reorder state. The order here IS the order of the chips on the public
  // storefront, so the handle has to actually move rows. dragId holds the row
  // being dragged; dragOverId is the row currently hovered (for the drop outline).
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Category sections (operator grant FEATURES.STORE_CATEGORY_SECTIONS): the
  // rows get a touch-capable drag grip and an "Arrange products" button, and
  // counts use the storefront's loose category matching. Unentitled stores see
  // this screen exactly as before.
  const sectionsOn = brand.categorySectionsEntitled === true;
  const [arranging, setArranging] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const el = inputRefs.current.get(focusId);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusId(null);
  }, [focusId, cats]);

  const toggleCat = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === cats.length) setSelected(new Set());
    else setSelected(new Set(cats.map((c) => c.id)));
  };

  // How many products would be orphaned (kept their category id but lose their
  // own chip) if these categories were deleted — surfaced in the confirm so the
  // owner knows the storefront impact before deleting.
  const orphanNote = (n: number) =>
    n > 0
      ? ` ${n} product${n === 1 ? "" : "s"} will keep their category and show only under “All Products” until reassigned.`
      : "";

  const deleteSelected = () => {
    if (!selected.size) return;
    const orphans = cats
      .filter((c) => selected.has(c.id))
      .reduce((n, c) => n + count(c.id), 0);
    if (
      !confirm(
        `Delete ${selected.size} categor${selected.size === 1 ? "y" : "ies"}?${orphanNote(orphans)}`,
      )
    )
      return;
    commit(cats.filter((c) => !selected.has(c.id)));
    setSelected(new Set());
  };

  // Persist the full set to the DB (always re-stamping the synthetic "all" tab).
  // setCategories writes through to branding.config, so this is a server round-
  // trip — call it only on meaningful commits (add / delete / blur), never on
  // every keystroke.
  const persist = (next: Category[]) =>
    setCategories([{ id: "all", label: "All Products" }, ...next]);

  // Re-group the in-memory catalog so the storefront behind the admin follows
  // a reorder at once (the server applies the same rule on the next load).
  const regroup = (next: Category[]) =>
    setProducts((prev) => groupByCategoryOrder(prev, next.map((c) => c.id)));

  const commit = (next: Category[]) => {
    setCats(next);
    persist(next);
    if (follow) regroup(next);
  };

  const flipFollow = async () => {
    if (savingFollow) return;
    const next = !follow;
    setSavingFollow(true);
    try {
      const res = await saveProductsFollowCategoriesAction(next);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setFollow(res.enabled);
      setTweak("productsFollowCategories", res.enabled);
      if (res.enabled) regroup(cats);
      toast(
        res.enabled
          ? "Products now follow your category order"
          : "Products are back to your Products arrangement (refresh to see it)",
      );
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSavingFollow(false);
    }
  };

  const addCat = () => {
    // Suffix a random token so two adds in the same millisecond (or a rapid
    // double-click) can't collide — a duplicate id would be silently dropped by
    // the server's normalizeCategories, making the freshly-added row vanish.
    const id = `cat${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    commit([...cats, { id, label: "New Category" }]);
    setFocusId(id);
  };

  // Move the dragged row to the dropped-on row's position and persist. The
  // resulting order is exactly what the public storefront renders its category
  // chips in, so reordering here re-orders the live site.
  const reorder = (targetId: string) => {
    const from = cats.findIndex((c) => c.id === dragId.current);
    const to = cats.findIndex((c) => c.id === targetId);
    dragId.current = null;
    setDragOverId(null);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...cats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  // ↑/↓ for touch screens, where native drag-and-drop does not fire.
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= cats.length) return;
    const next = [...cats];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  // Edit the name locally while the owner types — no DB write per keystroke.
  const editLabel = (id: string, label: string) =>
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));

  // On blur, default a blank name (a category with no label renders as an
  // unidentifiable blank row, and the server would fall its label back to the
  // raw id) and persist the whole set once.
  const commitLabel = (id: string) => {
    const next = cats.map((c) =>
      c.id === id && !c.label.trim() ? { ...c, label: "New Category" } : c,
    );
    setCats(next);
    persist(next);
  };

  const setImage = (id: string, image: string | undefined) =>
    commit(withCategoryImage(cats, id, image));

  const removeCat = (id: string) => {
    if (!confirm(`Delete this category?${orphanNote(count(id))}`)) return;
    commit(cats.filter((c) => c.id !== id));
  };

  const looseCounts = useMemo(
    () => (sectionsOn ? countByCategory(products, cats) : null),
    [sectionsOn, products, cats],
  );
  const count = (id: string) =>
    looseCounts ? (looseCounts.get(id) ?? 0) : products.filter((p) => p.category === id).length;
  const otherCount = looseCounts?.get(OTHER_SECTION_ID) ?? 0;

  const sortable = useSortableList({
    ids: cats.map((c) => c.id),
    onMove: (id, to) => {
      const byId = new Map(cats.map((c) => [c.id, c]));
      commit(moveToIndex(cats.map((c) => c.id), id, to).map((cid) => byId.get(cid)!));
    },
  });

  // Only the Showcase home draws category pictures, so only it gets the picker.
  const showImages = isShowcaseLayout(brand.homeLayout);

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
            <span>Categories</span>
          </h1>
          <button className="admin-btn" onClick={addCat}>
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
            Add Category
          </button>
        </div>

        <section className="hero-editor__switchrow admin-cats-follow" aria-labelledby="admin-cats-follow">
          <div>
            <h2 id="admin-cats-follow" className="hero-editor__switchrow-title">
              Products follow this order
            </h2>
            <p className="admin-cats-follow__hint">
              {follow
                ? "On — “All Products” lists the first category’s products first, then the next, in the order below. Drag the rows to change it. Inside a category, products keep your Products arrangement."
                : "Off — the order below only sets the category tabs. Turn on to also list products category by category in this order."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={follow}
            aria-label="Products follow the category order"
            disabled={savingFollow}
            className={`hero-editor__switch${follow ? " is-on" : ""}`}
            onClick={() => void flipFollow()}
          >
            <span className="hero-editor__switch-knob" />
          </button>
        </section>

        <div className="admin-orders__bulkbar">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={selected.size === cats.length && cats.length > 0}
              onChange={toggleAll}
            />
            <span>Select All ({cats.length})</span>
          </label>
          <button
            className="admin-btn admin-btn--danger-soft"
            disabled={!selected.size}
            onClick={deleteSelected}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
            Delete Selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>

        <div className="admin-cats-mgr">
          {cats.map((c, i) => (
            <div
              key={c.id}
              ref={sectionsOn ? sortable.rowRef(c.id) : undefined}
              className={`admin-cat-row${dragOverId === c.id ? " is-drop-target" : ""}${
                sectionsOn && sortable.dragId === c.id ? " is-dragging" : ""
              }${sectionsOn && sortable.dropMarker(c.id) ? ` is-drop-${sortable.dropMarker(c.id)}` : ""}`}
              onDragOver={(e) => {
                if (!dragId.current) return;
                e.preventDefault();
                setDragOverId((prev) => (prev === c.id ? prev : c.id));
              }}
              onDrop={(e) => {
                e.preventDefault();
                reorder(c.id);
              }}
            >
              <input
                type="checkbox"
                aria-label={`Select ${c.label || c.id}`}
                checked={selected.has(c.id)}
                onChange={() => toggleCat(c.id)}
              />
              <span
                className="admin-cat-row__handle"
                title="Drag to reorder"
                aria-label="Drag to reorder"
                {...(sectionsOn
                  ? sortable.handleProps(c.id)
                  : {
                      draggable: true,
                      onDragStart: () => {
                        dragId.current = c.id;
                      },
                      onDragEnd: () => {
                        dragId.current = null;
                        setDragOverId(null);
                      },
                    })}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="9" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" />
                  <circle cx="15" cy="6" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="15" cy="18" r="1.5" />
                </svg>
              </span>
              <span className="admin-order__num" aria-label={`Position ${i + 1}`}>{i + 1}</span>
              {showImages && (
                <CategoryImagePicker
                  category={c}
                  autoImage={autoCategoryImage(products, c.id)}
                  onChange={(image) => setImage(c.id, image)}
                />
              )}
              <div className="admin-cat-row__name">
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.set(c.id, el);
                    else inputRefs.current.delete(c.id);
                  }}
                  value={c.label}
                  placeholder="Category name"
                  onChange={(e) => editLabel(c.id, e.target.value)}
                  onBlur={() => commitLabel(c.id)}
                />
              </div>
              <span className="admin-cat-row__count">{count(c.id)} products</span>
              {sectionsOn && (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-cat-row__arrange"
                  onClick={() => setArranging({ id: c.id, label: c.label || c.id })}
                >
                  Arrange products
                </button>
              )}
              <span className="admin-cat-row__id">{c.id}</span>
              <span className="admin-cat-row__moves">
                <button
                  type="button"
                  className="admin-icon-btn admin-order__btn"
                  aria-label={`Move ${c.label || "category"} up`}
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="admin-icon-btn admin-order__btn"
                  aria-label={`Move ${c.label || "category"} down`}
                  title="Move down"
                  disabled={i === cats.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </span>
              <button
                className="admin-icon-btn admin-icon-btn--danger"
                title="Delete category"
                onClick={() => removeCat(c.id)}
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
          ))}
          {sectionsOn && otherCount > 0 && (
            <div className="admin-cats-other" style={{ gridColumn: "1 / -1" }}>
              <span>
                {otherCount} product{otherCount === 1 ? "" : "s"} match no category above and show under
                “{OTHER_SECTION_LABEL}” at the end of your shop. Edit a product to file it.
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setArranging({ id: OTHER_SECTION_ID, label: OTHER_SECTION_LABEL })}
              >
                Arrange
              </button>
            </div>
          )}
          {cats.length === 0 && (
            <div
              className="admin-empty-set"
              style={{ gridColumn: "1 / -1" }}
            >
              No categories yet.
              <button
                className="admin-empty-set__cta"
                onClick={addCat}
              >
                + Add your first category
              </button>
            </div>
          )}
        </div>
      </main>
      {arranging && (
        <AdminCategoryProductsArranger
          categoryId={arranging.id}
          label={arranging.label}
          brand={brand}
          onClose={() => setArranging(null)}
        />
      )}
    </div>
  );
}
