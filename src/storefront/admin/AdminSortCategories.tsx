"use client";

// Admin → Product Sort Categories: the owner edits the catalog's "Sort: …"
// dropdown here. Deliberately built on the same bones as AdminCategoriesManager
// (drag handle to reorder, inline label edit committed on blur, delete with an
// orphan warning) so the two screens feel like one tool — but this list drives
// SORTING, while Categories drives the filter chips.
//
// Two row kinds, and the difference matters:
//   • Built-in — runs code (A–Z, price, best sellers, new arrivals). Renamable
//     and reorderable, but its behavior is fixed, so the kind is read-only.
//   • Group    — the owner's own bucket ("Weight Loss"). Products are assigned
//     to it from the product form; picking it floats those products to the top.
//
// Every write goes through setSortCategories → saveSortCategoriesAction, which
// re-normalizes server-side. Reordering here re-orders the live storefront.

import { useEffect, useRef, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import type { SortCategory, SortCategoryKind } from "@/lib/storefront/sort-categories";

/** The behaviors an owner can add, worded for a shop owner rather than a
 *  developer. "group" is handled separately (it needs a name, not a behavior),
 *  so it is deliberately absent here. */
const BUILT_IN_KINDS: { kind: Exclude<SortCategoryKind, "group">; label: string }[] = [
  { kind: "name", label: "Name (A–Z)" },
  { kind: "price-asc", label: "Price: Low to High" },
  { kind: "price-desc", label: "Price: High to Low" },
  { kind: "best-sellers", label: "Best Sellers" },
  { kind: "newest", label: "New Arrivals" },
];

const kindLabel = (kind: SortCategoryKind): string =>
  BUILT_IN_KINDS.find((k) => k.kind === kind)?.label ?? "Product group";

export function AdminSortCategories({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { sortCategories, setSortCategories, products } = useStore();

  const [cats, setCats] = useState<SortCategory[]>(sortCategories);
  // The freshly-added row whose name input should take focus, so a new row is
  // immediately typable instead of reading as an inert "New Category" box.
  const [focusId, setFocusId] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const el = inputRefs.current.get(focusId);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusId(null);
  }, [focusId, cats]);

  // Products currently assigned to a group — shown per row, and quoted in the
  // delete confirm so the owner knows the storefront impact before deleting.
  const count = (id: string) => products.filter((p) => p.sortCategory === id).length;

  const commit = (next: SortCategory[]) => {
    setCats(next);
    setSortCategories(next);
  };

  // Suffix a random token so two adds in the same millisecond can't collide —
  // a duplicate id is dropped by normalizeSortCategories, which would make the
  // row the owner just added silently vanish.
  const newId = (prefix: string) =>
    `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const addGroup = () => {
    const id = newId("sc");
    commit([...cats, { id, label: "New Category", kind: "group", enabled: true }]);
    setFocusId(id);
  };

  const addBuiltIn = (kind: Exclude<SortCategoryKind, "group">) => {
    const id = newId(`${kind}_`);
    const label = BUILT_IN_KINDS.find((k) => k.kind === kind)?.label ?? kind;
    commit([...cats, { id, label, kind, enabled: true }]);
    setFocusId(id);
  };

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

  const move = (id: string, delta: number) => {
    const from = cats.findIndex((c) => c.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= cats.length) return;
    const next = [...cats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  // Type freely; persist once on blur (a DB round-trip per keystroke would be
  // both slow and a good way to store a half-typed name).
  const editLabel = (id: string, label: string) =>
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));

  const commitLabel = (id: string) => {
    const next = cats.map((c) =>
      c.id === id && !c.label.trim() ? { ...c, label: "New Category" } : c,
    );
    setCats(next);
    setSortCategories(next);
  };

  const toggleEnabled = (id: string) =>
    commit(cats.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));

  const remove = (id: string) => {
    const cat = cats.find((c) => c.id === id);
    const orphans = cat?.kind === "group" ? count(id) : 0;
    const note =
      orphans > 0
        ? ` ${orphans} product${orphans === 1 ? "" : "s"} will stay in your catalog and move to the end of the list.`
        : "";
    if (!confirm(`Remove “${cat?.label ?? id}” from the sort menu?${note}`)) return;
    commit(cats.filter((c) => c.id !== id));
  };

  void brand;

  const enabledCount = cats.filter((c) => c.enabled).length;

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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span>Product Sort Categories</span>
          </h1>
          <button className="admin-btn" onClick={addGroup}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Category
          </button>
        </div>

        <p className="admin-hint">
          This is the “Sort” menu on your shop page, top to bottom. A{" "}
          <strong>category</strong> is your own group — assign products to it when you add
          or edit them, and choosing it brings those products to the front. A{" "}
          <strong>built-in</strong> sorts the whole catalog automatically. Turning one off
          hides it from the menu; it never hides your products.
        </p>

        <div className="admin-orders__bulkbar">
          <span className="admin-cat-row__count">
            {enabledCount} of {cats.length} showing in the menu
          </span>
          <div className="admin-sortcat__adds">
            {BUILT_IN_KINDS.map((k) => {
              const already = cats.some((c) => c.kind === k.kind);
              return (
                <button
                  key={k.kind}
                  className="admin-btn admin-btn--ghost"
                  onClick={() => addBuiltIn(k.kind)}
                  disabled={already}
                  title={already ? `${k.label} is already in your menu` : `Add ${k.label} to the menu`}
                >
                  + {k.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="admin-cats-mgr">
          {cats.map((c, i) => (
            <div
              key={c.id}
              className={`admin-cat-row${dragOverId === c.id ? " is-drop-target" : ""}${
                c.enabled ? "" : " is-disabled"
              }`}
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
              <label
                className="admin-check"
                title={c.enabled ? "Showing in the menu" : "Hidden from the menu"}
              >
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={() => toggleEnabled(c.id)}
                  aria-label={`Show ${c.label || c.id} in the sort menu`}
                />
              </label>

              <span
                className="admin-cat-row__handle"
                title="Drag to reorder"
                aria-label="Drag to reorder"
                draggable
                onDragStart={() => {
                  dragId.current = c.id;
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDragOverId(null);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                </svg>
              </span>

              <div className="admin-cat-row__name">
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.set(c.id, el);
                    else inputRefs.current.delete(c.id);
                  }}
                  value={c.label}
                  placeholder="Menu label"
                  onChange={(e) => editLabel(c.id, e.target.value)}
                  onBlur={() => commitLabel(c.id)}
                />
              </div>

              <span className="admin-cat-row__id">{kindLabel(c.kind)}</span>
              <span className="admin-cat-row__count">
                {c.kind === "group" ? `${count(c.id)} products` : "whole catalog"}
              </span>

              {/* Keyboard/touch-reachable reordering — drag alone strands anyone
                  not using a mouse, and this order IS the live storefront. */}
              <button
                className="admin-icon-btn"
                title="Move up"
                aria-label={`Move ${c.label || c.id} up`}
                disabled={i === 0}
                onClick={() => move(c.id, -1)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              </button>
              <button
                className="admin-icon-btn"
                title="Move down"
                aria-label={`Move ${c.label || c.id} down`}
                disabled={i === cats.length - 1}
                onClick={() => move(c.id, 1)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <button
                className="admin-icon-btn admin-icon-btn--danger"
                title="Remove from the sort menu"
                onClick={() => remove(c.id)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>
          ))}

          {cats.length === 0 && (
            <div className="admin-empty-set" style={{ gridColumn: "1 / -1" }}>
              Your sort menu is empty — shoppers will see the default Name and Price
              options until you add your own.
              <button className="admin-empty-set__cta" onClick={addGroup}>
                + Add your first category
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
