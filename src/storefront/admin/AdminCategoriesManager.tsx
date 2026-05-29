"use client";

import { useState } from "react";
import type { Brand, Category } from "../types";
import { useStore } from "../store";

export function AdminCategoriesManager({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { categories, setCategories, products } = useStore();

  const [cats, setCats] = useState<Category[]>(
    categories.filter((c) => c.id !== "all"),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleCat = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === cats.length) setSelected(new Set());
    else setSelected(new Set(cats.map((c) => c.id)));
  };

  const deleteSelected = () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} categor${selected.size === 1 ? "y" : "ies"}? Products in them will keep their category id.`)) return;
    commit(cats.filter((c) => !selected.has(c.id)));
    setSelected(new Set());
  };

  const commit = (next: Category[]) => {
    setCats(next);
    setCategories([{ id: "all", label: "All Products" }, ...next]);
  };

  const addCat = () => {
    const id = `cat${Date.now()}`;
    commit([...cats, { id, label: "New Category" }]);
  };

  const updateCat = (id: string, patch: Partial<Category>) =>
    commit(cats.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeCat = (id: string) => {
    if (
      !confirm(
        "Delete this category? Products in it will keep their category id.",
      )
    )
      return;
    commit(cats.filter((c) => c.id !== id));
  };

  const count = (id: string) =>
    products.filter((p) => p.category === id).length;

  void brand;

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
          {cats.map((c) => (
            <div key={c.id} className="admin-cat-row">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggleCat(c.id)}
                style={{ marginRight: 4 }}
              />
              <span className="admin-cat-row__handle" aria-label="Drag">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <circle cx="9" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" />
                  <circle cx="15" cy="6" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="15" cy="18" r="1.5" />
                </svg>
              </span>
              <div className="admin-cat-row__name">
                <input
                  value={c.label}
                  onChange={(e) => updateCat(c.id, { label: e.target.value })}
                />
              </div>
              <span className="admin-cat-row__count">{count(c.id)} products</span>
              <span className="admin-cat-row__id">{c.id}</span>
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
    </div>
  );
}
