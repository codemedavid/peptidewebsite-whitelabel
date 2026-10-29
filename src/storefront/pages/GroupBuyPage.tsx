"use client";

// The dedicated Group Buy page (design: "Group Buy Page.dc.html", kglow tenant).
// Presents the live round: a status banner (countdown + slot-goal progress +
// delivery terms), the round's group-buy products at ONE price each (their
// gbPrice — the same price the cart + server charge, see checkout.unitPrice),
// a "how it works" strip, and a sticky checkout bar. White-label: all colour
// comes from the brand's CSS variables, so K Glow's pink theme drives the look
// while any tenant with a live round gets the same page. Rendered only when a
// round is live (StorefrontApp gates the route on brand.groupBuyBanner).

import { useEffect, useState } from "react";

import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { QtyField } from "../components/QtyField";
import { baseProductId, unitPrice, variationEntryId } from "../checkout";
import {
  buildGroupBuyPageView,
  gbCardAddition,
  gbClosedNotice,
  groupBuyCartSummary,
  type GroupBuyPageLine,
} from "@/lib/storefront/group-buy-page";
import { gbScopeFromBanner } from "@/lib/storefront/two-ways-cart";
import { resolveProductImage } from "@/lib/storefront/product-image";
import { gbStepsForWays, normalizeGroupBuyContent, renderGbCopy } from "@/lib/storefront/gb-content";
import { isOnHandHidden } from "@/lib/storefront/two-ways-mode";
import { CTA_COPY } from "@/lib/storefront/product-cta";
import { isStoreClosed } from "@/lib/storefront/store-status";
import { roundKitProgress, type KitProgress } from "@/lib/storefront/gb-moq-kits";
import { KitProgressBar } from "../components/KitProgress";
import { ShareProductButton } from "../components/ShareProductButton";
import { imageUrl, imageSrcSet, CARD_SIZES, CARD_WIDTHS } from "@/lib/media/image-url";
import { findProductByLinkKey } from "@/lib/storefront/product-link";
import { isTextOnlyCard } from "../cardDesign";
import { isPageVisible } from "../visibility";
import { MY_GROUPBUY_HREF } from "@/lib/storefront/nav";

export function GroupBuyPage({
  brand,
  onBack,
  onCheckout,
  embedded = false,
  focusProductSlug = null,
}: {
  brand: Brand;
  onBack: () => void;
  /** Open the cart/checkout drawer (owned by the storefront shell). */
  onCheckout: () => void;
  /** Rendered AS the home of a group-buy-only store (lib/storefront/gb-only-home):
   *  no "Back to store" (this is the store), the listing is the #catalog every
   *  "Shop now" scrolls to, and the hero above owns the page's h1. */
  embedded?: boolean;
  /** A shared product link (#p/<slug>) on that home: scroll to its card and
   *  ring it, instead of the catalog's quick-view (which prices off-round). */
  focusProductSlug?: string | null;
}) {
  const { products, cart, addToCart, setLineQty } = useStore();
  const focusId = focusProductSlug ? (findProductByLinkKey(products, focusProductSlug)?.id ?? null) : null;
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(gbCardDomId(focusId))?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);
  const Title = embedded ? "h2" : "h1";
  const currency = brand.currency || "₱";
  // The owner shut the whole shop — the round still advertises itself, but no
  // one can join it. store.addToCart and the server re-check the same rule.
  const storeClosed = isStoreClosed(brand.storeStatus);
  const view = buildGroupBuyPageView(
    products.filter((p) => p.available !== false),
    brand.groupBuyBanner ?? null,
    currency,
    undefined,
    brand.twoWaysMode?.groupBuy,
  );

  // Owner-editable GB copy — the same content object the two-ways home renders
  // (branding.config.groupBuyContent), so both surfaces stay in sync.
  const content = brand.groupBuyContent ?? normalizeGroupBuyContent(undefined);
  // A group-buy-only store (on-hand way hidden) never points shoppers at
  // on-hand stock it doesn't sell.
  const onHandHidden = isOnHandHidden(brand.twoWaysMode);
  // Card Studio's "Text only" layout turns the card grid into a plain price
  // list: one row per product, no photos (mnm-pepsabuy asked for this). The
  // catalog card reads the same switch, so both listings agree.
  const listLayout = isTextOnlyCard(brand.cardDesign);
  // "View my order" → #my-groupbuy, only while the operator granted it. On a
  // group-buy-only store this page IS the home, so this link (and the nav one)
  // is how a member finds their order again.
  const myOrderLink = isPageVisible(brand, "my-groupbuy") ? <MyOrderLink /> : null;

  // The empty state — nothing to list at all. Keyed on the LISTING, not on the
  // round: a view-only page has no live round but plenty to show, and testing
  // `!view.live` here hid the entire catalogue behind "No group buy right now"
  // the moment a round closed. isPageVisible normally keeps a shopper away from
  // an empty page; this stays as the defensive fallback for a round with no
  // assigned products, or a race where the banner cleared mid-render.
  if (view.count === 0) {
    return (
      <section className="page gbpage" id="groupbuy">
        <div className="page__container gbpage__narrow">
          {!embedded && <BackLink onClick={onBack} label="Back to store" />}
          <div className="gbpage__empty">
            <Title className="page__title font-display">No group buy right now</Title>
            <p style={{ color: "var(--brand-text-muted)" }}>
              There isn’t an open group-buy round at the moment.{" "}
              {onHandHidden ? "Check back soon." : "Check back soon — or browse what’s on hand in the store."}
            </p>
          </div>
          {myOrderLink}
        </div>
      </section>
    );
  }

  // Roll the cart into the sticky bar's total + saving, scoped to this page's
  // products (a stray on-hand / out-of-round entry never skews the advertised
  // total). Each entry is priced with the SAME unitPrice the checkout charges,
  // so a variation clone counts at its own price — the bar and the receipt
  // can't disagree.
  const notice = gbClosedNotice(view.live);
  const scope = gbScopeFromBanner(brand.groupBuyBanner ?? null);
  const entries = cart.map((c) => ({
    id: baseProductId(c),
    unit: unitPrice(c, 1, scope),
    regular: Math.max(0, c.price || 0),
  }));
  const summary = groupBuyCartSummary(view.lines, entries, currency);

  return (
    <section className="page gbpage" id="groupbuy">
      <div className="page__container gbpage__wide">
        {!embedded && <BackLink onClick={onBack} label="Back to store" />}

        {/* Status: the live-round banner, or the view-only closed notice. Never
            both — a countdown beside "ordering is closed" reads as a bug. */}
        {view.viewOnly ? (
          <div className="gbpage__notice" role="status">
            <span className="gbpage__notice-tag">○ Viewing only</span>
            <div className="gbpage__notice-title font-display">{notice.title}</div>
            <p className="gbpage__notice-copy">{notice.message}</p>
          </div>
        ) : (
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
        )}

        {myOrderLink}

        {/* Listing header */}
        <div className="gbpage__listhead" id={embedded ? "catalog" : undefined}>
          <Title className="page__title font-display gbpage__title">Group buy pricing</Title>
          <span className="gbpage__count">
            {view.count} {view.count === 1 ? "product" : "products"}
          </span>
        </div>

        {/* Product grid */}
        <div className={listLayout ? "gbpage__grid gbpage__grid--list" : "gbpage__grid"}>
          {view.lines.map((line) => (
            <GbProductCard
              key={line.product.id}
              line={line}
              image={listLayout ? null : resolveProductImage(line.product.image, brand.defaultProductImage)}
              textOnly={listLayout}
              cart={cart}
              addToCart={addToCart}
              setLineQty={setLineQty}
              storeClosed={storeClosed}
              viewOnly={view.viewOnly}
              storeName={brand.name}
              kit={roundKitProgress(line.product, brand.groupBuyBanner)}
              isFocused={line.product.id === focusId}
            />
          ))}
        </div>

        {/* How it works */}
        <div className="gbpage__how">
          <div className="gbpage__how-head">{content.howTitle}</div>
          <ol className="gbpage__how-list">
            {gbStepsForWays(content.steps, onHandHidden).map((s) => renderGbCopy(s, view.deliveryEta)).map((text, i) => (
              <li key={i} className="gbpage__how-step">
                <span className="gbpage__how-n">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Sticky checkout bar — running total + saving, then the checkout CTA.
          Never in view-only mode: nothing on this page can be ordered, so a
          checkout button here would only lead to a refusal. */}
      {!view.viewOnly && summary.hasItems && (
        <div className="gbpage__cartbar">
          <div className="gbpage__wide gbpage__cartbar-inner">
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

/** The buyer's way back to what they ordered in the round (#my-groupbuy). */
function MyOrderLink() {
  return (
    <a className="mygb-entry" href={MY_GROUPBUY_HREF}>
      <span className="mygb-entry__text">
        <strong>Already ordered?</strong> See your items, payments and balance.
      </span>
      <span className="mygb-entry__cta">
        View my order
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </span>
    </a>
  );
}

/**
 * One product card: the dose picker, the price for the CHOSEN dose, and the
 * Join GB / stepper for that dose's own cart line.
 *
 * WHY the picker (k-glow, 2026-08-04): the card named its doses but "Join GB"
 * added the raw catalog row, so a multi-dose product reached the cart — and the
 * order the seller reads — as a bare "Tirzepatide" at the base option's group
 * price. The catalog card and the two-ways home have always offered this pick;
 * the group-buy page was the one surface without it. The selection drives what
 * is added (gbCardAddition), what is charged (the option's own gbPrice), and
 * which cart line the stepper counts.
 */
function GbProductCard({
  line,
  image,
  cart,
  addToCart,
  setLineQty,
  storeClosed,
  viewOnly,
  storeName,
  kit,
  isFocused = false,
  textOnly = false,
}: {
  line: GroupBuyPageLine<Product>;
  /** Render as a list row with no media box (Card Studio "Text only"). */
  textOnly?: boolean;
  /** The product a shared link pointed at — ringed so it's easy to spot. */
  isFocused?: boolean;
  /** Live kit progress for this product (roundKitProgress); null = no bar. */
  kit: KitProgress | null;
  image: string | null;
  cart: Product[];
  addToCart: (product: Product, qty?: number, variation?: { name: string; price: number }) => void;
  /** Set the CHOSEN dose's cart line to an absolute quantity — the typed-quantity
   *  path. Typing 5 must SET that dose to 5, not add 5 more. */
  setLineQty: (
    product: Product,
    qty: number,
    variation?: { name: string; price: number },
  ) => void;
  /** The owner shut the whole shop (Admin → Store Status). The round and its
   *  prices still show; joining is off. */
  storeClosed: boolean;
  /** The group buy is a pricing reference right now — no round running, or the
   *  owner turned ordering off. Everything renders; only the buying stops. */
  viewOnly: boolean;
  /** Store name, used only as the native share sheet's title. */
  storeName?: string;
}) {
  const p = line.product;
  const options = line.options;
  const [optIdx, setOptIdx] = useState(line.defaultOptionIndex);
  const chosen = gbCardAddition(line, optIdx);
  const selected = options.length
    ? (options[optIdx] ?? options[line.defaultOptionIndex] ?? options[0])
    : null;
  // Products the owner paused (Group Buys → Pricing) stay listed here — the
  // round still advertises them — but can't be joined. Stock is deliberately NOT
  // consulted: group-buy lines are pre-orders (isGroupBuyPreorder), so a stock-0
  // round product must keep its live "Join GB".
  // A closed shop outranks both: a group buy is still an order, so a store that
  // isn't trading can't take pre-orders either. View-only sits alongside them —
  // the cart (store.tsx) and the server both refuse these lines, so the button
  // must never look live.
  const productBlocked = p.purchasable === false || p.priceOnRequest === true;
  const blocked = storeClosed || viewOnly || productBlocked;
  // The dose picker is a BROWSING control, not a buy control: the whole point of
  // view-only mode is to let a shopper read the price of each size. It stays
  // visible whenever there is a real price behind it, and only drops for a
  // paused / price-on-request product where there is nothing to reveal.
  const showOptions = options.length > 0 && !productBlocked;
  // The cart line THIS selection lands on, so the stepper counts and removes the
  // chosen dose rather than every dose of the product at once.
  const entryId = chosen.variation ? variationEntryId(p.id, chosen.variation.name) : p.id;
  const qty = cart.filter((c) => c.id === entryId).length;
  const shownName = chosen.variation ? `${p.name} — ${chosen.variation.name}` : line.displayName;
  const join = () => addToCart(p, 1, chosen.variation);

  return (
    <article className="gbpage__card" id={gbCardDomId(p.id)} data-focused={isFocused || undefined}>
      {!textOnly && (
        <div className="gbpage__card-media">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(image, { width: CARD_WIDTHS[1] })}
              srcSet={imageSrcSet(image, [...CARD_WIDTHS])}
              sizes={CARD_SIZES}
              alt={line.displayName}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="gbpage__monogram font-display" aria-hidden>
              {line.initial}
            </span>
          )}
        </div>
      )}
      <div className="gbpage__card-body">
        <div className="gbpage__card-head">
          <div className="gbpage__card-name">
            <span className="gbpage__card-title">{line.displayName}</span>
            {/* The group-buy page renders its own cards, so it does not inherit
                the catalog card's share control. `row` keeps the button in flow:
                .gbpage__card clips its overflow, which would swallow an
                absolutely-positioned corner icon and its fallback panel. */}
            <ShareProductButton product={p} storeName={storeName} variant="row" />
          </div>
          <div className="gbpage__card-note">COA ✓ · third-party tested</div>
          {kit && <KitProgressBar kit={kit} />}
        </div>
        {showOptions && (
          <select
            className="gbpage__opts"
            // A name (not just aria-label) so the control is a proper form field.
            name={`gb-dose-${p.id}`}
            aria-label={`Dose for ${p.name}`}
            value={optIdx}
            onChange={(e) => setOptIdx(Number(e.target.value))}
          >
            {options.map((o, i) => (
              // Keyed on the INDEX as well as the name: a seller can define two
              // variations with the same label (k-glow ships duplicate "100mg" /
              // "500mg" rows), and a bare name key made React drop one of them.
              // The option list is derived, never reordered, so the index is
              // stable for the lifetime of the card.
              <option key={`${o.name}-${i}`} value={i}>
                {o.name} · {o.priceLabel}
              </option>
            ))}
          </select>
        )}
        <div className="gbpage__card-prices">
          <span className="gbpage__card-price font-display">
            {selected ? selected.priceLabel : line.priceLabel}
          </span>
        </div>
        {blocked ? (
          <button type="button" className="gbpage__join" disabled>
            {storeClosed
              ? CTA_COPY.closed
              : viewOnly
                ? CTA_COPY.groupBuyClosed
                : p.priceOnRequest
                  ? CTA_COPY.messageToOrder
                  : CTA_COPY.notAvailable}
          </button>
        ) : qty === 0 ? (
          <button type="button" className="gbpage__join" onClick={join}>
            Join GB
          </button>
        ) : (
          // min 0: the stepper replaces "Join GB" only once the dose is in the
          // cart, so typing (or stepping) down to nothing brings the button back.
          // No cap — a live round is a PRE-ORDER, so on-hand stock never limits
          // it (see isGroupBuyPreorder).
          <QtyField
            value={qty}
            onChange={(next) => setLineQty(p, next, chosen.variation)}
            min={0}
            itemName={shownName}
            className="gbpage__stepper"
            commit="blur"
          />
        )}
      </div>
    </article>
  );
}

/** DOM id of one product's card, so a shared link can scroll to it. */
function gbCardDomId(productId: string): string {
  return `gb-card-${productId}`;
}

// Scoped to .gbpage. Colour comes from the brand CSS variables (K Glow's pink
// theme fills them); the structure/motion live here so the component stays inline
// and self-contained (mirrors GroupBuyBanner's inline <style>).
const gbPageCss = `
.sf-root .gbpage__narrow { max-width: 560px; }
/* The pricing page itself uses the store's full width: at 560px a desktop
   showed three squeezed cards with the share icon wrapping under the name. */
.sf-root .gbpage__wide { max-width: 1120px; }
.sf-root .gbpage__status {
  margin: 8px 0 20px;
  background: var(--brand-main);
  color: var(--brand-button-text);
  border-radius: 20px;
  padding: 18px;
  box-shadow: 0 6px 20px color-mix(in oklab, var(--brand-main) 32%, transparent);
}
/* View-only notice. Deliberately NOT the filled brand card the live round gets,
   and deliberately not an error surface either: a soft tint of the brand colour
   with a solid left rule reads as "a state worth noticing" rather than "a thing
   went wrong". No red anywhere — the page is working exactly as the owner set
   it. color-mix keeps it white-label, so it re-tints with every tenant theme. */
.sf-root .gbpage__notice {
  margin: 8px 0 20px;
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid color-mix(in oklab, var(--brand-main) 26%, transparent);
  border-left: 4px solid var(--brand-main);
  background: color-mix(in oklab, var(--brand-main) 8%, var(--brand-surface, #fff));
  color: var(--brand-text);
}
.sf-root .gbpage__notice-tag {
  display: inline-block;
  font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: var(--brand-main);
}
.sf-root .gbpage__notice-title { font-size: 19px; font-weight: 700; margin-top: 6px; }
.sf-root .gbpage__notice-copy {
  margin: 6px 0 0; font-size: 14px; line-height: 1.55; color: var(--brand-text-muted);
}
.sf-root .gbpage__status-top {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px;
}
/* A long round name wraps inside the pill and pushes the countdown to its own
   line on phones, instead of shoving it past the banner's edge. */
.sf-root .gbpage__pill {
  font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: var(--brand-main); background: #fff; border-radius: 99px; padding: 5px 12px;
  max-width: 100%; overflow-wrap: anywhere;
}
.sf-root .gbpage__countdown { font-size: 12px; font-weight: 700; opacity: .92; white-space: nowrap; }
.sf-root .gbpage__slots { margin-top: 14px; }
.sf-root .gbpage__slots-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.sf-root .gbpage__bar { height: 7px; background: color-mix(in oklab, var(--brand-surface) 25%, transparent); border-radius: 99px; overflow: hidden; }
.sf-root .gbpage__bar-fill { height: 100%; background: #fff; border-radius: 99px; transition: width .4s ease; }
.sf-root .gbpage__terms { font-size: 12px; opacity: .92; margin: 12px 0 0; line-height: 1.5; }
.sf-root .gbpage__listhead { scroll-margin-top: 96px; }
.sf-root .gbpage__listhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.sf-root .gbpage__title { margin: 0; font-size: clamp(24px, 6vw, 30px); }
.sf-root .gbpage__count { font-size: 12px; color: var(--brand-text-muted); white-space: nowrap; }
.sf-root .gbpage__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (min-width: 640px) { .sf-root .gbpage__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } }
@media (min-width: 960px) { .sf-root .gbpage__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; } }
.sf-root .gbpage__card {
  background: var(--brand-surface);
  border: 1px solid var(--brand-border);
  border-radius: 18px; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main) 7%, transparent);
}
.sf-root .gbpage__card { scroll-margin-top: 96px; transition: box-shadow .3s ease; }
.sf-root .gbpage__card[data-focused] {
  box-shadow: 0 0 0 3px var(--brand-main), 0 8px 24px color-mix(in oklab, var(--brand-main) 22%, transparent);
}
.sf-root .gbpage__card-media {
  position: relative;
  aspect-ratio: 4 / 3; background: var(--brand-surface-2, color-mix(in oklab, var(--brand-main) 12%, var(--brand-surface)));
  display: flex; align-items: center; justify-content: center;
}
.sf-root .gbpage__card-media img { width: 100%; height: 100%; object-fit: cover; }
.sf-root .gbpage__monogram { font-size: 30px; color: var(--brand-main); }
.sf-root .gbpage__card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.sf-root .gbpage__card-name {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 2px 4px;
  font-weight: 700; font-size: 14px; color: var(--brand-text); line-height: 1.3;
}
.sf-root .gbpage__card-title { flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; padding-top: 3px; }
.sf-root .gbpage__card-note { font-size: 11px; color: var(--brand-text-muted); margin-top: 2px; }
.sf-root .gbpage__opts {
  width: 100%; font: inherit; font-size: 12px; font-weight: 600;
  color: var(--brand-text); background: var(--brand-surface);
  border: 1px solid var(--brand-border); border-radius: 10px; padding: 7px 8px; cursor: pointer;
}
.sf-root .gbpage__opts:focus-visible { outline: 2px solid var(--brand-main); outline-offset: 1px; }
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
.sf-root .gbpage__stepper input {
  width: 3ch; min-width: 0; padding: 0; border: 0; background: transparent;
  font: inherit; font-weight: 700; font-size: 14px; text-align: center;
  color: var(--brand-main); appearance: none;
}
.sf-root .gbpage__stepper input:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand-main) 55%, transparent);
  outline-offset: 2px; border-radius: 4px;
}
.sf-root .gbpage__stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
.sf-root .gbpage__how {
  margin: 24px 0; background: var(--brand-surface); border: 1px solid var(--brand-border);
  border-radius: 18px; padding: 18px;
}
.sf-root .gbpage__how-head {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--brand-main); margin-bottom: 12px;
}
.sf-root .gbpage__how-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
@media (min-width: 768px) {
  .sf-root .gbpage__how-list { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
}
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
.sf-root .gbpage__cartbar-inner { margin: 0 auto; padding: 14px var(--gutter) 18px; display: flex; flex-direction: column; gap: 10px; }
@media (min-width: 768px) {
  .sf-root .gbpage__cartbar-inner { flex-direction: row; align-items: center; justify-content: space-between; gap: 24px; }
  .sf-root .gbpage__cartbar-row { flex: 1; justify-content: flex-start; }
  .sf-root .gbpage__checkout { width: auto; padding: 14px 32px; }
}
.sf-root .gbpage__cartbar-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sf-root .gbpage__cartbar-count { font-size: 13px; color: var(--brand-text-muted); }
.sf-root .gbpage__cartbar-total { font-size: 22px; font-weight: 700; color: var(--brand-text); }
.sf-root .gbpage__checkout {
  border: 0; cursor: pointer; width: 100%; background: var(--brand-main); color: var(--brand-button-text);
  font-weight: 700; font-size: 15px; border-radius: 99px; padding: 15px; transition: filter .15s ease;
}
.sf-root .gbpage__checkout:hover { filter: brightness(0.92); }
.sf-root .gbpage__empty { padding: 40px 0; text-align: center; }
/* Price list (Card Studio "Text only"): one bordered panel, a row per product.
   Phone: name + price on top, dose picker + button under them. Wider: all
   four on one line, so the list scans like a printed price sheet. */
.sf-root .gbpage__grid.gbpage__grid--list {
  grid-template-columns: minmax(0, 1fr); gap: 0;
  background: var(--brand-surface); border: 1px solid var(--brand-border);
  border-radius: 18px; overflow: hidden;
}
.sf-root .gbpage__grid--list .gbpage__card {
  border: 0; border-radius: 0; box-shadow: none; overflow: visible;
}
.sf-root .gbpage__grid--list .gbpage__card + .gbpage__card { border-top: 1px solid var(--brand-border); }
.sf-root .gbpage__grid--list .gbpage__card[data-focused] { box-shadow: inset 4px 0 0 var(--brand-main); }
.sf-root .gbpage__grid--list .gbpage__card-body {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "head price" "opts action";
  align-items: center; gap: 10px 14px; padding: 14px 16px;
}
.sf-root .gbpage__grid--list .gbpage__card-head { grid-area: head; min-width: 0; }
.sf-root .gbpage__grid--list .gbpage__opts { grid-area: opts; }
.sf-root .gbpage__grid--list .gbpage__card-prices { grid-area: price; margin: 0; justify-content: flex-end; }
.sf-root .gbpage__grid--list .gbpage__card-price { font-size: 17px; white-space: nowrap; }
.sf-root .gbpage__grid--list .gbpage__join,
.sf-root .gbpage__grid--list .gbpage__stepper { grid-area: action; min-width: 128px; }
.sf-root .gbpage__grid--list .gbpage__join { padding: 9px 16px; }
@media (min-width: 768px) {
  .sf-root .gbpage__grid.gbpage__grid--list { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .sf-root .gbpage__grid--list .gbpage__card-body {
    grid-template-columns: minmax(0, 1fr) minmax(160px, 240px) 110px 140px;
    grid-template-areas: "head opts price action";
    padding: 14px 20px;
  }
  .sf-root .gbpage__grid--list .gbpage__card-name { font-size: 15px; }
}
`;
