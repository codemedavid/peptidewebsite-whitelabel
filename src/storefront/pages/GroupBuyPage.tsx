"use client";

// The dedicated Group Buy page (design: "Group Buy Page.dc.html", kglow tenant).
// Presents the live round: a status banner (countdown + slot-goal progress +
// delivery terms), the round's group-buy products at ONE price each (their
// gbPrice — the same price the cart + server charge, see checkout.unitPrice),
// a "how it works" strip, and a sticky checkout bar. White-label: all colour
// comes from the brand's CSS variables, so K Glow's pink theme drives the look
// while any tenant with a live round gets the same page. Rendered only when a
// round is live (StorefrontApp gates the route on brand.groupBuyBanner).

import type { Brand } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { baseProductId, unitPrice } from "../checkout";
import { buildGroupBuyPageView, groupBuyCartSummary } from "@/lib/storefront/group-buy-page";
import { gbScopeFromBanner } from "@/lib/storefront/two-ways-cart";
import { resolveProductImage } from "@/lib/storefront/product-image";
import { normalizeGroupBuyContent, renderGbCopy } from "@/lib/storefront/gb-content";
import { CTA_COPY } from "@/lib/storefront/product-cta";

export function GroupBuyPage({
  brand,
  onBack,
  onCheckout,
}: {
  brand: Brand;
  onBack: () => void;
  /** Open the cart/checkout drawer (owned by the storefront shell). */
  onCheckout: () => void;
}) {
  const { products, cart, addToCart, decrementCart } = useStore();
  const currency = brand.currency || "₱";
  const view = buildGroupBuyPageView(
    products.filter((p) => p.available !== false),
    brand.groupBuyBanner ?? null,
    currency,
  );

  // Owner-editable GB copy — the same content object the two-ways home renders
  // (branding.config.groupBuyContent), so both surfaces stay in sync.
  const content = brand.groupBuyContent ?? normalizeGroupBuyContent(undefined);

  // The (defensive) empty state — the route is gated on a live round, but a
  // round with no assigned products, or a race where the banner cleared, lands
  // here rather than on a blank screen.
  if (!view.live || view.count === 0) {
    return (
      <section className="page gbpage" id="groupbuy">
        <div className="page__container gbpage__narrow">
          <BackLink onClick={onBack} label="Back to store" />
          <div className="gbpage__empty">
            <h1 className="page__title font-display">No group buy right now</h1>
            <p style={{ color: "var(--brand-text-muted)" }}>
              There isn’t an open group-buy round at the moment. Check back soon — or browse
              what’s on hand in the store.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Roll the cart into the sticky bar's total + saving, scoped to this page's
  // products (a stray on-hand / out-of-round entry never skews the advertised
  // total). Each entry is priced with the SAME unitPrice the checkout charges,
  // so a variation clone counts at its own price — the bar and the receipt
  // can't disagree.
  const scope = gbScopeFromBanner(brand.groupBuyBanner ?? null);
  const entries = cart.map((c) => ({
    id: baseProductId(c),
    unit: unitPrice(c, 1, scope),
    regular: Math.max(0, c.price || 0),
  }));
  const summary = groupBuyCartSummary(view.lines, entries, currency);

  return (
    <section className="page gbpage" id="groupbuy">
      <div className="page__container gbpage__narrow">
        <BackLink onClick={onBack} label="Back to store" />

        {/* Live-round status banner */}
        <div className="gbpage__status" role="status" aria-label={`Group buy live: ${view.name}`}>
          <div className="gbpage__status-top">
            <span className="gbpage__pill">● {view.name} is live</span>
            {view.countdown && <span className="gbpage__countdown">{view.countdown}</span>}
          </div>
          {view.slots.enabled && (
            <div className="gbpage__slots">
              <div className="gbpage__slots-row">
                <span>
                  {view.slots.filled} of {view.slots.goal} slots filled
                </span>
                <span>{view.slots.pctLabel}</span>
              </div>
              <div className="gbpage__bar">
                <div className="gbpage__bar-fill" style={{ width: view.slots.pctWidth }} />
              </div>
            </div>
          )}
          <p className="gbpage__terms">{renderGbCopy(content.terms, view.deliveryEta)}</p>
        </div>

        {/* Listing header */}
        <div className="gbpage__listhead">
          <h1 className="page__title font-display gbpage__title">Group buy pricing</h1>
          <span className="gbpage__count">
            {view.count} {view.count === 1 ? "product" : "products"}
          </span>
        </div>

        {/* Product grid */}
        <div className="gbpage__grid">
          {view.lines.map((line) => {
            const p = line.product;
            const qty = cart.filter((c) => baseProductId(c) === p.id).length;
            // Products the owner paused (Group Buys → Pricing) stay listed here
            // — the round still advertises them — but can't be joined. This page
            // previously had no guard at all, so a paused product was fully
            // buyable from it. Stock is deliberately NOT consulted: group-buy
            // lines are pre-orders (isGroupBuyPreorder), so a stock-0 round
            // product must keep its live "Join GB".
            const blocked = p.purchasable === false || p.priceOnRequest === true;
            // Product photo, or the brand's default product image, or the monogram.
            const image = resolveProductImage(p.image, brand.defaultProductImage);
            return (
              <article key={p.id} className="gbpage__card">
                <div className="gbpage__card-media">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt={line.displayName} />
                  ) : (
                    <span className="gbpage__monogram font-display" aria-hidden>
                      {line.initial}
                    </span>
                  )}
                </div>
                <div className="gbpage__card-body">
                  <div>
                    <div className="gbpage__card-name">{line.displayName}</div>
                    <div className="gbpage__card-note">COA ✓ · third-party tested</div>
                  </div>
                  <div className="gbpage__card-prices">
                    <span className="gbpage__card-price font-display">{line.priceLabel}</span>
                  </div>
                  {blocked ? (
                    <button type="button" className="gbpage__join" disabled>
                      {p.priceOnRequest ? CTA_COPY.messageToOrder : CTA_COPY.notAvailable}
                    </button>
                  ) : qty === 0 ? (
                    <button
                      type="button"
                      className="gbpage__join"
                      onClick={() => addToCart(p)}
                    >
                      Join GB
                    </button>
                  ) : (
                    <div className="gbpage__stepper" aria-label={`Quantity of ${line.displayName}`}>
                      <button
                        type="button"
                        aria-label={`Remove one ${line.displayName}`}
                        onClick={() => decrementCart(p.id)}
                      >
                        −
                      </button>
                      <span aria-live="polite">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Add one ${line.displayName}`}
                        onClick={() => addToCart(p)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {/* How it works */}
        <div className="gbpage__how">
          <div className="gbpage__how-head">{content.howTitle}</div>
          <ol className="gbpage__how-list">
            {content.steps.map((s) => renderGbCopy(s, view.deliveryEta)).map((text, i) => (
              <li key={i} className="gbpage__how-step">
                <span className="gbpage__how-n">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Sticky checkout bar — running total + saving, then the checkout CTA */}
      {summary.hasItems && (
        <div className="gbpage__cartbar">
          <div className="gbpage__narrow gbpage__cartbar-inner">
            <div className="gbpage__cartbar-row">
              <span className="gbpage__cartbar-count">
                {summary.totalQty} item{summary.totalQty === 1 ? "" : "s"}
                {summary.savings > 0 ? ` · saving ${summary.savingsLabel}` : ""}
              </span>
              <span className="gbpage__cartbar-total font-display">{summary.totalLabel}</span>
            </div>
            <button type="button" className="gbpage__checkout" onClick={onCheckout}>
              Checkout — lock my slot →
            </button>
          </div>
        </div>
      )}

      <style>{gbPageCss}</style>
    </section>
  );
}

// Scoped to .gbpage. Colour comes from the brand CSS variables (K Glow's pink
// theme fills them); the structure/motion live here so the component stays inline
// and self-contained (mirrors GroupBuyBanner's inline <style>).
const gbPageCss = `
.sf-root .gbpage__narrow { max-width: 560px; }
.sf-root .gbpage__status {
  margin: 8px 0 20px;
  background: var(--brand-main);
  color: var(--brand-button-text);
  border-radius: 20px;
  padding: 18px;
  box-shadow: 0 6px 20px color-mix(in oklab, var(--brand-main) 32%, transparent);
}
.sf-root .gbpage__status-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sf-root .gbpage__pill {
  font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: var(--brand-main); background: #fff; border-radius: 99px; padding: 5px 12px; white-space: nowrap;
}
.sf-root .gbpage__countdown { font-size: 12px; font-weight: 700; opacity: .92; }
.sf-root .gbpage__slots { margin-top: 14px; }
.sf-root .gbpage__slots-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.sf-root .gbpage__bar { height: 7px; background: color-mix(in oklab, var(--brand-surface) 25%, transparent); border-radius: 99px; overflow: hidden; }
.sf-root .gbpage__bar-fill { height: 100%; background: #fff; border-radius: 99px; transition: width .4s ease; }
.sf-root .gbpage__terms { font-size: 12px; opacity: .92; margin: 12px 0 0; line-height: 1.5; }
.sf-root .gbpage__listhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.sf-root .gbpage__title { margin: 0; font-size: clamp(24px, 6vw, 30px); }
.sf-root .gbpage__count { font-size: 12px; color: var(--brand-text-muted); white-space: nowrap; }
.sf-root .gbpage__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (min-width: 620px) { .sf-root .gbpage__grid { grid-template-columns: 1fr 1fr 1fr; } }
.sf-root .gbpage__card {
  background: var(--brand-surface);
  border: 1px solid var(--brand-border);
  border-radius: 18px; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main) 7%, transparent);
}
.sf-root .gbpage__card-media {
  position: relative;
  aspect-ratio: 4 / 3; background: var(--brand-surface-2, color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface)));
  display: flex; align-items: center; justify-content: center;
}
.sf-root .gbpage__card-media img { width: 100%; height: 100%; object-fit: cover; }
.sf-root .gbpage__monogram { font-size: 30px; color: var(--brand-main); }
.sf-root .gbpage__card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.sf-root .gbpage__card-name { font-weight: 700; font-size: 14px; color: var(--brand-text); line-height: 1.3; }
.sf-root .gbpage__card-note { font-size: 11px; color: var(--brand-text-muted); margin-top: 2px; }
.sf-root .gbpage__card-prices { display: flex; align-items: baseline; gap: 6px; margin-top: auto; }
.sf-root .gbpage__card-price { font-weight: 700; font-size: 19px; color: var(--brand-main); }
.sf-root .gbpage__join {
  border: 0; cursor: pointer; background: var(--brand-main); color: var(--brand-button-text);
  font-weight: 700; font-size: 13px; text-align: center; border-radius: 99px; padding: 11px;
  transition: filter .15s ease;
}
.sf-root .gbpage__join:hover { filter: brightness(0.92); }
.sf-root .gbpage__stepper {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--brand-surface-2, color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface))); border-radius: 99px; padding: 5px;
}
.sf-root .gbpage__stepper button {
  width: 32px; height: 32px; border: 0; border-radius: 99px; cursor: pointer;
  font-weight: 700; font-size: 16px; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.sf-root .gbpage__stepper button:first-child { background: #fff; color: var(--brand-main); }
.sf-root .gbpage__stepper button:last-child { background: var(--brand-main); color: var(--brand-button-text); }
.sf-root .gbpage__stepper span { font-weight: 700; font-size: 14px; color: var(--brand-main); }
.sf-root .gbpage__how {
  margin: 24px 0; background: var(--brand-surface); border: 1px solid var(--brand-border);
  border-radius: 18px; padding: 18px;
}
.sf-root .gbpage__how-head {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--brand-main); margin-bottom: 12px;
}
.sf-root .gbpage__how-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sf-root .gbpage__how-step { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: var(--brand-text); line-height: 1.5; }
.sf-root .gbpage__how-n {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 99px;
  background: var(--brand-surface-2, color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface)));
  color: var(--brand-main); font-weight: 700; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.sf-root .gbpage__cartbar {
  position: sticky; bottom: 0; margin-top: 24px;
  background: var(--brand-surface); border-top: 1px solid var(--brand-border);
  box-shadow: 0 -6px 20px color-mix(in oklab, var(--brand-main) 10%, transparent);
}
.sf-root .gbpage__cartbar-inner { margin: 0 auto; padding: 14px 0 18px; display: flex; flex-direction: column; gap: 10px; }
.sf-root .gbpage__cartbar-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sf-root .gbpage__cartbar-count { font-size: 13px; color: var(--brand-text-muted); }
.sf-root .gbpage__cartbar-total { font-size: 22px; font-weight: 700; color: var(--brand-text); }
.sf-root .gbpage__checkout {
  border: 0; cursor: pointer; width: 100%; background: var(--brand-main); color: var(--brand-button-text);
  font-weight: 700; font-size: 15px; border-radius: 99px; padding: 15px; transition: filter .15s ease;
}
.sf-root .gbpage__checkout:hover { filter: brightness(0.92); }
.sf-root .gbpage__empty { padding: 40px 0; text-align: center; }
`;
