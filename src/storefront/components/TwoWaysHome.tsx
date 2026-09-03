"use client";

// The "two ways to order" storefront HOME (design: "K Glow Store.dc.html").
// A hero, the "Two ways to order" split (On-Hand vs the live Group Buy), the
// ON-HAND product list (ships now), a live GROUP BUY teaser, and a "how it works"
// strip. The teaser carries the round chrome (countdown / slot goal / item count)
// and links to the dedicated #groupbuy page — an open round's PRODUCTS are never
// listed here beside the on-hand shelf, so one page never mixes the two order
// paths. Opt-in per tenant via brand.homeLayout === "two-ways"; white-label —
// every colour comes from the brand CSS variables, so K Glow's pink theme drives
// the look while any tenant with the layout on gets the same home. The
// Header/Footer/cart drawer are owned by the storefront Shell around this.

import { useState } from "react";
import { imageUrl } from "@/lib/media/image-url";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { QtyField } from "./QtyField";
import { baseProductId } from "../checkout";
import { CTA_COPY } from "@/lib/storefront/product-cta";
import { resolveSaleView } from "@/lib/storefront/sale";
import { isStoreClosed } from "@/lib/storefront/store-status";
import {
  buildTwoWaysHomeView,
  groupBuyCtaTarget,
  type OnHandLine,
} from "@/lib/storefront/two-ways-home";
import {
  buildProductOptions,
  optionLabel,
  shouldShowOptionPicker,
} from "@/lib/storefront/variations";
import { formatGbMoney } from "@/lib/storefront/group-buy-page";
import { resolveProductImage } from "@/lib/storefront/product-image";
import { normalizeGroupBuyContent, renderGbCopy } from "@/lib/storefront/gb-content";

export function TwoWaysHome({
  brand,
  onCheckout,
  onOpenGroupBuy,
}: {
  brand: Brand;
  /** Open the cart/checkout drawer (owned by the storefront shell). */
  onCheckout: () => void;
  /** Navigate to the dedicated group-buy page (the open round). */
  onOpenGroupBuy: () => void;
}) {
  const { products, cart, addToCart, setLineQty } = useStore();
  const currency = brand.currency || "₱";
  // The owner shut the whole shop. Both ways still render — the shopper can see
  // what the store sells either way — but every buy control goes inert.
  const storeClosed = isStoreClosed(brand.storeStatus);
  // brand.onHandOrder decides whether the on-hand shelf leads with the store's
  // single per-vial listings (K Glow) or keeps plain catalog order (everyone
  // else). Either way the same products render — only their order changes.
  // brand.twoWaysMode carries the EFFECTIVE per-way states (resolved server-side
  // in page.tsx). A store that sells only one way drops the other section here.
  const view = buildTwoWaysHomeView(
    products.filter((p) => p.available !== false),
    brand.groupBuyBanner ?? null,
    currency,
    new Date(),
    brand.onHandOrder,
    brand.twoWaysMode,
  );

  // Owner-editable GB copy (branding.config.groupBuyContent, normalized
  // server-side onto the brand; normalize again so a missing field can't crash
  // a stale client). {eta} in any line renders the live round's delivery ETA.
  const content = brand.groupBuyContent ?? normalizeGroupBuyContent(undefined);

  // view.gb.open already folds in the group-buy way state, so a closed or hidden
  // way never lights the round up.
  const gbLive = view.gb.open && view.gb.count > 0;
  const onHandState = view.onHand.state;
  const gbState = view.gb.state;
  const heroLine1 = brand.heroLine1 || brand.name;
  const heroLine2 = brand.heroLine2 || "beautifully verified.";
  const heroSub =
    brand.heroSub ||
    "Every batch third-party tested. Order what's on-hand today, or join the group buy and save.";

  const qtyOf = (id: string) => cart.filter((c) => baseProductId(c) === id).length;

  return (
    <div className="sf-twh" data-testid="two-ways-home">
      {/* Hero */}
      <header className="sf-twh__hero">
        <h1 className="sf-twh__hero-title font-display">
          <span>{heroLine1}</span>
          <span className="sf-twh__hero-em">{heroLine2}</span>
        </h1>
        <p className="sf-twh__hero-sub">{heroSub}</p>
      </header>

      {/* Ways to order — one card per way the store actually offers. The
          heading comes from the view-model so a one-way store never claims two. */}
      <section className="sf-twh__section" aria-labelledby="twh-ways-label">
        <div id="twh-ways-label" className="sf-twh__eyebrow">
          {view.heading}
        </div>
        <div className="sf-twh__ways" data-ways={view.visibleWays}>
          {onHandState === "open" && (
            <a href="#twh-onhand" className="sf-twh__way sf-twh__way--onhand">
              <span className="sf-twh__way-tag sf-twh__way-tag--ships">● Ships now</span>
              <span className="sf-twh__way-name font-display">On-Hand</span>
              <span className="sf-twh__way-copy">In stock, packed &amp; shipped within 24h.</span>
            </a>
          )}
          {onHandState === "closed" && (
            <div className="sf-twh__way sf-twh__way--closed">
              <span className="sf-twh__way-tag sf-twh__way-tag--closed">○ Paused</span>
              <span className="sf-twh__way-name font-display">On-Hand</span>
              <span className="sf-twh__way-copy">
                Ships-now orders are paused right now — follow us for the next restock.
              </span>
            </div>
          )}
          {gbState === "hidden" ? null : gbLive ? (
            <a
              href="#groupbuy"
              className="sf-twh__way sf-twh__way--gb"
              onClick={(e) => {
                e.preventDefault();
                onOpenGroupBuy();
              }}
            >
              <span className="sf-twh__way-tag sf-twh__way-tag--open">● Open now</span>
              <span className="sf-twh__way-name font-display">Group Buy</span>
              <span className="sf-twh__way-copy">
                Lower prices.{view.gb.deliveryEta ? ` Ships ${view.gb.deliveryEta}.` : " Ships after close."}
              </span>
            </a>
          ) : view.gb.browsable ? (
            // Closed, but the page is still up as a pricing reference — so the
            // card links there rather than dead-ending. The tag still reads
            // "Closed" so nobody mistakes it for an open round.
            <a
              href="#groupbuy"
              className="sf-twh__way sf-twh__way--gb sf-twh__way--closed"
              onClick={(e) => {
                e.preventDefault();
                onOpenGroupBuy();
              }}
            >
              <span className="sf-twh__way-tag sf-twh__way-tag--closed">○ Closed</span>
              <span className="sf-twh__way-name font-display">Group Buy</span>
              <span className="sf-twh__way-copy">
                Ordering is closed — browse the group buy prices.
              </span>
            </a>
          ) : (
            <div className="sf-twh__way sf-twh__way--closed">
              <span className="sf-twh__way-tag sf-twh__way-tag--closed">○ Closed</span>
              <span className="sf-twh__way-name font-display">Group Buy</span>
              <span className="sf-twh__way-copy">No open GB right now — follow us for the next one.</span>
            </div>
          )}
        </div>
      </section>

      {/* On-hand — gone entirely for a store that sells group buy only. A CLOSED
          shelf still lists its products (so the pause is visible and explained),
          but every row's buy control is off. */}
      {onHandState !== "hidden" && (
      <section id="twh-onhand" className="sf-twh__section" aria-labelledby="twh-onhand-label">
        <div className="sf-twh__sec-head">
          <div>
            <div className="sf-twh__eyebrow">On-Hand</div>
            <h2 id="twh-onhand-label" className="sf-twh__sec-title font-display">
              {onHandState === "closed" ? "Paused" : "Ships today"}
            </h2>
          </div>
          <span className="sf-twh__sec-count">{view.onHand.count} products</span>
        </div>
        {onHandState === "closed" && view.onHand.count > 0 && (
          <p className="sf-twh__empty">
            Ships-now orders are paused right now — these are listed for reference only.
          </p>
        )}
        {view.onHand.count === 0 ? (
          <p className="sf-twh__empty">
            {gbLive
              ? "Nothing on hand right now — everything is in the open group buy."
              : "Nothing on hand right now — follow us for the next drop."}
          </p>
        ) : (
          <ul className="sf-twh__list">
            {view.onHand.lines.map((line) => (
              <OnHandRow
                key={line.product.id}
                line={line}
                image={resolveProductImage(line.product.image, brand.defaultProductImage)}
                currency={currency}
                qty={qtyOf(line.product.id)}
                addToCart={addToCart}
                setLineQty={setLineQty}
                storeClosed={storeClosed}
              />
            ))}
          </ul>
        )}
      </section>
      )}

      {/* Live group buy */}
      {gbLive && (
        <section id="twh-gb" className="sf-twh__section" aria-label={`Group buy: ${view.gb.name}`}>
          <div className="sf-twh__gb">
            <div className="sf-twh__gb-top">
              <span className="sf-twh__gb-pill">● Group buy live</span>
              {view.gb.countdown && <span className="sf-twh__gb-countdown">{view.gb.countdown}</span>}
            </div>
            <div className="sf-twh__gb-name font-display">{view.gb.name}</div>
            <p className="sf-twh__gb-terms">{renderGbCopy(content.terms, view.gb.deliveryEta)}</p>

            {view.gb.slots.enabled && (
              <div className="sf-twh__gb-slots">
                <div className="sf-twh__gb-slots-row">
                  <span>
                    {view.gb.slots.filled} of {view.gb.slots.goal} slots filled
                  </span>
                  <span>{view.gb.slots.pctLabel}</span>
                </div>
                <div className="sf-twh__gb-bar">
                  <div className="sf-twh__gb-bar-fill" style={{ width: view.gb.slots.pctWidth }} />
                </div>
              </div>
            )}

            <div className="sf-twh__gb-count">
              {view.gb.count} {view.gb.count === 1 ? "item" : "items"} in this round —
              browse them on the group buy page
            </div>

            <button
              type="button"
              className="sf-twh__gb-cta"
              onClick={() =>
                groupBuyCtaTarget(cart.length) === "checkout" ? onCheckout() : onOpenGroupBuy()
              }
            >
              {groupBuyCtaTarget(cart.length) === "checkout"
                ? "Review cart & checkout →"
                : `Join ${view.gb.name} →`}
            </button>
            <div className="sf-twh__gb-foot">
              No shipping until arrival · You&apos;ll get tracking once the batch lands
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="sf-twh__section" aria-labelledby="twh-how-label">
        <div id="twh-how-label" className="sf-twh__eyebrow">
          {content.howTitle}
        </div>
        <ol className="sf-twh__steps">
          {content.steps.map((s) => renderGbCopy(s, view.gb.deliveryEta)).map((text, i) => (
            <li key={i} className="sf-twh__step">
              <span className="sf-twh__step-n">{i + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <style>{twhCss}</style>
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────
// Per-row components so variation products get the SAME option choice the
// classic Catalog gives (5mg/10mg with their own prices) — a variation product
// must never silently add at its base price. Option products keep a plain
// "Add" (with an in-cart count) instead of the stepper: the stepper's minus
// removes by base id, which can't target a variation clone's composite id —
// quantities for those are managed in the cart drawer.

type AddToCart = (product: Product, qty?: number, variation?: { name: string; price: number }) => void;

function OnHandRow({
  line,
  image,
  currency,
  qty,
  addToCart,
  setLineQty,
  storeClosed,
}: {
  line: OnHandLine<Product>;
  image: string | null;
  currency: string;
  qty: number;
  addToCart: AddToCart;
  /** Set this row's cart line to an absolute quantity — the typed-quantity
   *  path. Typing 5 must SET the line to 5, not add 5 more. */
  setLineQty: (
    product: Product,
    qty: number,
    variation?: { name: string; price: number },
  ) => void;
  /** The owner shut the whole shop (Admin → Store Status). The row still shows
   *  the product and its price; the buy control becomes an inert "Closed". */
  storeClosed: boolean;
}) {
  const p = line.product;
  const options = buildProductOptions(p);
  const showSelector = shouldShowOptionPicker(p);
  const [optIdx, setOptIdx] = useState(0);
  const selectedOpt = options.length ? options[Math.min(optIdx, options.length - 1)] : null;
  const canBuy = p.purchasable !== false && !p.priceOnRequest;
  // A picker changes which price is on offer, so the row re-derives the sale for
  // the chosen option; with no picker the shelf line already carries it. Either
  // way the figure shown is the one the cart charges.
  const sale = resolveSaleView(p, selectedOpt ? Math.min(optIdx, options.length - 1) : -1);
  const displayPrice =
    showSelector && selectedOpt
      ? formatGbMoney(currency, sale.price ?? selectedOpt.price)
      : line.priceLabel;
  const compareAtLabel =
    showSelector && selectedOpt
      ? sale.compareAt !== null
        ? formatGbMoney(currency, sale.compareAt)
        : ""
      : line.compareAtLabel;
  return (
    <li className="sf-twh__row">
      <span className="sf-twh__avatar font-display" aria-hidden>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl(image, { width: 120 })}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          line.initial
        )}
      </span>
      <div className="sf-twh__row-main">
        <div className="sf-twh__row-name">{p.name}</div>
        <div className="sf-twh__row-meta">
          {line.stockLabel && (
            <span className={`sf-twh__stock${line.inStock ? "" : " sf-twh__stock--out"}`}>
              {line.inStock ? line.stockLabel : "Out of stock"}
            </span>
          )}
          <span className="sf-twh__coa">COA ✓</span>
        </div>
        {showSelector && canBuy && line.buyable && (
          <select
            className="sf-twh__opts"
            aria-label={`Options for ${p.name}`}
            value={optIdx}
            onChange={(e) => setOptIdx(Number(e.target.value))}
          >
            {options.map((o, i) => (
              <option key={o.name} value={i}>
                {optionLabel(o, p.currency || currency)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="sf-twh__row-buy">
        <div className="sf-twh__row-price">
          {p.priceOnRequest ? (
            "Ask"
          ) : (
            <>
              {displayPrice}
              {compareAtLabel && (
                <s className="sf-twh__row-compare">
                  <span className="sf-sr-only">Was </span>
                  {compareAtLabel}
                </s>
              )}
            </>
          )}
        </div>
        {storeClosed ? (
          <button type="button" className="sf-twh__add" disabled>
            {CTA_COPY.closed}
          </button>
        ) : canBuy && line.buyable ? (
          showSelector ? (
            <>
              <button
                type="button"
                className="sf-twh__add"
                onClick={() => addToCart(p, 1, selectedOpt?.variation)}
              >
                Add
              </button>
              {qty > 0 && <span className="sf-twh__incart">{qty} in cart</span>}
            </>
          ) : qty === 0 ? (
            <button type="button" className="sf-twh__add" onClick={() => addToCart(p)}>
              Add
            </button>
          ) : (
            // min 0: this stepper only exists once the row is in the cart, so
            // stepping (or typing) down to nothing is how it comes back out and
            // the "Add" button returns.
            <QtyField
              value={qty}
              onChange={(next) => setLineQty(p, next)}
              min={0}
              itemName={p.name}
              className="sf-twh__stepper"
              commit="blur"
            />
          )
        ) : null}
      </div>
    </li>
  );
}

// Scoped to .sf-twh. Structure + motion live here (mirrors GroupBuyPage's inline
// <style>); all colour resolves from the brand CSS variables, with the K Glow
// pink design as the fallback so an unthemed preview still reads correctly.
const twhCss = `
.sf-root .sf-twh { max-width: 560px; margin: 0 auto; }
.sf-root .sf-twh__section { padding: 0 20px; margin-top: 28px; }
.sf-root .sf-twh__eyebrow {
  font-size: 12px; letter-spacing: .14em; font-weight: 700; text-transform: uppercase;
  color: var(--brand-main); margin-bottom: 10px;
}
.sf-root .sf-twh__hero {
  padding: 40px 24px 4px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--brand-main) 12%, var(--brand-background)) 0%, var(--brand-background) 100%);
}
.sf-root .sf-twh__hero-title { margin: 0; line-height: 1.02; color: var(--brand-main); }
.sf-root .sf-twh__hero-title span { display: block; }
.sf-root .sf-twh__hero-title > span:first-child { font-size: clamp(40px, 12vw, 52px); font-weight: 700; }
.sf-root .sf-twh__hero-em { font-style: italic; font-size: clamp(34px, 10vw, 44px); font-weight: 500; margin-top: 2px; }
.sf-root .sf-twh__hero-sub {
  margin: 14px 0 0; font-size: 14px; line-height: 1.5; text-wrap: pretty;
  color: var(--brand-text-muted);
}
.sf-root .sf-twh__ways { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sf-root .sf-twh__way {
  display: flex; flex-direction: column; gap: 6px; border-radius: 18px; padding: 16px 14px;
  text-decoration: none; border: 1px solid var(--brand-border); background: var(--brand-surface);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main) 8%, transparent);
  transition: transform .15s ease, box-shadow .15s ease;
}
.sf-root a.sf-twh__way:hover { transform: translateY(-2px); box-shadow: 0 6px 18px color-mix(in oklab, var(--brand-main) 16%, transparent); }
.sf-root .sf-twh__way--gb { background: var(--brand-main); border-color: transparent; box-shadow: 0 4px 14px color-mix(in oklab, var(--brand-main) 35%, transparent); }
.sf-root .sf-twh__way--closed { border-style: dashed; background: color-mix(in oklab, var(--brand-main) 6%, var(--brand-surface)); }
.sf-root .sf-twh__way-tag { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.sf-root .sf-twh__way-tag--ships { color: var(--brand-success, #1a8a5c); }
.sf-root .sf-twh__way-tag--open { color: color-mix(in oklab, var(--brand-surface) 78%, var(--brand-main)); }
.sf-root .sf-twh__way-tag--closed { color: var(--brand-text-muted); }
.sf-root .sf-twh__way-name { font-size: 20px; color: var(--brand-text); }
.sf-root .sf-twh__way--gb .sf-twh__way-name { color: var(--brand-button-text); }
.sf-root .sf-twh__way-copy { font-size: 12px; line-height: 1.4; color: var(--brand-text-muted); }
.sf-root .sf-twh__way--gb .sf-twh__way-copy { color: color-mix(in oklab, var(--brand-surface) 82%, var(--brand-main)); }
.sf-root .sf-twh__sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sf-root .sf-twh__sec-title { margin: 4px 0 0; font-size: clamp(24px, 7vw, 28px); color: var(--brand-text); }
.sf-root .sf-twh__sec-count { font-size: 12px; color: var(--brand-text-muted); white-space: nowrap; }
.sf-root .sf-twh__empty { font-size: 13px; color: var(--brand-text-muted); margin: 12px 0 0; }
.sf-root .sf-twh__list { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.sf-root .sf-twh__row {
  display: flex; align-items: center; gap: 14px; background: var(--brand-surface);
  border: 1px solid var(--brand-border); border-radius: 18px; padding: 14px;
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main) 7%, transparent);
}
.sf-root .sf-twh__avatar {
  width: 56px; height: 56px; border-radius: 14px; flex-shrink: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
  color: var(--brand-main); background: color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface));
}
.sf-root .sf-twh__avatar img { width: 100%; height: 100%; object-fit: cover; }
.sf-root .sf-twh__row-main { flex: 1; min-width: 0; }
.sf-root .sf-twh__row-name { font-weight: 700; font-size: 15px; color: var(--brand-text); }
.sf-root .sf-twh__row-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.sf-root .sf-twh__stock {
  font-size: 11px; font-weight: 700; color: var(--brand-success, #1a8a5c);
  background: color-mix(in oklab, var(--brand-success, #1a8a5c) 14%, var(--brand-surface)); border-radius: 99px; padding: 2px 8px;
}
.sf-root .sf-twh__stock--out { color: var(--brand-text-muted); background: color-mix(in oklab, var(--brand-text-muted) 14%, var(--brand-surface)); }
.sf-root .sf-twh__coa { font-size: 11px; color: var(--brand-text-muted); }
.sf-root .sf-twh__opts {
  margin-top: 8px; max-width: 100%; font: inherit; font-size: 12px; font-weight: 600;
  padding: 4px 8px; border-radius: 8px; color: var(--brand-text);
  border: 1px solid var(--brand-border); background: var(--brand-surface);
}
.sf-root .sf-twh__incart { display: block; margin-top: 4px; font-size: 10px; font-weight: 700; color: var(--brand-text-muted); }
.sf-root .sf-twh__row-buy { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.sf-root .sf-twh__row-price { font-weight: 700; font-size: 16px; color: var(--brand-text); }
.sf-root .sf-twh__row-compare {
  margin-left: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: color-mix(in srgb, var(--brand-text) 45%, transparent);
  text-decoration-line: line-through;
  text-decoration-thickness: 1.5px;
  white-space: nowrap;
}
.sf-root .sf-twh__add {
  border: 0; cursor: pointer; font-weight: 700; font-size: 12px; border-radius: 99px; padding: 5px 14px;
  color: var(--brand-main); background: color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface));
  transition: background .15s ease, color .15s ease;
}
.sf-root .sf-twh__add:hover { background: var(--brand-main); color: var(--brand-button-text); }
.sf-root .sf-twh__stepper {
  display: flex; align-items: center; gap: 6px; border-radius: 99px; padding: 3px;
  background: color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface));
}
.sf-root .sf-twh__stepper button {
  width: 28px; height: 28px; border: 0; border-radius: 99px; cursor: pointer; line-height: 1;
  font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center;
}
.sf-root .sf-twh__stepper button:first-child { background: #fff; color: var(--brand-main); }
.sf-root .sf-twh__stepper button:last-child { background: var(--brand-main); color: var(--brand-button-text); }
.sf-root .sf-twh__stepper span { font-weight: 700; font-size: 13px; min-width: 16px; text-align: center; color: var(--brand-main); }
.sf-root .sf-twh__stepper input {
  width: 3ch; min-width: 0; padding: 0; border: 0; background: transparent;
  font: inherit; font-weight: 700; font-size: 13px; text-align: center;
  color: var(--brand-main); appearance: none;
}
.sf-root .sf-twh__stepper input:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand-main) 55%, transparent);
  outline-offset: 2px; border-radius: 4px;
}
.sf-root .sf-twh__stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
.sf-root .sf-twh__gb {
  background: var(--brand-main); color: var(--brand-button-text);
  border-radius: 26px; padding: 24px 18px;
  box-shadow: 0 8px 28px color-mix(in oklab, var(--brand-main) 35%, transparent);
}
.sf-root .sf-twh__gb-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sf-root .sf-twh__gb-pill {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--brand-main); background: #fff; border-radius: 99px; padding: 5px 12px; white-space: nowrap;
}
.sf-root .sf-twh__gb-countdown { font-size: 12px; font-weight: 700; opacity: .92; }
.sf-root .sf-twh__gb-name { font-size: clamp(26px, 8vw, 30px); margin-top: 14px; }
.sf-root .sf-twh__gb-terms { font-size: 13px; line-height: 1.5; margin: 4px 0 0; opacity: .92; }
.sf-root .sf-twh__gb-slots { margin-top: 16px; }
.sf-root .sf-twh__gb-slots-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.sf-root .sf-twh__gb-bar { height: 8px; background: color-mix(in oklab, var(--brand-surface) 25%, transparent); border-radius: 99px; overflow: hidden; }
.sf-root .sf-twh__gb-bar-fill { height: 100%; background: #fff; border-radius: 99px; transition: width .4s ease; }
.sf-root .sf-twh__gb-count {
  margin-top: 18px; border-radius: 16px; padding: 12px 14px; font-size: 13px; font-weight: 700;
  background: color-mix(in oklab, var(--brand-surface) 12%, transparent); border: 1px solid color-mix(in oklab, var(--brand-surface) 25%, transparent);
}
.sf-root .sf-twh__gb-cta {
  width: 100%; margin-top: 18px; border: 0; cursor: pointer; border-radius: 99px; padding: 15px;
  font-weight: 700; font-size: 15px; color: var(--brand-main); background: #fff; transition: filter .15s ease;
}
.sf-root .sf-twh__gb-cta:hover { filter: brightness(0.94); }
.sf-root .sf-twh__gb-foot { font-size: 11px; text-align: center; margin-top: 10px; opacity: .9; }
.sf-root .sf-twh__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sf-root .sf-twh__step { display: flex; gap: 12px; align-items: flex-start; font-size: 13px; line-height: 1.5; color: var(--brand-text); }
.sf-root .sf-twh__step-n {
  flex-shrink: 0; width: 26px; height: 26px; border-radius: 99px; font-weight: 700; font-size: 13px;
  display: flex; align-items: center; justify-content: center; margin-top: 1px;
  color: var(--brand-main); background: color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface));
}
`;
