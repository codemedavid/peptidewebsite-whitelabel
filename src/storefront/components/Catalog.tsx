"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Brand, Product, Review } from "../types";
import { cardDesignAttrs, type CardDesign } from "../cardDesign";
import { isOnHandBlocked } from "@/lib/storefront/group-buy";
import { resolveProductImage } from "@/lib/storefront/product-image";
import {
  buildProductGallery,
  hasGallery,
  type GallerySlide,
} from "@/lib/storefront/product-gallery";
import {
  imageUrl,
  imageSrcSet,
  CARD_WIDTHS,
  CARD_SIZES,
} from "@/lib/media/image-url";
import {
  buildProductOptions,
  shouldShowOptionPicker,
  splitOptionsForCard,
  type ProductOption,
} from "@/lib/storefront/variations";
import { isOptionOutOfStock, productOutOfStock } from "@/lib/storefront/inventory";
import { isMadeToOrder, MADE_TO_ORDER_LABEL } from "@/lib/storefront/made-to-order";
import { buildProductCta } from "@/lib/storefront/product-cta";
import { resolveSaleView } from "@/lib/storefront/sale";
import { isStoreClosed } from "@/lib/storefront/store-status";
import { buildProductDetail } from "@/lib/storefront/product-detail";
import {
  findProductByLinkKey,
  parseProductHash,
  productHash,
} from "@/lib/storefront/product-link";
import { ShareProductButton } from "./ShareProductButton";
import { resolveReviewDescStyle, reviewsForProduct } from "@/lib/storefront/reviews";
import { canOpenReviewViewer } from "@/lib/storefront/review-viewer";
import { ReviewViewer } from "./ReviewViewer";
import { QtyField } from "./QtyField";
import {
  normalizeSortCategories,
  orderCatalogByCategories,
  pinFeatured,
  seedSortCategories,
  sortByCategory,
  sortCategoryOptions,
} from "@/lib/storefront/sort-categories";
import { normalizeOnHandOrder, orderOnHandProducts } from "@/lib/storefront/on-hand-order";

/**
 * The option picker, shared by the product card and its detail modal.
 *
 * Long lists collapse. mstomato sells vial cases in 81 colorways, and rendering
 * every pill turned one card into a multi-screen wall that buried the price and
 * the Add to Cart button. Only the first few show; the rest sit behind a
 * "+75 more" toggle. A list at or under VARIATION_PREVIEW_COUNT is returned
 * whole by splitOptionsForCard and reports `collapsible: false`, so the 2-4
 * option products every other tenant sells render exactly as they always have —
 * no toggle appears out of nowhere.
 *
 * One component rather than two copies because the card and the modal must never
 * disagree about which option a given pill selects; they differ only in where
 * their sold-out signal comes from, which is why that arrives as a callback.
 */
function OptionPicker({
  options,
  selectedIndex,
  onSelect,
  isSoldOut,
  label,
  marginTop,
}: {
  options: ProductOption[];
  /** -1 until the customer picks — the card's "no price yet" state. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** The card reads live product stock; the modal reads its precomputed array. */
  isSoldOut: (option: ProductOption, index: number) => boolean;
  label: string;
  marginTop: number;
}) {
  const [showAllOpts, setShowAllOpts] = useState(false);
  // The selected index is passed through so a pick living in the hidden tail is
  // pulled into view — otherwise choosing "Verdance" (option 60) and collapsing
  // would hide the customer's own choice while the price still refers to it.
  const { visible, hiddenCount, collapsible } = splitOptionsForCard(options, {
    expanded: showAllOpts,
    selectedIndex,
  });

  return (
    <div
      className="product-card__variations"
      role="group"
      aria-label={label}
      style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop }}
    >
      {visible.map(({ option, index }) => {
        const active = index === selectedIndex;
        const soldOut = isSoldOut(option, index);
        return (
          <button
            key={`${option.name}-${index}`}
            type="button"
            className="badge"
            aria-pressed={active}
            onClick={() => onSelect(index)}
            title={soldOut ? `${option.name} is out of stock` : undefined}
            style={{
              cursor: "pointer",
              border: active
                ? "1px solid var(--brand-main)"
                : "1px solid var(--brand-border)",
              background: active ? "var(--brand-main)" : "transparent",
              color: active ? "var(--brand-button-text)" : "inherit",
              fontWeight: active ? 600 : 500,
              opacity: soldOut ? 0.5 : 1,
              textDecoration: soldOut ? "line-through" : "none",
            }}
          >
            {option.name}
            {soldOut ? " · out" : ""}
          </button>
        );
      })}
      {collapsible && (
        <button
          type="button"
          className="badge product-card__variations-more"
          aria-expanded={showAllOpts}
          onClick={() => setShowAllOpts((v) => !v)}
        >
          {showAllOpts ? "Show less" : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

/** Above this many slides the gallery shows a "3 / 82" counter instead of one
 *  dot per photo, which stops being readable well before a seller's 81st
 *  colorway. */
const GALLERY_DOTS_MAX = 8;

/**
 * The swipeable product image gallery.
 *
 * Rendered only when a product has more than one slide — i.e. when the seller
 * gave at least one variation its own photo. Everything else keeps the single
 * <img> the card has always drawn, so no tenant without per-variation photos
 * gains a track, dots or an observer.
 *
 * Swiping and picking are bound both ways: scrolling a variation's photo into
 * view selects that option (its price reveals, Add to Cart binds to it), and
 * clicking its pill scrolls the photo back into view. Motion is native
 * scroll-snap rather than a gesture library — it stays on the compositor, works
 * with a trackpad and a touchscreen alike, and costs no JS on the drag itself.
 * Selection is read with an IntersectionObserver rather than a scroll handler so
 * nothing runs per frame.
 */
function ProductGallery({
  slides,
  selectedIndex,
  onSelect,
  onOpenDetail,
  alt,
  width,
  srcSetWidths,
  sizes,
}: {
  slides: GallerySlide[];
  selectedIndex: number;
  onSelect: (optionIndex: number) => void;
  /** Absent in the Card Studio preview and in the modal — slides aren't clickable there. */
  onOpenDetail?: () => void;
  alt: string;
  width: number;
  srcSetWidths: number[];
  sizes: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  // Which slide the observer last reported. Read by the scroll-into-view effect
  // so a pill click that lands on the already-visible slide doesn't re-scroll —
  // that is the feedback loop (swipe → select → scroll → observe → select).
  const activeRef = useRef(0);
  // The observer fires once for the initially-visible slide as soon as it starts
  // watching. Acting on that would SELECT an option on mount for any product
  // whose first slide is a variation (one with no base photo), silently
  // revealing a price the customer never asked for. Skip the first batch.
  const readyRef = useRef(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    readyRef.current = false;

    const observer = new IntersectionObserver(
      (entries) => {
        // Take the most-visible slide in this batch rather than the last one to
        // cross the line, so a fast swipe past several slides settles correctly.
        const winner = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!winner) return;

        const index = slideRefs.current.indexOf(winner.target as HTMLDivElement);
        if (index < 0) return;

        activeRef.current = index;
        setActive(index);

        if (!readyRef.current) {
          readyRef.current = true;
          return;
        }
        const optionIndex = slides[index]?.optionIndex;
        if (typeof optionIndex === "number") onSelect(optionIndex);
      },
      // Against the track, not the viewport: a card scrolled off-screen must not
      // report its slides as hidden and re-fire when it scrolls back.
      { root: track, threshold: 0.6 },
    );

    for (const el of slideRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
    // `onSelect` is intentionally excluded — the card passes a fresh closure each
    // render, and re-observing on every render would re-fire the mount skip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides]);

  // Picking a pill brings its photo back into view.
  useEffect(() => {
    if (selectedIndex < 0) return;
    const target = slides.findIndex((s) => s.optionIndex === selectedIndex);
    if (target < 0 || target === activeRef.current) return;
    const el = slideRefs.current[target];
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "center",
      // "nearest" so bringing a slide into view never scrolls the whole page.
      block: "nearest",
    });
  }, [selectedIndex, slides]);

  const go = (delta: number) => {
    const next = Math.min(slides.length - 1, Math.max(0, activeRef.current + delta));
    slideRefs.current[next]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  };

  return (
    <div className="product-card__gallery">
      <div className="product-card__gallery-track" ref={trackRef}>
        {slides.map((slide, i) => (
          <div
            key={`${slide.src}-${i}`}
            className="product-card__gallery-slide"
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
          >
            {onOpenDetail ? (
              <button
                type="button"
                className="product-card__gallery-hit"
                onClick={onOpenDetail}
                aria-label={`View details for ${alt}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(slide.src, { width })}
                  srcSet={imageSrcSet(slide.src, srcSetWidths)}
                  sizes={sizes}
                  alt={slide.label}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(slide.src, { width })}
                srcSet={imageSrcSet(slide.src, srcSetWidths)}
                sizes={sizes}
                alt={slide.label}
                loading="lazy"
                decoding="async"
              />
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="product-card__gallery-nav product-card__gallery-nav--prev"
        aria-label="Previous image"
        onClick={() => go(-1)}
        disabled={active <= 0}
      >
        ‹
      </button>
      <button
        type="button"
        className="product-card__gallery-nav product-card__gallery-nav--next"
        aria-label="Next image"
        onClick={() => go(1)}
        disabled={active >= slides.length - 1}
      >
        ›
      </button>

      {/* A dot per slide reads well for a handful of photos and becomes noise at
          82 — a seller who photographed every colorway would get a grey smear
          across the bottom of the card. Past the threshold, show a counter. */}
      {slides.length <= GALLERY_DOTS_MAX ? (
        <div className="product-card__gallery-dots" aria-hidden>
          {slides.map((slide, i) => (
            <span
              key={`${slide.src}-dot-${i}`}
              className={`product-card__gallery-dot${i === active ? " is-active" : ""}`}
            />
          ))}
        </div>
      ) : (
        <div className="product-card__gallery-count" aria-hidden>
          {active + 1} / {slides.length}
        </div>
      )}
      <span className="sf-sr-only" aria-live="polite">
        {slides[active]?.label}
      </span>
    </div>
  );
}

/**
 * The storefront product card. Also rendered by the admin Card Studio for its
 * live previews (with a sample `rating`), so the gallery shows exactly what
 * ships. `design` comes from brand.cardDesign — absent, the card renders the
 * classic markup with no [data-cd] attributes and is visually unchanged.
 */
export function ProductCard({
  product,
  onAdd,
  onOpenDetail,
  design,
  rating,
  gbBlocked,
  storeClosed,
  defaultImage,
  storeName,
}: {
  product: Product;
  onAdd: (qty: number, variation?: { name: string; price: number }) => void;
  /** Open the full-detail quick-view modal for this product. Optional so the
   *  admin Card Studio preview (which renders this card outside the catalog)
   *  keeps working — there, the card's image/name are simply not clickable. */
  onOpenDetail?: () => void;
  design?: CardDesign;
  /** Sample rating shown by Card Studio previews. The public catalog passes
   *  nothing — products carry no rating data, so none is invented. */
  rating?: { value: number; count: number };
  /** True when a group buy is live and this on-hand (non-group-buy) product is
   *  blocked from the cart by the owner's on-hand setting. Shows but disables
   *  buying — the store.addToCart gate and the server both re-check it. */
  gbBlocked?: boolean;
  /** True when the owner has closed the whole shop (Admin → Store Status). The
   *  card still renders in full — image, name, price — but the buy controls read
   *  "Closed" and are inert. Outranks every per-product state. */
  storeClosed?: boolean;
  /** Brand-level fallback photo (brand.defaultProductImage) shown when the
   *  product has no image of its own. Prop (not useStore) because the platform
   *  admin's CardDesignPicker renders this card outside the StoreProvider. */
  defaultImage?: string | null;
  /** Store name, used only as the native share sheet's title. Optional so the
   *  admin Card Studio preview (rendered outside StoreProvider) still works —
   *  there the share control simply titles itself with the product name. */
  storeName?: string;
}) {
  const [qty, setQty] = useState(1);
  // Per-product variations (e.g. 5mg / 10mg), each with its own price. When a
  // product has them, the customer picks an option; the chosen one drives the
  // price shown and what's added to the cart. The product's own base price stays
  // available as a default "Standard" option (so a single variation still gives a
  // real choice) — skipped when the seller left the base price at 0, or when a
  // named variation already carries the base price (it IS the standard). No
  // variations → unchanged single-price behavior.
  const options = buildProductOptions(product);
  // Start with NOTHING selected (-1). A variation product then shows only its
  // option names and no price until the customer clicks a pill — the price on
  // screen always names the option they chose. A single-price product has no
  // options, so this index never matters and its price shows immediately.
  const [optIdx, setOptIdx] = useState(-1);
  const selectedOpt =
    optIdx >= 0 && optIdx < options.length ? options[optIdx] : null;
  // Any variation the seller priced earns a picker. Keying off the option count
  // instead used to hide a lone variation on a product with no base price — the
  // customer paid that price without ever seeing which option it was.
  const showSelector = shouldShowOptionPicker(product);
  // null = the product has options but none is picked yet → no price, and buying
  // is blocked until the customer chooses. A single-price product is never null.
  // The SALE rides along: `sale.price` is the marked-down figure the cart will
  // actually charge and `sale.compareAt` the list price to strike through, so a
  // discount is visible in the GRID instead of being discovered at checkout.
  const sale = resolveSaleView(product, optIdx);
  const displayPrice = sale.price;
  const cd = design ? cardDesignAttrs(design) : null;
  // Product photo, or the brand's default product image, or the SVG placeholder.
  const image = resolveProductImage(product.image, defaultImage);
  // Slides for the swipe gallery: the base photo plus every variation the seller
  // photographed. Memoized so the IntersectionObserver isn't torn down and
  // rebuilt on each render (which would re-arm its skip-the-first-batch guard).
  const slides = useMemo(
    () => buildProductGallery(product, defaultImage),
    [product, defaultImage],
  );
  // What the buy controls say and whether they work — one shared rule (the
  // modal calls the same helper), so the card can never again invite a choice
  // ("Select an option") on a product whose every option is sold out. It also
  // carries the stock the stepper caps against: the SELECTED option's units,
  // falling back to the base column for a single-price product.
  const cta = buildProductCta(product, optIdx, { gbBlocked, storeClosed });
  const { stock } = cta;
  const productOut = productOutOfStock(product);
  // Manufactured per order: not stocked, but not unavailable either — the card
  // says so instead of showing nothing where a stock badge would sit.
  const madeToOrder = isMadeToOrder(product);
  // "Price on request": on hand but no fixed price. Show a label instead of a
  // price and block add-to-cart — the customer messages the store to order.
  const poa = product.priceOnRequest === true;
  // Wholesale / reseller prices are deliberately NOT shown on the public catalog
  // — they live only on the gated reseller page (#merchant). The cart still
  // auto-applies the bulk price at the per-product minimum (see checkout.ts), so
  // resellers get wholesale at checkout without it being advertised here.
  return (
    <article className="product-card card" style={cd?.style} {...(cd?.data ?? {})}>
      {/* Opposite corner from the badge stack above, so the two never collide.
          Hidden until card hover on pointer devices (always shown on touch) —
          the owner needs it, the shopper does not. */}
      <ShareProductButton product={product} storeName={storeName} />
      {productOut ? (
        <span className="product-card__badge badge badge-soft">Out of stock</span>
      ) : madeToOrder ? (
        // Made to order sits directly below "Out of stock" because it answers the
        // same question — can I get this, and when — and above every promotional
        // badge: a shopper needs to know the item is manufactured for them before
        // a markdown or a Featured pin competes for the same corner.
        <span className="product-card__badge badge badge-soft">{MADE_TO_ORDER_LABEL}</span>
      ) : poa ? (
        <span className="product-card__badge badge badge-soft">On hand</span>
      ) : gbBlocked ? (
        <span className="product-card__badge badge badge-soft">On hand</span>
      ) : sale.badgeLabel ? (
        // Above "Featured": a markdown is time-bound and is the reason this card
        // is worth a second look right now, where Featured is a standing pin.
        <span className="product-card__badge product-card__badge--sale badge badge-solid">
          {sale.badgeLabel}
        </span>
      ) : (
        product.featured && (
          <span className="product-card__badge badge badge-solid">Featured</span>
        )
      )}

      {/* The media + name open the full-detail modal. Rendered as a real
          <button> (not an onClick div) so keyboard and screen-reader users get
          the same "view details" affordance; falls back to a plain div in the
          Card Studio preview where onOpenDetail is absent. */}
      {/* A product whose variations carry photos gets the swipe gallery; every
          other product keeps the exact single-image markup below, so nothing
          changes for tenants that never uploaded per-variation images. The
          outer .product-card__media box is kept either way — the Card Studio
          [data-cd-layout] rules (horizontal, overlay, inset) all target it. */}
      {hasGallery(slides) ? (
        <div className="product-card__media product-card__media--gallery">
          <ProductGallery
            slides={slides}
            selectedIndex={optIdx}
            onSelect={setOptIdx}
            onOpenDetail={onOpenDetail}
            alt={product.name}
            width={480}
            srcSetWidths={[...CARD_WIDTHS]}
            sizes={CARD_SIZES}
          />
        </div>
      ) : onOpenDetail ? (
        <button
          type="button"
          className="product-card__media product-card__media--interactive"
          onClick={onOpenDetail}
          aria-label={`View details for ${product.name}`}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(image, { width: 480 })}
              srcSet={imageSrcSet(image, [...CARD_WIDTHS])}
              sizes={CARD_SIZES}
              alt={product.name}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
              <path d="M6 16l26 12 26-12" />
              <path d="M32 28v32" />
            </svg>
          )}
          <span className="product-card__view-hint" aria-hidden>
            View details
          </span>
        </button>
      ) : (
        <div className="product-card__media">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(image, { width: 480 })}
              srcSet={imageSrcSet(image, [...CARD_WIDTHS])}
              sizes={CARD_SIZES}
              alt={product.name}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
              <path d="M6 16l26 12 26-12" />
              <path d="M32 28v32" />
            </svg>
          )}
        </div>
      )}

      <div className="product-card__body">
        {onOpenDetail ? (
          <h3 className="product-card__name font-display">
            <button
              type="button"
              className="product-card__name-btn"
              onClick={() => onOpenDetail()}
            >
              {product.name}
            </button>
          </h3>
        ) : (
          <h3 className="product-card__name font-display">{product.name}</h3>
        )}
        {rating && (
          <div
            className="product-card__rating"
            aria-label={`Rated ${rating.value} out of 5 from ${rating.count} reviews`}
          >
            <span
              className="product-card__stars"
              style={{ "--rate": rating.value / 5 } as React.CSSProperties}
              aria-hidden
            >
              ★★★★★
            </span>
            <span className="product-card__rating-value">{rating.value.toFixed(1)}</span>
            <span className="product-card__rating-count">({rating.count})</span>
          </div>
        )}
        <p className="product-card__desc">{product.description}</p>
        {product.purity && (
          <span className="badge badge-soft">{product.purity} Purity</span>
        )}
        {showSelector && !poa && (
          <OptionPicker
            options={options}
            selectedIndex={optIdx}
            onSelect={setOptIdx}
            isSoldOut={(o) => isOptionOutOfStock(product, o)}
            label={`Options for ${product.name}`}
            marginTop={10}
          />
        )}
      </div>

      <hr className="hairline" />

      <div className="product-card__foot">
        <div className="product-card__price font-display">
          {cta.priceLabel !== null ? (
            <span className="product-card__price-poa">{cta.priceLabel}</span>
          ) : (
            <>
              {product.currency}
              {displayPrice?.toLocaleString()}
              {sale.compareAt !== null && (
                <s className="product-card__compare">
                  <span className="sf-sr-only">Was </span>
                  {product.currency}
                  {sale.compareAt.toLocaleString()}
                </s>
              )}
            </>
          )}
        </div>
        {poa ? (
          <div className="product-card__buy">
            <button className="btn btn-primary product-card__cta" disabled>
              {cta.ctaLabel}
            </button>
          </div>
        ) : gbBlocked ? (
          <div className="product-card__buy">
            <button
              className="btn btn-primary product-card__cta"
              disabled
              title="On-hand products are paused while a group buy is open."
            >
              {cta.ctaLabel}
            </button>
          </div>
        ) : (
          <div className="product-card__buy">
            {/* Typable: ordering 12 vials is one entry, not eleven taps. Capped
                at the SELECTED option's units (Infinity for made-to-order), so
                the box can't hold a quantity the store cannot fill. */}
            <QtyField
              value={qty}
              onChange={setQty}
              max={stock}
              itemName={product.name}
              className="sf-qty product-card__qty"
              plusDisabled={stock <= 0}
            />
            <button
              className="btn btn-primary product-card__cta"
              disabled={cta.disabled}
              onClick={() => {
                if (cta.disabled) return;
                onAdd(qty, selectedOpt?.variation ?? undefined);
                setQty(1);
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
              </svg>
              {cta.ctaLabel}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Full-detail quick-view modal, opened by clicking a product card. Shows the
 * whole (un-clamped) description plus the spec sheet the card has no room for,
 * and carries a working option picker + qty stepper + Add to Cart so the
 * customer can buy without closing it. View model comes from buildProductDetail
 * so the modal and the card never disagree on price, image or options.
 */
function ProductDetailModal({
  product,
  onClose,
  onAddToCart,
  defaultImage,
  gbBlocked,
  storeClosed,
  brand,
}: {
  product: Product;
  onClose: () => void;
  onAddToCart: (
    p: Product,
    qty?: number,
    variation?: { name: string; price: number },
  ) => void;
  defaultImage?: string | null;
  gbBlocked?: boolean;
  /** The owner closed the whole shop — see ProductCard's note. Passed through so
   *  the modal and the card it opened from can't disagree. */
  storeClosed?: boolean;
  /** Source of the testimonials connected to this product (brand.reviews, DB-
   *  hydrated) and their typography default. A prop, not useStore, because the
   *  platform admin's live preview renders this catalog outside StoreProvider. */
  brand: Brand;
}) {
  const detail = buildProductDetail(product, defaultImage);
  // Memoized for the same reason as the card's: a new array each render would
  // tear down and re-arm the gallery's IntersectionObserver.
  const slides = useMemo(
    () => buildProductGallery(product, defaultImage),
    [product, defaultImage],
  );
  // Testimonials the owner connected to THIS product. A review may name several
  // products, so the same testimonial can appear under each of them.
  const productReviews = reviewsForProduct(brand.reviews ?? [], product.id);
  const [qty, setQty] = useState(1);
  // A testimonial the customer asked to see large. The thumb below is 56px —
  // unreadable for the chat screenshots owners actually upload.
  const [reviewViewer, setReviewViewer] = useState<Review | null>(null);
  // Nothing picked yet (-1): a product with options shows no price until the
  // customer clicks one, same as the catalog card it opened from.
  const [optIdx, setOptIdx] = useState(-1);
  const closeRef = useRef<HTMLButtonElement>(null);

  const selectedIdx =
    optIdx >= 0 && optIdx < detail.options.length ? optIdx : -1;
  const selectedOpt = selectedIdx >= 0 ? detail.options[selectedIdx] : null;
  // null = has options but none picked → show a prompt, not a price, and block
  // buying until a pick. resolveSaleView reuses the card's option list, so the
  // modal quotes the same sale price and struck list price the card did.
  const sale = resolveSaleView(product, optIdx);
  const displayPrice = sale.price;
  // Same shared rule the card runs, so the modal it opened from can't disagree
  // about the label, the disabled state, or the stepper's cap.
  const cta = buildProductCta(product, optIdx, { gbBlocked, storeClosed });
  const selectedStock = cta.stock;
  const canBuy = !cta.disabled;

  // Esc closes, body scroll locks, focus moves into the dialog — same modal
  // contract as NoticeModal so keyboard + screen-reader users are covered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The review viewer sits on top and runs its own Escape handler. Stand
      // down while it is open, or one keypress dismisses both modals.
      if (reviewViewer) return;
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, reviewViewer]);

  return (
    <div className="sf-detail-overlay" role="presentation" onClick={onClose}>
      <div
        className="sf-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sf-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="sf-detail__close"
          aria-label="Close product details"
          onClick={onClose}
        >
          ×
        </button>

        {/* The modal is where an owner lands after opening a product to check
            it, so the share control is labelled here rather than icon-only. */}
        <div className="sf-detail__share">
          <ShareProductButton
            product={product}
            storeName={brand.name}
            variant="detail"
          />
        </div>

        <div className="sf-detail__grid">
          <div className="sf-detail__media">
            {hasGallery(slides) ? (
              // Same two-way binding as the card: swipe a colorway into view and
              // its pill activates below; tap a pill and its photo scrolls back.
              // No onOpenDetail — the modal IS the detail view.
              <ProductGallery
                slides={slides}
                selectedIndex={optIdx}
                onSelect={setOptIdx}
                alt={detail.name}
                width={720}
                srcSetWidths={[360, 720, 1080]}
                sizes="(max-width: 640px) 90vw, 520px"
              />
            ) : detail.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(detail.image, { width: 720 })}
                srcSet={imageSrcSet(detail.image, [360, 720, 1080])}
                sizes="(max-width: 640px) 90vw, 520px"
                alt={detail.name}
                decoding="async"
              />
            ) : (
              <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
                <path d="M6 16l26 12 26-12" />
                <path d="M32 28v32" />
              </svg>
            )}
          </div>

          <div className="sf-detail__info">
            <h2 id="sf-detail-title" className="sf-detail__name font-display">
              {detail.name}
            </h2>
            {detail.purity && (
              <span className="badge badge-soft">{detail.purity} Purity</span>
            )}

            <div className="sf-detail__price font-display">
              {cta.priceLabel !== null ? (
                <span className="product-card__price-poa">{cta.priceLabel}</span>
              ) : (
                <>
                  {detail.currency}
                  {displayPrice?.toLocaleString()}
                  {sale.compareAt !== null && (
                    <s className="sf-detail__compare">
                      <span className="sf-sr-only">Was </span>
                      {detail.currency}
                      {sale.compareAt.toLocaleString()}
                    </s>
                  )}
                </>
              )}
            </div>

            {detail.description && (
              <p className="sf-detail__desc">{detail.description}</p>
            )}

            {productReviews.length > 0 && (
              <section className="sf-detail__reviews" aria-label={`Customer reviews for ${detail.name}`}>
                <h3 className="sf-detail__reviews-title">What customers say</h3>
                {productReviews.map((r, i) => (
                  <figure key={r.id ?? i} className="sf-detail__review">
                    {r.image.trim() && canOpenReviewViewer(r) && (
                      // The thumb is 56px — a chat screenshot is unreadable at
                      // that size, so it is a control that opens the full view.
                      // One rule decides whether it exists: a row the viewer
                      // would open empty renders no thumb rather than a dead one.
                      <button
                        type="button"
                        className="sf-detail__review-zoom"
                        onClick={() => setReviewViewer(r)}
                        aria-label={`View ${r.title || "this review"} full size`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="sf-detail__review-img"
                          src={imageUrl(r.image, { width: 240 })}
                          alt={r.title || "Customer review"}
                          loading="lazy"
                          decoding="async"
                        />
                      </button>
                    )}
                    <figcaption className="sf-detail__review-body">
                      {r.title && <strong className="sf-detail__review-name">{r.title}</strong>}
                      {r.subtitle && (
                        <p className="sf-detail__review-text" style={resolveReviewDescStyle(r, brand)}>
                          {r.subtitle}
                        </p>
                      )}
                      {r.badge && <span className="review-card__badge">{r.badge}</span>}
                    </figcaption>
                  </figure>
                ))}
              </section>
            )}

            {detail.showOptions && !detail.priceOnRequest && (
              <OptionPicker
                options={detail.options}
                selectedIndex={optIdx}
                onSelect={setOptIdx}
                isSoldOut={(_o, i) => (detail.optionStock[i] ?? 0) <= 0}
                label={`Options for ${detail.name}`}
                marginTop={4}
              />
            )}

            {detail.specs.length > 0 && (
              <dl className="sf-detail__specs">
                {detail.specs.map((row) => (
                  <div key={row.label} className="sf-detail__spec">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="sf-detail__buy">
              {canBuy && (
                <QtyField
                  value={qty}
                  onChange={setQty}
                  max={selectedStock}
                  itemName={detail.name}
                  className="sf-qty product-card__qty"
                />
              )}
              <button
                type="button"
                className="btn btn-primary product-card__cta"
                disabled={!canBuy}
                onClick={() => {
                  if (!canBuy) return;
                  onAddToCart(product, qty, selectedOpt?.variation ?? undefined);
                  onClose();
                }}
              >
                {cta.ctaLabel}
              </button>
            </div>
          </div>
        </div>

        {/* Rendered INSIDE .sf-detail, whose onClick stops propagation, so a
            click on the viewer's backdrop can never reach the product overlay
            and close it too. CSS stacks it above (z-index 1400 vs 1200). */}
        {reviewViewer && (
          <ReviewViewer
            review={reviewViewer}
            brand={brand}
            onClose={() => setReviewViewer(null)}
          />
        )}
      </div>
    </div>
  );
}

export function Catalog({
  products,
  category,
  onAddToCart,
  brand,
  query: queryProp,
  onQueryChange,
  openProductSlug,
}: {
  products: Product[];
  category: string;
  onAddToCart: (p: Product, qty?: number, variation?: { name: string; price: number }) => void;
  brand: Brand;
  /** Optional CONTROLLED search term. Omitted (every classic tenant) the
   *  catalog owns its own search box exactly as before; supplied, the term is
   *  lifted to the caller so a search field elsewhere on the page — the
   *  boutique layout's header bar — filters this same grid. */
  query?: string;
  onQueryChange?: (q: string) => void;
  /** Link key (slug or id) of a product to open the quick-view modal for, from
   *  a shared /p/<slug> link or a #p/<slug> hash. Undefined = nothing to open;
   *  a key that matches nothing in this catalog is ignored, so a link to a
   *  hidden or deleted product falls back to the plain grid rather than a
   *  dead-end. See lib/storefront/product-link.ts. */
  openProductSlug?: string | null;
}) {
  // The owner shut the whole shop (Admin → Store Status). The catalog still
  // renders in full — that is the point of "closed" rather than "hidden" — but
  // every card's buy control goes inert. store.addToCart and the server's order
  // placement re-check the same rule, so this is presentation, not the gate.
  const storeClosed = isStoreClosed(brand.storeStatus);
  // Uncontrolled by default; the internal state is simply unused (and never
  // read) once a caller supplies `query`.
  const [ownQuery, setOwnQuery] = useState("");
  const controlled = queryProp !== undefined;
  const query = controlled ? queryProp : ownQuery;
  const setQuery = controlled ? (onQueryChange ?? (() => {})) : setOwnQuery;
  // "" = no explicit pick yet → the catalog shows the owner's configured order
  // (products blocked by sort category, featured pinned above everything).
  const [sort, setSort] = useState("");
  // The product whose full-detail quick-view modal is open (null = closed).
  const [selected, setSelected] = useState<Product | null>(null);

  // A shared link (/p/<slug>, or #p/<slug> from inside the SPA) opens straight
  // into the quick-view modal. Re-runs when the key changes so navigating from
  // one product link to another swaps the modal instead of leaving the first
  // one up, and when `products` changes so a link that arrives before the
  // catalog has hydrated still resolves. An unmatched key is deliberately a
  // no-op: a link to a since-hidden product shows the catalog, not an error.
  useEffect(() => {
    if (!openProductSlug) return;
    const target = findProductByLinkKey(products, openProductSlug);
    if (target) setSelected(target);
  }, [openProductSlug, products]);

  // Opening the modal puts the product's own link in the address bar, so the
  // browser's share/copy affordances and the Back button both work on it.
  // `replaceState` rather than a hash assignment: assigning would push an entry
  // and fire `hashchange`, which the SPA router would treat as a navigation.
  const openDetail = (p: Product) => {
    setSelected(p);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", productHash(p));
    }
  };
  const closeDetail = () => {
    setSelected(null);
    if (typeof window !== "undefined" && parseProductHash(window.location.hash)) {
      // Drop the product hash on close, keeping the path + query intact so the
      // catalog does not jump or reload.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  // The sort menu is the owner's own list now (Admin → Product Sort Categories),
  // not a hardcoded three. A tenant who has never opened that screen is seeded
  // from their legacy catalogSortStyle, so their dropdown is unchanged. Best
  // sellers still rank by the server-computed units-sold map; the sorters stay
  // pure and are covered by npm run test:sort-categories.
  const sortCategories = useMemo(
    () => normalizeSortCategories(brand.sortCategories ?? seedSortCategories(brand.catalogSortStyle)),
    [brand.sortCategories, brand.catalogSortStyle],
  );
  const sortOptions = sortCategoryOptions(sortCategories);

  // The resting state is the FIRST row of the owner's menu — "Sort: Featured"
  // by default, but whatever they drag to the top after reordering, renaming or
  // deleting it. There is deliberately no unnamed placeholder option any more:
  // every row the shopper sees is a row the owner controls.
  const effectiveSort = sort || sortOptions[0]?.value || "";

  const filtered = useMemo(() => {
    let list = products;
    if (category && category !== "all") {
      list = list.filter((p) => p.category === category);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q),
      );
    }
    // No explicit pick → the owner's configured order: one block per sort
    // category, in admin order, unassigned products last. An explicit pick runs
    // that entry (a group floats its members; a built-in sorts everything).
    const sorted = effectiveSort
      ? sortByCategory(list, effectiveSort, sortCategories, { bestSellerCounts: brand.bestSellerCounts })
      : orderCatalogByCategories(list, sortCategories);

    // Featured products pin to the very top — but only on the default view and
    // on group picks. Pinning under an explicit "Price: Low to High" would put a
    // pricier featured item above a cheaper one and just read as a broken sort.
    // A group pick still floats featured products above its members. The
    // "featured" kind pins inside sortByCategory itself, so it is excluded here
    // to keep exactly one owner of that rule.
    const picked = sortCategories.find((c) => c.id === effectiveSort);
    const pinnable = !effectiveSort || picked?.kind === "group";
    const ranked = pinnable ? pinFeatured(sorted) : sorted;

    // On a "per-vial-first" store the packaging tier outranks everything above:
    // single per-vial listings lead, multi-vial kits sit underneath, and the
    // order computed above holds within each tier (orderOnHandProducts is
    // stable). Every other store is a pass-through.
    return orderOnHandProducts(ranked, normalizeOnHandOrder(brand.onHandOrder));
  }, [products, category, query, effectiveSort, sortCategories, brand.bestSellerCounts, brand.onHandOrder]);

  return (
    <section className="catalog section" id="catalog">
      <div className="container">
        <div className="catalog__header">
          <div>
            <div className="eyebrow">{brand.catalogEyebrow || "Catalog"}</div>
            <h2 className="catalog__title font-display">
              {brand.catalogTitle || "Our Collection"}
            </h2>
          </div>

          <div className="catalog__controls">
            {brand.catalogShowSearch !== false && (
              <label className="input-wrap" aria-label="Search">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products…"
                  type="search"
                />
              </label>
            )}

            {brand.catalogShowSort !== false && (
              <label className="input-wrap catalog__sort">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="7" y1="12" x2="20" y2="12" />
                  <line x1="10" y1="18" x2="20" y2="18" />
                </svg>
                <select value={effectiveSort} onChange={(e) => setSort(e.target.value)}>
                  {/* Every option comes from the owner's list — including the
                      Featured row, which used to be hardcoded here and was the
                      one entry they could not rename, reorder or remove. */}
                  {sortOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        {brand.catalogShowCount !== false && (
          <div className="catalog__count eyebrow">
            {filtered.length} {filtered.length === 1 ? "Product" : "Products"}
          </div>
        )}

        <div className="catalog__grid" data-cd-grid={brand.cardDesign?.layout || undefined}>
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              design={brand.cardDesign}
              defaultImage={brand.defaultProductImage}
              gbBlocked={isOnHandBlocked(p.id, brand.groupBuyGate)}
              storeClosed={storeClosed}
              storeName={brand.name}
              onAdd={(qty, variation) => onAddToCart(p, qty, variation)}
              onOpenDetail={() => openDetail(p)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="catalog__empty">
              <p className="font-display" style={{ fontSize: 28, margin: 0 }}>
                No matches.
              </p>
              <p style={{ color: "var(--brand-text-muted)" }}>
                Try a different search or category.
              </p>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <ProductDetailModal
          product={selected}
          onClose={closeDetail}
          onAddToCart={onAddToCart}
          defaultImage={brand.defaultProductImage}
          gbBlocked={isOnHandBlocked(selected.id, brand.groupBuyGate)}
          storeClosed={storeClosed}
          brand={brand}
        />
      )}
    </section>
  );
}
