"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { imageUrl } from "@/lib/media/image-url";
import { buildCategorySections, moveToIndex } from "@/lib/storefront/category-sections";
import { saveCategoryProductOrderAction } from "@/actions/storefront-admin";
import { useSortableList } from "./useSortableList";
import "./category-arranger.css";

/** Save shortly after the owner stops moving things — one write per burst. */
const SAVE_DELAY_MS = 500;
const THUMB_PX = 80;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Drag the grip, or use the arrows",
  pending: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved — live on your store",
  error: "Couldn't save — try again",
};

/**
 * Admin → Categories → "Arrange products": the order of products INSIDE one
 * category on the category-sections storefront. Drag (mouse or touch), ↑/↓, or
 * jump to the top / bottom. Saves itself (debounced, one request at a time,
 * always the latest order) into branding.config.categoryProductOrder[id].
 */
export function AdminCategoryProductsArranger({
  categoryId,
  label,
  brand,
  onClose,
}: {
  categoryId: string;
  label: string;
  brand: Brand;
  onClose: () => void;
}) {
  const { products, categories, setTweak, toast } = useStore();
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [order, setOrder] = useState<string[]>(() => {
    const section = buildCategorySections(products, categories, brand.categoryProductOrder).find(
      (s) => s.id === categoryId,
    );
    return (section?.products ?? []).map((p) => p.id);
  });
  const [state, setState] = useState<SaveState>("idle");

  // Latest values for the async save chain (never a stale closure).
  const latest = useRef({ order, brand });
  latest.current = { order, brand };
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const dirty = useRef(false);

  const save = () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return chain.current;
    dirty.current = false;
    chain.current = chain.current.then(async () => {
      setState("saving");
      try {
        const res = await saveCategoryProductOrderAction(categoryId, latest.current.order);
        if ("error" in res) {
          dirty.current = true;
          setState("error");
          toast(res.error);
          return;
        }
        // The storefront behind the admin follows at once.
        setTweak("categoryProductOrder", {
          ...(latest.current.brand.categoryProductOrder ?? {}),
          [categoryId]: res.order,
        });
        setState(dirty.current ? "pending" : "saved");
      } catch {
        dirty.current = true;
        setState("error");
        toast("Couldn't save the order — please sign in again and retry.");
      }
    });
    return chain.current;
  };

  const apply = (next: string[]) => {
    setOrder(next);
    dirty.current = true;
    setState("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const moveTo = (id: string, to: number) => apply(moveToIndex(order, id, to));
  const sortable = useSortableList({ ids: order, onMove: moveTo });

  const close = () => {
    void save();
    onClose();
  };

  // Escape closes; a pending change is flushed rather than lost on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);
  useEffect(() => () => void save(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const last = order.length - 1;

  return (
    <div className="admin-modal" onClick={close}>
      <div
        className="admin-modal__card admin-arrange"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-arrange-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-arrange__head">
          <div>
            <h2 id="admin-arrange-title" className="admin-modal__title">Arrange “{label}”</h2>
            <p className={`admin-arrange__status is-${state}`} role="status" aria-live="polite">
              {SAVE_LABEL[state]}
            </p>
          </div>
          <button type="button" className="admin-btn" onClick={close}>Done</button>
        </header>

        {order.length === 0 ? (
          <p className="admin-arrange__empty">No products in this category yet.</p>
        ) : (
          <ol className="admin-arrange__list">
            {order.map((id, i) => {
              const p = productsById.get(id);
              if (!p) return null;
              const marker = sortable.dropMarker(id);
              return (
                <li
                  key={id}
                  ref={sortable.rowRef(id)}
                  className={`admin-arrange__row${sortable.dragId === id ? " is-dragging" : ""}${marker ? ` is-drop-${marker}` : ""}`}
                >
                  <button
                    type="button"
                    className="admin-arrange__grip"
                    aria-label={`Drag ${p.name}`}
                    title="Drag to reorder"
                    {...sortable.handleProps(id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="9" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" />
                      <circle cx="15" cy="6" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </button>
                  <span className="admin-order__num" aria-label={`Position ${i + 1}`}>{i + 1}</span>
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="admin-arrange__thumb" src={imageUrl(p.image, { width: THUMB_PX })} alt="" width={40} height={40} />
                  ) : (
                    <span className="admin-arrange__thumb" aria-hidden="true" />
                  )}
                  <span className="admin-arrange__name">
                    {p.name}
                    {p.available === false && <em className="admin-arrange__tag">Hidden</em>}
                  </span>
                  <span className="admin-arrange__moves">
                    <button type="button" className="admin-icon-btn admin-order__btn" aria-label={`Move ${p.name} to the top`} title="Move to top" disabled={i === 0} onClick={() => moveTo(id, 0)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 13 12 7 6 13" /><line x1="6" y1="4" x2="18" y2="4" /></svg>
                    </button>
                    <button type="button" className="admin-icon-btn admin-order__btn" aria-label={`Move ${p.name} up`} title="Move up" disabled={i === 0} onClick={() => moveTo(id, i - 1)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                    </button>
                    <button type="button" className="admin-icon-btn admin-order__btn" aria-label={`Move ${p.name} down`} title="Move down" disabled={i === last} onClick={() => moveTo(id, i + 1)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                    <button type="button" className="admin-icon-btn admin-order__btn" aria-label={`Move ${p.name} to the bottom`} title="Move to bottom" disabled={i === last} onClick={() => moveTo(id, last)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 11 12 17 18 11" /><line x1="6" y1="20" x2="18" y2="20" /></svg>
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
