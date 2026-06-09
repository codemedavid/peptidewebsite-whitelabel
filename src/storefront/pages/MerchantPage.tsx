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

// Wholesale order control for a reseller row: a quantity stepper floored at the
// product's minimum (so a line can never be added below the wholesale threshold)
// plus an Add-to-Cart button. The cart applies the wholesale unit price at this
// quantity automatically (see checkout.ts unitPrice/isResellerQty).
function OrderCell({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (qty: number) => void;
}) {
  const min = resellerMinQty(product);
  const [qty, setQty] = useState(min);
  const [added, setAdded] = useState(false);

  const add = () => {
    onAdd(Math.max(min, qty));
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="merchant-order">
      <div className="sf-qty merchant-order__qty">
        <button
          type="button"
          aria-label={`Remove one ${product.name}`}
          onClick={() => setQty((q) => Math.max(min, q - 1))}
          disabled={qty <= min}
        >
          −
        </button>
        <span aria-live="polite">{qty}</span>
        <button type="button" aria-label={`Add one ${product.name}`} onClick={() => setQty((q) => q + 1)}>
          +
        </button>
      </div>
      <button type="button" className="btn btn-primary merchant-order__add" onClick={add}>
        {added ? "Added ✓" : "Add to cart"}
      </button>
    </div>
  );
}

// One wholesale product rendered as a card (mirrors the public catalog card, but
// surfaces the reseller tiers instead of the single retail price). Owners get an
// Edit button in the footer; resellers get the qty + add-to-cart control.
function MerchantCard({
  product,
  categoryLabel,
  money,
  isAdmin,
  onEdit,
  onAdd,
}: {
  product: Product;
  categoryLabel: string;
  money: (n?: number | null) => string;
  isAdmin: boolean;
  onEdit: () => void;
  onAdd: (qty: number) => void;
}) {
  const applied = resellerTierLabel(product);
  const minQty = resellerMinQty(product);
  const hasReseller = !!(product.reseller && (product.reseller.vialsOnly || product.reseller.completeSet));

  return (
    <article className="product-card merchant-card card">
      <div className="product-card__media">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt={product.name} />
        ) : (
          <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
            <path d="M6 16l26 12 26-12" />
            <path d="M32 28v32" />
          </svg>
        )}
        {hasReseller && <span className="merchant-card__min">Min {minQty}+ units</span>}
      </div>

      <div className="product-card__body">
        <h3 className="product-card__name font-display">{product.name}</h3>
        <div className="merchant-card__meta">
          <span className="merchant-card__cat">{categoryLabel}</span>
          {product.purity && <span className="badge badge-soft">{product.purity} Purity</span>}
        </div>

        <div className="merchant-card__tiers">
          <div className="merchant-card__tier merchant-card__tier--retail">
            <span className="merchant-card__tier-label">Retail</span>
            <span className="merchant-card__tier-val">{money(product.price)}</span>
          </div>
          <div className="merchant-card__tier">
            <span className="merchant-card__tier-label">
              Vials only
              {product.reseller?.vialsOnly ? (
                <span className={`merchant-card__tag ${applied === "Vials only" ? "is-applied" : "is-muted"}`}>
                  {applied === "Vials only" ? `at ${minQty}+ online` : "by request"}
                </span>
              ) : null}
            </span>
            <span className="merchant-card__tier-val">{money(product.reseller?.vialsOnly)}</span>
          </div>
          <div className="merchant-card__tier merchant-card__tier--set">
            <span className="merchant-card__tier-label">
              Complete set
              {product.reseller?.completeSet ? (
                <span className="merchant-card__tag is-applied">at {minQty}+ online</span>
              ) : null}
            </span>
            <span className="merchant-card__tier-val">{money(product.reseller?.completeSet)}</span>
          </div>
        </div>
      </div>

      <hr className="hairline" />

      <div className="product-card__foot merchant-card__foot">
        {isAdmin ? (
          <button className="merchant-edit-btn merchant-card__edit" onClick={onEdit}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Edit prices &amp; details
          </button>
        ) : (
          <OrderCell product={product} onAdd={onAdd} />
        )}
      </div>
    </article>
  );
}

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
  const { products, categories, addToCart } = useStore();
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
          product (default {RESELLER_MIN_QTY} units) — see the “Min order” column. Add a product from the
          “Order” column (it starts at the minimum) and the wholesale price applies automatically in your
          cart. The complete-set tier is what we ship online at the minimum; the vials-only tier is
          arranged by request.
        </div>

        {rows.length > 0 ? (
          <div className="merchant-grid catalog__grid">
            {rows.map((p) => (
              <MerchantCard
                key={p.id}
                product={p}
                categoryLabel={catLabel(p.category)}
                money={money}
                isAdmin={isAdmin}
                onEdit={() => setEditing(p)}
                onAdd={(qty) => addToCart(p, qty)}
              />
            ))}
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
