"use client";

// Group Buys → Pricing tab. The owner manages what each product costs INSIDE a
// group buy here, without going through the full product editor:
//
//   • click a row  → set or change its group-buy price
//   • Remove       → retire it from the group buy (it stays in the catalog)
//   • Not available→ keep it listed but not orderable
//
// The list covers the WHOLE catalog, not just the tagged products, so promoting
// something into the round is one click on the row it already occupies. A filter
// narrows to the group-buy products once the round is set up.
//
// Every mutation goes through saveGroupBuyProductPricingAction, which re-checks
// the entitlement, both staff grants, and the price rule — the disabled states
// here are UX, not the boundary.

import { useMemo, useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { buildGbPricingRows, gbPriceError } from "@/lib/storefront/gb-pricing";
import type { GroupBuy, GroupBuyCapabilities } from "@/lib/storefront/group-buy";
import { saveGroupBuyProductPricingAction } from "@/actions/group-buys";

type Filter = "all" | "gb";

export function AdminGroupBuyPricing({
  brand,
  caps,
  groupBuys,
  onGroupBuysChange,
}: {
  brand: Brand;
  caps: GroupBuyCapabilities;
  groupBuys: GroupBuy[];
  /** Retiring a product can rewrite round assignments — hand the fresh rounds
   *  back so the Rounds tab doesn't show a stale product count. */
  onGroupBuysChange: (next: GroupBuy[]) => void;
}) {
  const { products, setProducts, toast } = useStore();
  const currency = brand.currency || "₱";

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  /** Row being priced, and the value in its input. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = useMemo(
    () => buildGbPricingRows(products, groupBuys, currency),
    [products, groupBuys, currency],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "gb" ? r.isGroupBuy : true))
      .filter((r) => (q ? r.product.name.toLowerCase().includes(q) : true));
  }, [rows, filter, query]);

  const gbCount = rows.filter((r) => r.isGroupBuy).length;

  /** Replace one product in the shared store after a successful write. */
  const upsertProduct = (next: Product) =>
    setProducts((prev) => prev.map((p) => (p.id === next.id ? next : p)));

  const run = async (
    productId: string,
    payload: Record<string, unknown>,
    okMessage: string,
  ): Promise<boolean> => {
    setBusyId(productId);
    setRowError(null);
    try {
      const res = await saveGroupBuyProductPricingAction({ productId, ...payload });
      if ("error" in res) {
        setRowError(res.error);
        return false;
      }
      upsertProduct(res.product);
      onGroupBuysChange(res.groupBuys);
      // A warning is not a failure — the write went through — but it changes what
      // the round sells, so it stays on screen instead of only flashing a toast.
      if (res.warning) {
        setRowError(res.warning);
        toast(res.warning);
      } else {
        toast(okMessage);
      }
      return true;
    } catch {
      setRowError("Couldn't save — please sign in again and retry.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const openEditor = (product: Product, gbPrice: number, hasPrice: boolean) => {
    if (!caps.canEdit) return;
    setRowError(null);
    setEditingId(product.id);
    setDraft(hasPrice && gbPrice > 0 ? String(gbPrice) : "");
  };

  const savePrice = async (product: Product) => {
    const price = Number(draft);
    // Validate with the SAME rule the server uses, so the owner sees the message
    // before a round trip rather than after one.
    const invalid = gbPriceError(product, price);
    if (invalid) {
      setRowError(invalid);
      return;
    }
    const ok = await run(
      product.id,
      { op: "price", price },
      `Group-buy price saved for ${product.name}`,
    );
    if (ok) setEditingId(null);
  };

  const remove = async (product: Product) => {
    const live = groupBuys.filter(
      (gb) =>
        gb.status === "active" &&
        (gb.productIds.length === 0 || gb.productIds.includes(product.id)),
    );
    const heads_up = live.length
      ? `"${product.name}" is in the LIVE round "${live[0].name}". Removing it changes what customers see right now.\n\n`
      : "";
    if (
      !confirm(
        `${heads_up}Remove "${product.name}" from the group buy?\n\nIt stays in your catalog at its regular price — only the group-buy price and the round assignment are cleared.`,
      )
    ) {
      return;
    }
    await run(product.id, { op: "remove" }, `${product.name} removed from the group buy`);
  };

  const toggleAvailable = (product: Product, next: boolean) =>
    run(
      product.id,
      { op: "availability", available: next },
      next ? `${product.name} is available again` : `${product.name} marked not available`,
    );

  return (
    <>
      <div className="gbprice__bar">
        <div className="gbprice__filters" role="group" aria-label="Filter products">
          <button
            type="button"
            className={`admin-btn admin-btn--ghost${filter === "all" ? " is-active" : ""}`}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All products ({rows.length})
          </button>
          <button
            type="button"
            className={`admin-btn admin-btn--ghost${filter === "gb" ? " is-active" : ""}`}
            aria-pressed={filter === "gb"}
            onClick={() => setFilter("gb")}
          >
            In the group buy ({gbCount})
          </button>
        </div>
        <input
          className="admin-input gbprice__search"
          type="search"
          value={query}
          placeholder="Search products…"
          aria-label="Search products"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!caps.canEdit && (
        <div className="admin-field__hint" style={{ marginBottom: 10 }}>
          Your plan includes group buys but not editing — prices are read-only here.
        </div>
      )}

      <div className="admin-ship-list">
        {visible.map((row) => {
          const p = row.product;
          const isEditing = editingId === p.id;
          const busy = busyId === p.id;
          return (
            <div
              key={p.id}
              className={`admin-ship-row gbprice__row${row.available ? "" : " is-paused"}`}
            >
              <div className="admin-ship-row__info">
                <button
                  type="button"
                  className="gbprice__name"
                  disabled={!caps.canEdit || busy}
                  onClick={() => openEditor(p, row.gbPrice, row.hasSavings)}
                >
                  {p.name}
                </button>
                <div className="admin-field__hint">
                  Regular {row.regularLabel}
                  {row.hasSavings
                    ? ` · Group buy ${row.gbLabel} · saves ${row.savingsLabel}`
                    : " · no group-buy price set"}
                  {row.roundNames.length ? ` · in ${row.roundNames.join(", ")}` : ""}
                </div>

                {isEditing && (
                  <div className="gbprice__editor">
                    <label className="admin-field__label" htmlFor={`gbprice-${p.id}`}>
                      Group-buy price
                    </label>
                    <div className="gbprice__editor-row">
                      <span aria-hidden>{currency}</span>
                      <input
                        id={`gbprice-${p.id}`}
                        className="admin-input"
                        type="number"
                        min={0}
                        step="any"
                        value={draft}
                        autoFocus
                        placeholder={`Below ${row.regularLabel}`}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void savePrice(p);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <button
                        className="admin-btn"
                        disabled={busy}
                        onClick={() => void savePrice(p)}
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button
                        className="admin-btn admin-btn--ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setRowError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {rowError && (
                      <div className="gbprice__error" role="alert">
                        {rowError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="admin-ship-row__actions gbprice__actions">
                {!row.available && (
                  <span className="admin-pill admin-pill--inactive">Not available</span>
                )}
                {caps.canEdit && (
                  <>
                    <button
                      className="admin-btn admin-btn--ghost gbprice__btn"
                      disabled={busy}
                      onClick={() => void toggleAvailable(p, !row.available)}
                    >
                      {row.available ? "Set not available" : "Make available"}
                    </button>
                    {row.isGroupBuy && (
                      <button
                        className="admin-btn admin-btn--ghost gbprice__btn"
                        disabled={busy}
                        onClick={() => void remove(p)}
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {visible.length === 0 && (
          <div className="admin-empty-set">
            {query.trim()
              ? `No products match “${query.trim()}”.`
              : filter === "gb"
                ? "No products have a group-buy price yet. Switch to All products and click one to set its price."
                : "No products yet — add some on the Products screen first."}
          </div>
        )}
      </div>

      {rowError && editingId === null && (
        <div className="gbprice__error" role="alert" style={{ marginTop: 10 }}>
          {rowError}
        </div>
      )}
    </>
  );
}
