"use client";

// The gated reseller / merchant portal (#merchant). Resellers unlock it with the
// access code the store owner configured (validated server-side — the code never
// ships to the browser), then see the wholesale price list: every product with a
// reseller tier, alongside its retail price. Toggled on per-tenant from the store
// admin → Reseller Portal. Hidden entirely when showPageMerchant is off.
//
// When the viewer holds a store-admin session, the page unlocks without a code
// and each row becomes editable — the owner can open the full product editor
// inline to manage prices/details right from this list. Resellers (code-only)
// always see the read-only table.

import { useEffect, useMemo, useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { RESELLER_MIN_QTY, resellerMinQty, resellerTierLabel } from "../checkout";
import {
  hasStorefrontAdminSessionAction,
  verifyResellerCodeAction,
} from "@/actions/storefront-admin";
import { AdminAddProduct } from "../admin/AdminAddProduct";

// Per-tenant key so unlocking one store doesn't unlock another in the same browser.
const UNLOCK_KEY = "sf_merchant_unlocked";

function Gate({
  brand,
  onUnlock,
}: {
  brand: Brand;
  onUnlock: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await verifyResellerCodeAction(code);
    setBusy(false);
    if ("ok" in res) {
      try {
        sessionStorage.setItem(UNLOCK_KEY, "1");
      } catch {
        /* ignore */
      }
      onUnlock();
    } else {
      setError(res.error || "Incorrect access code.");
      setTimeout(() => setError(""), 2600);
    }
  };

  return (
    <div className="merchant-gate">
      <form className="merchant-gate__card" onSubmit={submit}>
        <div className="merchant-gate__icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="merchant-gate__title">{brand.merchantGateTitle || "Reseller Access"}</h1>
        <p className="merchant-gate__sub">
          {brand.merchantGateSub || "Enter your reseller code to view wholesale pricing."}
        </p>
        <input
          type="text"
          className={`merchant-gate__input ${error ? "is-error" : ""}`}
          value={code}
          placeholder="Access code"
          autoFocus
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
        />
        <div className="merchant-gate__error">{error}</div>
        <button type="submit" className="btn btn-primary merchant-gate__submit" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Unlock pricing"}
        </button>
      </form>
    </div>
  );
}

export function MerchantPage({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  // Read the catalog from the shared store so the owner's inline edits (which go
  // through AdminAddProduct → setProducts) re-render this list immediately.
  const { products, categories } = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  useEffect(() => {
    try {
      setUnlocked(sessionStorage.getItem(UNLOCK_KEY) === "1");
    } catch {
      /* ignore */
    }
    // The store owner gets in without a code and with editing enabled.
    void hasStorefrontAdminSessionAction()
      .then((ok) => {
        if (ok) {
          setIsAdmin(true);
          setUnlocked(true);
        }
      })
      .catch(() => {})
      .finally(() => setAdminChecked(true));
  }, []);

  const catLabel = (id: string) => (categories || []).find((c) => c.id === id)?.label || id;

  // Resellers see only products that actually carry a wholesale tier (and aren't
  // hidden). The owner sees every product so they can add/adjust prices on any of
  // them right here.
  const rows = useMemo(() => {
    if (isAdmin) return products;
    return products
      .filter((p) => p.available !== false)
      .filter((p) => p.reseller && (p.reseller.vialsOnly || p.reseller.completeSet));
  }, [products, isAdmin]);

  const currency = brand.currency || products[0]?.currency || "₱";
  const money = (n?: number | null) => (n && n > 0 ? `${currency}${n.toLocaleString()}` : "—");
  const colSpan = isAdmin ? 7 : 6;

  // Inline full-product editor (owner only). Reuses the admin product form; on
  // save it updates the shared store, so closing it drops us back to a fresh row.
  if (editing) {
    return (
      <AdminAddProduct
        brand={brand}
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    );
  }

  // Hold the gate until the admin check resolves, so the owner doesn't see it
  // flash before auto-unlocking.
  if (!unlocked) {
    if (!adminChecked) {
      return (
        <div className="sf-page-spinner">
          <div className="sf-page-spinner__ring" />
        </div>
      );
    }
    return <Gate brand={brand} onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <section className="page" id="merchant">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.merchantBackLabel || "Back"} />
        <div className="page__head">
          {brand.merchantEyebrow && <div className="eyebrow">{brand.merchantEyebrow}</div>}
          <h1 className="page__title">{brand.merchantTitle || "Reseller Price List"}</h1>
          {brand.merchantSub && <p className="page__sub">{brand.merchantSub}</p>}
        </div>

        {isAdmin && (
          <div className="merchant-adminbar">
            <span className="merchant-adminbar__badge">Admin</span>
            Editing is on — click <strong>Edit</strong> on any product to manage its prices and details.
            Resellers only see the read-only list.
          </div>
        )}

        <div className="merchant-note">
          <strong>Wholesale terms:</strong> the minimum order to unlock the wholesale price is set per
          product (default {RESELLER_MIN_QTY} units) — see the “Min order” column. The complete-set tier
          is what we ship online at the minimum; the vials-only tier is arranged by request.
        </div>

        {rows.length > 0 ? (
          <div className="merchant-table-wrap">
            <table className="merchant-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="merchant-table__num">Min order</th>
                  <th className="merchant-table__num">Retail</th>
                  <th className="merchant-table__num">Vials only</th>
                  <th className="merchant-table__num">Complete set</th>
                  {isAdmin && <th className="merchant-table__num">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const applied = resellerTierLabel(p);
                  const minQty = resellerMinQty(p);
                  const hasReseller = !!(p.reseller && (p.reseller.vialsOnly || p.reseller.completeSet));
                  return (
                    <tr key={p.id}>
                      <td className="merchant-table__product">
                        <span className="merchant-table__name">{p.name}</span>
                        {p.purity && <span className="merchant-table__purity">{p.purity} purity</span>}
                      </td>
                      <td className="merchant-table__cat">{catLabel(p.category)}</td>
                      <td className="merchant-table__num">{hasReseller ? `${minQty}+` : "—"}</td>
                      <td className="merchant-table__num merchant-table__retail">{money(p.price)}</td>
                      <td className="merchant-table__num">
                        {money(p.reseller?.vialsOnly)}
                        {applied === "Vials only" && p.reseller?.vialsOnly ? (
                          <span className="merchant-table__tag">at {minQty}+ online</span>
                        ) : p.reseller?.vialsOnly ? (
                          <span className="merchant-table__tag is-muted">by request</span>
                        ) : null}
                      </td>
                      <td className="merchant-table__num">
                        {money(p.reseller?.completeSet)}
                        {p.reseller?.completeSet ? (
                          <span className="merchant-table__tag">at {minQty}+ online</span>
                        ) : null}
                      </td>
                      {isAdmin && (
                        <td className="merchant-table__num">
                          <button className="merchant-edit-btn" onClick={() => setEditing(p)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                            </svg>
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} style={{ textAlign: "center", padding: 48, color: "var(--brand-text-muted)" }}>
                      No products yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="merchant-empty">
            <p className="font-display" style={{ fontSize: 24, margin: 0 }}>
              No wholesale items yet.
            </p>
            <p style={{ color: "var(--brand-text-muted)" }}>
              Reseller prices haven&apos;t been set on any products yet — check back soon.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
