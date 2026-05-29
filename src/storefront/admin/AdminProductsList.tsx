"use client";

import { useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { deleteProductsAction, listProductsAction } from "@/actions/products";

export function AdminProductsList({
  brand,
  onBack,
  onAdd,
  onEdit,
}: {
  brand: Brand;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (p: Product) => void;
}) {
  const { products, setProducts, categories, toast } = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.id)));
  };

  // Delete persists to the DB first (deleteProductsAction); only on success do
  // we drop it from local state, so the UI never claims a delete the server
  // refused (e.g. a product still linked to an order).
  const deleteIds = async (ids: string[], confirmMsg: string) => {
    if (!ids.length || busy) return;
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await deleteProductsAction(ids);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      const gone = new Set(ids);
      setProducts((prev) => prev.filter((p) => !gone.has(p.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch {
      toast("Couldn't delete — please sign in again and retry.");
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => void deleteIds([id], "Delete this product?");
  const deleteSelected = () =>
    void deleteIds([...selected], `Delete ${selected.size} product(s)?`);

  // Reload the catalog from the DB (the source of truth).
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await listProductsAction(brand.currency || "₱");
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setProducts(res.products);
      setSelected(new Set());
      toast("Products refreshed");
    } catch {
      toast("Couldn't refresh products.");
    } finally {
      setBusy(false);
    }
  };

  const catLabel = (id: string) =>
    (categories || []).find((c) => c.id === id)?.label || id;

  const currency = brand.currency || "₱";

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
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
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Dashboard
            </a>
            <span>Products</span>
          </h1>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="admin-btn admin-btn--ghost" onClick={refresh} disabled={busy}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              {busy ? "Working…" : "Refresh"}
            </button>
            <button className="admin-btn" onClick={onAdd}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                   strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add New
            </button>
          </div>
        </div>

        <div className="admin-orders__bulkbar">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={selected.size === products.length && products.length > 0}
              onChange={toggleAll}
            />
            <span>Select All ({products.length})</span>
          </label>
          <button
            className="admin-btn admin-btn--danger-soft"
            disabled={!selected.size || busy}
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

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selected.size === products.length && products.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Sizes</th>
                <th>Purity</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td className="admin-cell-product">
                    <div className="admin-cell-product__name">{p.name}</div>
                    <div className="admin-cell-product__desc">{p.description}</div>
                  </td>
                  <td><span style={{ fontSize: 14 }}>{catLabel(p.category)}</span></td>
                  <td className="admin-cell-price">{currency}{(p.price || 0).toLocaleString()}</td>
                  <td className="admin-cell-muted">{p.sizes || "No sizes"}</td>
                  <td><span className="admin-pill admin-pill--dark">{p.purity || "—"}</span></td>
                  <td className="admin-cell-price">{p.stock ?? 0}</td>
                  <td>
                    <div className="admin-status-stack">
                      {p.featured && (
                        <span className="admin-pill admin-pill--featured">
                          <span style={{ color: "#FFC857" }}>★</span> Featured
                        </span>
                      )}
                      <span
                        className={`admin-pill ${
                          p.available !== false ? "admin-pill--available" : "admin-pill--inactive"
                        }`}
                      >
                        {p.available !== false ? "✓" : "✗"}
                      </span>
                    </div>
                  </td>
                  <td className="admin-cell-actions">
                    <div className="admin-cell-actions__group">
                      <button
                        className="admin-icon-btn"
                        title="Stock"
                        onClick={() => alert(`Stock: ${p.stock ?? 0}`)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                          <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
                        </svg>
                      </button>
                      <button
                        className="admin-icon-btn"
                        title="Edit"
                        onClick={() => onEdit(p)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9"/>
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>
                        </svg>
                      </button>
                      <button
                        className="admin-icon-btn admin-icon-btn--danger"
                        title="Delete"
                        onClick={() => remove(p.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 60, color: "var(--brand-text-muted)" }}>
                    No products yet. Click &quot;Add New&quot; to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
