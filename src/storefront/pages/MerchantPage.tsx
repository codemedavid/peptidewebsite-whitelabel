"use client";

// The gated reseller / merchant portal (#merchant). Resellers unlock it with the
// access code the store owner configured (validated server-side — the code never
// ships to the browser), then see the wholesale price list: every product with a
// reseller tier, alongside its retail price, and order it straight from the card.
// Toggled on per-tenant from the store admin → Reseller Portal. Hidden entirely
// when showPageMerchant is off.
//
// This is the storefront (customer-facing) side only: it never edits anything.
// Reseller prices/details are managed from the store admin → Manage Products,
// which opens the same product editor (AdminAddProduct) with its Reseller /
// Wholesale Pricing section.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { QtyField } from "../components/QtyField";
import { RESELLER_MIN_QTY, resellerMinQty, resellerTierLabel } from "../checkout";
import { resolveWholesale } from "@/lib/storefront/wholesale";
import { resolveBaseSaleView } from "@/lib/storefront/sale";
import { resolveProductImage } from "@/lib/storefront/product-image";
import { verifyResellerCodeAction, resellerSignOutAction } from "@/actions/storefront-admin";

// The unlock is a SERVER session, not a browser flag. `brand.resellerUnlocked` is
// derived in page.tsx from the httpOnly, tenant-scoped, version-stamped
// `sf.reseller` cookie (lib/auth/reseller-session.ts). The old implementation
// kept a `sessionStorage` boolean here, which decided nothing: the wholesale
// prices were serialized into the page for every visitor, so the "gate" could be
// walked past from devtools — or simply by reading View Source. Now the server
// withholds the prices themselves until the password is presented, and this flag
// only chooses which of the two screens to draw.

// Wholesale order control for a reseller card: a quantity stepper floored at the
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
      {/* Floored at the MOQ, and typable — a 50-unit wholesale minimum used to
          cost forty-nine taps to reach. No cap: wholesale quantities are
          negotiated against the supplier order, not the on-hand column. */}
      <QtyField
        value={qty}
        onChange={setQty}
        min={min}
        itemName={product.name}
        className="sf-qty merchant-order__qty"
      />
      <button type="button" className="btn btn-primary merchant-order__add" onClick={add}>
        {added ? "Added ✓" : "Add to cart"}
      </button>
    </div>
  );
}

// One wholesale product rendered as a card (mirrors the public catalog card, but
// surfaces the reseller tiers instead of the single retail price). The footer is
// always the qty + add-to-cart control — this is a checkout surface, not an
// editor.
function MerchantCard({
  product,
  categoryLabel,
  money,
  onAdd,
}: {
  product: Product;
  categoryLabel: string;
  money: (n?: number | null) => string;
  onAdd: (qty: number) => void;
}) {
  const { brand } = useStore();
  const applied = resellerTierLabel(product);
  const minQty = resellerMinQty(product);
  // Read through the shared resolver, not `product.reseller` directly: a product
  // configured with the current `wholesale` MOQ config must list here too. The
  // reseller page is a second SURFACE onto one product config and one pricing
  // engine, never a second wholesale system with rules of its own.
  const wholesale = resolveWholesale(product);
  // The Retail tier must quote the price the cart actually charges. This card
  // has no option picker, so it reads the base-price sale view — resolveWholesale
  // already prices its own tier off effectiveBasePrice, and a Retail figure that
  // ignored a running markdown made the wholesale saving shown against it wrong.
  const retail = resolveBaseSaleView(product);
  const hasReseller = wholesale != null;
  // Legacy products carry the two priced tiers (vials only / complete set); the
  // current config carries neither.
  const hasLegacyTiers = !!(product.reseller?.vialsOnly || product.reseller?.completeSet);
  // Product photo, or the brand's default product image, or the SVG placeholder.
  const image = resolveProductImage(product.image, brand.defaultProductImage);

  return (
    <article className="product-card merchant-card card">
      <div className="product-card__media">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={product.name} />
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
            <span className="merchant-card__tier-label">
              Retail
              {/* The tier VALUE is already struck through on this card — retail
                  is the figure wholesale beats — so a running markdown is named
                  in the label rather than drawn as a second struck price. */}
              {retail.badgeLabel && (
                <span className="merchant-card__tag is-applied">{retail.badgeLabel}</span>
              )}
            </span>
            <span className="merchant-card__tier-val">{money(retail.price)}</span>
          </div>
          {/* The current config is ONE minimum at ONE price, so it renders as a
              single row. The two legacy tiers below are shown only for products
              that actually carry them — a wholesale-only product would render
              both as "—", advertising nothing on a wholesale price list. */}
          {wholesale && !hasLegacyTiers && (
            <div className="merchant-card__tier merchant-card__tier--set">
              <span className="merchant-card__tier-label">
                Wholesale
                <span className="merchant-card__tag is-applied">at {minQty}+ online</span>
              </span>
              <span className="merchant-card__tier-val">{money(wholesale.price)}</span>
            </div>
          )}
          {hasLegacyTiers && (
          <>
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
          </>
          )}
        </div>
      </div>

      <hr className="hairline" />

      <div className="product-card__foot merchant-card__foot">
        <OrderCell product={product} onAdd={onAdd} />
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
      // The action set the session cookie. Re-render from the server so the page
      // comes back WITH the wholesale prices in it — they were never sent to this
      // browser before now, so there is nothing local to reveal.
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
          {brand.merchantGateSub || "Enter the reseller password to access wholesale pricing."}
        </p>
        <input
          type="password"
          className={`merchant-gate__input ${error ? "is-error" : ""}`}
          value={code}
          placeholder="Reseller password"
          autoFocus
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
        />
        <div className="merchant-gate__error">{error}</div>
        <button type="submit" className="btn btn-primary merchant-gate__submit" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Access Reseller Store"}
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
  // Read the catalog from the shared store so price changes made in the admin
  // (which go through AdminAddProduct → setProducts) re-render this list.
  const { products, categories, addToCart, refreshProducts } = useStore();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Seeded from the server (page.tsx reads the httpOnly cookie) and flipped
  // locally once the verify action succeeds, because the store holds `brand` in
  // useState and so will not pick up a refreshed prop on its own.
  //
  // This local flag is UX ONLY — it chooses which of the two screens to draw.
  // It cannot conjure prices: the wholesale numbers live in `products`, which
  // comes from the server, and the server only includes them for a request that
  // presents the cookie. That is the difference from the old sessionStorage
  // unlock, where the prices were already in the page and the flag was the
  // entire gate. Flipping this by hand today shows an empty price list.
  const [unlocked, setUnlocked] = useState(brand.resellerUnlocked === true);

  const catLabel = (id: string) => (categories || []).find((c) => c.id === id)?.label || id;

  // The reseller list shows only products that actually carry a wholesale tier
  // (and aren't hidden).
  const rows = useMemo(
    () =>
      products
        .filter((p) => p.available !== false)
        // Through the shared resolver, so a product configured with the
        // current `wholesale` MOQ block lists here too. Filtering on
        // `p.reseller` alone kept the page legacy-only, which would have made
        // this whole surface invisible to every new wholesale product.
        .filter((p) => resolveWholesale(p) != null),
    [products],
  );

  const currency = brand.currency || products[0]?.currency || "₱";
  const money = (n?: number | null) => (n && n > 0 ? `${currency}${n.toLocaleString()}` : "—");

  if (!unlocked) {
    return (
      <Gate
        brand={brand}
        onUnlock={() => {
          setUnlocked(true);
          // Pull the catalog again now that the request carries the session
          // cookie — THIS is what actually brings the wholesale prices down.
          refreshProducts();
          startTransition(() => router.refresh());
        }}
      />
    );
  }

  const lock = () => {
    void resellerSignOutAction().then(() => {
      setUnlocked(false);
      // Re-fetch without the cookie so the wholesale prices leave the browser
      // too, rather than lingering in the client store behind a hidden screen.
      refreshProducts();
      startTransition(() => router.refresh());
    });
  };

  return (
    <section className="page" id="merchant">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.merchantBackLabel || "Back"} />
        <div className="page__head">
          {brand.merchantEyebrow && <div className="eyebrow">{brand.merchantEyebrow}</div>}
          <h1 className="page__title">{brand.merchantTitle || "Reseller Price List"}</h1>
          {brand.merchantSub && <p className="page__sub">{brand.merchantSub}</p>}
          <button type="button" className="merchant-lock" onClick={lock} disabled={pending}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {pending ? "Locking…" : "Lock reseller pricing"}
          </button>
        </div>

        <div className="merchant-note">
          <strong>Wholesale terms:</strong> the minimum order to unlock the wholesale price is set per
          product (default {RESELLER_MIN_QTY} units) — shown as the “Min” badge on each card. The quantity
          starts at that minimum, so the wholesale price applies automatically in your cart. The
          complete-set tier is what we ship online at the minimum; the vials-only tier is arranged by
          request.
        </div>

        {rows.length > 0 ? (
          <div className="merchant-grid catalog__grid">
            {rows.map((p) => (
              <MerchantCard
                key={p.id}
                product={p}
                categoryLabel={catLabel(p.category)}
                money={money}
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
