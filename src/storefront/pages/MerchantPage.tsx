"use client";

// The gated reseller / merchant portal (#merchant). Resellers unlock it with the
// access code the store owner configured (validated server-side — the code never
// ships to the browser), then see the wholesale price list: every product with a
// reseller tier, alongside its retail price. Toggled on per-tenant from the store
// admin → Reseller Portal. Hidden entirely when showPageMerchant is off.

import { useEffect, useMemo, useState } from "react";
import type { Brand, Product } from "../types";
import { BackLink } from "../components/BackLink";
import { RESELLER_MIN_QTY, resellerTierLabel } from "../checkout";
import { verifyResellerCodeAction } from "@/actions/storefront-admin";

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
  products,
  onBack,
}: {
  brand: Brand;
  products: Product[];
  onBack: () => void;
}) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    try {
      setUnlocked(sessionStorage.getItem(UNLOCK_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Only products that actually carry a reseller tier, and that the owner hasn't
  // hidden from the storefront.
  const rows = useMemo(
    () =>
      products
        .filter((p) => p.available !== false)
        .filter((p) => p.reseller && (p.reseller.vialsOnly || p.reseller.completeSet)),
    [products],
  );

  const currency = brand.currency || products[0]?.currency || "₱";
  const money = (n?: number | null) => (n && n > 0 ? `${currency}${n.toLocaleString()}` : "—");

  if (!unlocked) return <Gate brand={brand} onUnlock={() => setUnlocked(true)} />;

  return (
    <section className="page" id="merchant">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.merchantBackLabel || "Back"} />
        <div className="page__head">
          {brand.merchantEyebrow && <div className="eyebrow">{brand.merchantEyebrow}</div>}
          <h1 className="page__title">{brand.merchantTitle || "Reseller Price List"}</h1>
          {brand.merchantSub && <p className="page__sub">{brand.merchantSub}</p>}
        </div>

        <div className="merchant-note">
          <strong>Wholesale terms:</strong> minimum {RESELLER_MIN_QTY} units per item. The complete-set
          tier is what we ship online at {RESELLER_MIN_QTY}+; the vials-only tier is arranged by request.
        </div>

        {rows.length > 0 ? (
          <div className="merchant-table-wrap">
            <table className="merchant-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="merchant-table__num">Retail</th>
                  <th className="merchant-table__num">Vials only</th>
                  <th className="merchant-table__num">Complete set</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const applied = resellerTierLabel(p);
                  return (
                    <tr key={p.id}>
                      <td className="merchant-table__product">
                        <span className="merchant-table__name">{p.name}</span>
                        {p.purity && <span className="merchant-table__purity">{p.purity} purity</span>}
                      </td>
                      <td className="merchant-table__cat">{p.category}</td>
                      <td className="merchant-table__num merchant-table__retail">{money(p.price)}</td>
                      <td className="merchant-table__num">
                        {money(p.reseller?.vialsOnly)}
                        {applied === "Vials only" && p.reseller?.vialsOnly ? (
                          <span className="merchant-table__tag">at {RESELLER_MIN_QTY}+ online</span>
                        ) : p.reseller?.vialsOnly ? (
                          <span className="merchant-table__tag is-muted">by request</span>
                        ) : null}
                      </td>
                      <td className="merchant-table__num">
                        {money(p.reseller?.completeSet)}
                        {p.reseller?.completeSet ? (
                          <span className="merchant-table__tag">at {RESELLER_MIN_QTY}+ online</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
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
