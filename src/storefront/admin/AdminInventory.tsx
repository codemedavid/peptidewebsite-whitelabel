"use client";

import { Fragment, useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { listProductsAction, saveProductAction } from "@/actions/products";
import { isMadeToOrder, MADE_TO_ORDER_LABEL } from "@/lib/storefront/made-to-order";

// Low-stock threshold: at or below this (but above zero) a product is flagged
// "Low" so the owner can restock before it sells out.
const LOW_STOCK = 5;

/** A row's pending edit. `off` = the names of the options switched off
 *  (variation `available: false`) — one dose off sale, the rest still selling. */
type Draft = { stock: number; available: boolean; off: string[] };

// Store-wide switch ONLY (`available: false`). Not isVariationListed: that
// also hides an option the live round leaves out (notInRound, render-time),
// and reading it here would save a round's exclusion as a store-wide "off".
const offOptions = (p: Product): string[] =>
  (p.variations ?? []).filter((v) => v.available === false).map((v) => v.name);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** The product to save: stock, availability and each option's on/off flag;
 *  every other field rides along unchanged so the upsert can't clobber it. */
function withDraft(p: Product, d: Draft): Product {
  const variations = p.variations?.map((v) => {
    const { available: _drop, ...rest } = v;
    return d.off.includes(v.name) ? { ...rest, available: false } : rest;
  });
  return { ...p, stock: d.stock, available: d.available, ...(variations ? { variations } : {}) };
}

export function AdminInventory({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { products, setProducts, toast } = useStore();
  // Per-row pending edits, keyed by product id. A row is "dirty" once its draft
  // diverges from the stored product.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currency = brand.currency || "₱";

  const draftFor = (p: Product): Draft =>
    drafts[p.id] ?? { stock: p.stock ?? 0, available: p.available !== false, off: offOptions(p) };

  const isDirty = (p: Product) => {
    const d = drafts[p.id];
    if (!d) return false;
    return (
      d.stock !== (p.stock ?? 0) ||
      d.available !== (p.available !== false) ||
      !sameSet(d.off, offOptions(p))
    );
  };

  const setDraft = (p: Product, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [p.id]: { ...draftFor(p), ...patch } }));

  // One option on/off. Switching the LAST option off takes the whole product
  // off sale (nothing is left to sell); switching one back on lists it again —
  // so the product checkbox never contradicts its options.
  const toggleOption = (p: Product, name: string, on: boolean) => {
    const d = draftFor(p);
    const off = on ? d.off.filter((n) => n !== name) : [...d.off.filter((n) => n !== name), name];
    const total = p.variations?.length ?? 0;
    const available = off.length >= total ? false : on ? true : d.available;
    setDraft(p, { off, available });
  };

  const adjust = (p: Product, delta: number) =>
    setDraft(p, { stock: Math.max(0, draftFor(p).stock + delta) });

  // Persist one row to the DB, then reflect it locally. Stock + availability are
  // the only fields we touch; everything else on the product is sent unchanged
  // so the upsert doesn't clobber it.
  const save = async (p: Product) => {
    if (savingId || busy) return;
    const d = draftFor(p);
    setSavingId(p.id);
    try {
      const res = await saveProductAction({ ...withDraft(p, d), currency });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      const saved = res.product;
      setProducts((prev) => prev.map((x) => (x.id === p.id ? saved : x)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        // Re-key any draft that was under a temp id the DB just replaced.
        if (saved.id !== p.id) delete next[saved.id];
        return next;
      });
      toast(`Updated "${saved.name}"`);
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSavingId(null);
    }
  };

  const refresh = async () => {
    if (busy || savingId) return;
    setBusy(true);
    try {
      const res = await listProductsAction(currency);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setProducts(res.products);
      setDrafts({});
      toast("Inventory refreshed");
    } catch {
      toast("Couldn't refresh inventory.");
    } finally {
      setBusy(false);
    }
  };

  // Made-to-order products hold no inventory, so they are neither counted nor
  // flagged here. Left in, all 19 of a made-to-order store's listings would sit
  // permanently in "Out of stock" and bury the products that genuinely need
  // restocking — the same reason lowStockProducts skips them on the dashboard.
  const stocked = products.filter((p) => !isMadeToOrder(p));
  const totalUnits = stocked.reduce((sum, p) => sum + (p.stock ?? 0), 0);
  const outOfStock = stocked.filter((p) => (p.stock ?? 0) <= 0).length;
  const lowStock = stocked.filter((p) => {
    const s = p.stock ?? 0;
    return s > 0 && s <= LOW_STOCK;
  }).length;

  const stockTag = (p: Product, stock: number) => {
    if (isMadeToOrder(p))
      return { label: MADE_TO_ORDER_LABEL, cls: "admin-pill--available" };
    if (stock <= 0) return { label: "Out of stock", cls: "admin-pill--inactive" };
    if (stock <= LOW_STOCK) return { label: "Low stock", cls: "admin-pill--featured" };
    return { label: "In stock", cls: "admin-pill--available" };
  };

  const stats = [
    { label: "Total Units", value: totalUnits.toLocaleString() },
    { label: "Low Stock", value: lowStock },
    { label: "Out of Stock", value: outOfStock },
  ];

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
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span>Inventory</span>
          </h1>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="admin-btn admin-btn--ghost" onClick={refresh} disabled={busy || !!savingId}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {busy ? "Working…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="admin__stats" style={{ marginBottom: 20 }}>
          {stats.map((s) => (
            <div key={s.label} className="admin-stat">
              <div className="admin-stat__label">{s.label}</div>
              <div className="admin-stat__value">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Available</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const d = draftFor(p);
                const tag = stockTag(p, d.stock);
                const options = p.variations ?? [];
                return (
                  <Fragment key={p.id}>
                  <tr className={options.length ? "admin-inv-row--has-options" : undefined}>
                    <td className="admin-cell-product">
                      <span className="admin-cell-product__name">{p.name}</span>
                      <div className="admin-cell-product__desc">{p.description}</div>
                    </td>
                    <td className="admin-cell-price" data-label="Price">
                      {currency}{(p.price || 0).toLocaleString()}
                    </td>
                    <td data-label="Stock">
                      <div className="admin-stock-edit">
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Decrease"
                          onClick={() => adjust(p, -1)}
                          disabled={d.stock <= 0}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                               strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                        <input
                          type="number"
                          min={0}
                          className="admin-input admin-input--stock"
                          value={d.stock}
                          onChange={(e) =>
                            setDraft(p, { stock: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                          }
                        />
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Increase"
                          onClick={() => adjust(p, 1)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                               strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td data-label="Available">
                      <label className="admin-check">
                        <input
                          type="checkbox"
                          checked={d.available}
                          onChange={(e) => setDraft(p, { available: e.target.checked })}
                        />
                      </label>
                    </td>
                    <td data-label="Status">
                      <span className={`admin-pill ${tag.cls}`}>{tag.label}</span>
                    </td>
                    <td className="admin-cell-actions">
                      <button
                        className="admin-btn admin-btn--ghost"
                        disabled={!isDirty(p) || savingId === p.id}
                        onClick={() => save(p)}
                      >
                        {savingId === p.id ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                  {options.length > 0 && (
                    <tr className="admin-inv-options">
                      <td colSpan={6}>
                        <fieldset className="admin-inv-options__set">
                          <legend className="admin-inv-options__legend">
                            Options on sale
                            <span>
                              {options.length - d.off.length} of {options.length}
                            </span>
                          </legend>
                          {options.map((v) => {
                            const on = !d.off.includes(v.name);
                            return (
                              <label
                                key={v.name}
                                className={`admin-inv-option${on ? "" : " is-off"}`}
                                title={on ? `Take ${v.name} off sale` : `Put ${v.name} back on sale`}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) => toggleOption(p, v.name, e.target.checked)}
                                />
                                <span>{v.name}</span>
                              </label>
                            );
                          })}
                        </fieldset>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 60, color: "var(--brand-text-muted)" }}>
                    No products yet. Add products first to track their stock.
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
