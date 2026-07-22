"use client";

// The "two ways to order" storefront HOME (design: "K Glow Store.dc.html").
// One scroll presenting both order paths: a hero, the "Two ways to order" split
// (On-Hand vs the live Group Buy), the ON-HAND product list (ships now), the live
// GROUP BUY card (round chrome + per-item regular-vs-gb price + saving), and a
// "how it works" strip. Opt-in per tenant via brand.homeLayout === "two-ways";
// white-label — every colour comes from the brand CSS variables, so K Glow's pink
// theme drives the look while any tenant with the layout on gets the same home.
// The Header/Footer/cart drawer are owned by the storefront Shell around this.

import type { Brand } from "../types";
import { useStore } from "../store";
import { baseProductId } from "../checkout";
import { buildTwoWaysHomeView, groupBuyCtaTarget } from "@/lib/storefront/two-ways-home";

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
  const { products, cart, addToCart, decrementCart } = useStore();
  const currency = brand.currency || "₱";
  const view = buildTwoWaysHomeView(
    products.filter((p) => p.available !== false),
    brand.groupBuyBanner ?? null,
    currency,
  );

  const gbLive = view.gb.open && view.gb.count > 0;
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

      {/* Two ways to order */}
      <section className="sf-twh__section" aria-labelledby="twh-ways-label">
        <div id="twh-ways-label" className="sf-twh__eyebrow">
          Two ways to order
        </div>
        <div className="sf-twh__ways">
          <a href="#twh-onhand" className="sf-twh__way sf-twh__way--onhand">
            <span className="sf-twh__way-tag sf-twh__way-tag--ships">● Ships now</span>
            <span className="sf-twh__way-name font-display">On-Hand</span>
            <span className="sf-twh__way-copy">In stock, packed &amp; shipped within 24h.</span>
          </a>
          {gbLive ? (
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
          ) : (
            <div className="sf-twh__way sf-twh__way--closed">
              <span className="sf-twh__way-tag sf-twh__way-tag--closed">○ Closed</span>
              <span className="sf-twh__way-name font-display">Group Buy</span>
              <span className="sf-twh__way-copy">No open GB right now — follow us for the next one.</span>
            </div>
          )}
        </div>
      </section>

      {/* On-hand */}
      <section id="twh-onhand" className="sf-twh__section" aria-labelledby="twh-onhand-label">
        <div className="sf-twh__sec-head">
          <div>
            <div className="sf-twh__eyebrow">On-Hand</div>
            <h2 id="twh-onhand-label" className="sf-twh__sec-title font-display">Ships today</h2>
          </div>
          <span className="sf-twh__sec-count">{view.onHand.count} products</span>
        </div>
        {view.onHand.count === 0 ? (
          <p className="sf-twh__empty">Nothing on hand right now — check the group buy above.</p>
        ) : (
          <ul className="sf-twh__list">
            {view.onHand.lines.map((line) => {
              const p = line.product;
              const qty = qtyOf(p.id);
              const canBuy = p.purchasable !== false && !p.priceOnRequest;
              return (
                <li key={p.id} className="sf-twh__row">
                  <span className="sf-twh__avatar font-display" aria-hidden>
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" />
                    ) : (
                      line.initial
                    )}
                  </span>
                  <div className="sf-twh__row-main">
                    <div className="sf-twh__row-name">{p.name}</div>
                    <div className="sf-twh__row-meta">
                      {line.stockLabel && (
                        <span
                          className={`sf-twh__stock${line.inStock ? "" : " sf-twh__stock--out"}`}
                        >
                          {line.inStock ? line.stockLabel : "Out of stock"}
                        </span>
                      )}
                      <span className="sf-twh__coa">COA ✓</span>
                    </div>
                  </div>
                  <div className="sf-twh__row-buy">
                    <div className="sf-twh__row-price">
                      {p.priceOnRequest ? "Ask" : line.priceLabel}
                    </div>
                    {canBuy && line.inStock && (
                      qty === 0 ? (
                        <button
                          type="button"
                          className="sf-twh__add"
                          onClick={() => addToCart(p)}
                        >
                          Add
                        </button>
                      ) : (
                        <div className="sf-twh__stepper" aria-label={`Quantity of ${p.name}`}>
                          <button type="button" aria-label={`Remove one ${p.name}`} onClick={() => decrementCart(p.id)}>
                            −
                          </button>
                          <span aria-live="polite">{qty}</span>
                          <button type="button" aria-label={`Add one ${p.name}`} onClick={() => addToCart(p)}>
                            +
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Live group buy */}
      {gbLive && (
        <section id="twh-gb" className="sf-twh__section" aria-label={`Group buy: ${view.gb.name}`}>
          <div className="sf-twh__gb">
            <div className="sf-twh__gb-top">
              <span className="sf-twh__gb-pill">● Group buy live</span>
              {view.gb.countdown && <span className="sf-twh__gb-countdown">{view.gb.countdown}</span>}
            </div>
            <div className="sf-twh__gb-name font-display">{view.gb.name}</div>
            <p className="sf-twh__gb-terms">
              {view.gb.deliveryEta ? `Delivery ${view.gb.deliveryEta}. ` : ""}Pay now to lock your slot.
            </p>

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

            <ul className="sf-twh__gb-items">
              {view.gb.lines.map((line) => {
                const p = line.product;
                const qty = qtyOf(p.id);
                return (
                  <li key={p.id} className="sf-twh__gb-item">
                    <div className="sf-twh__gb-item-main">
                      <div className="sf-twh__gb-item-name">{p.name}</div>
                      {line.hasSavings && (
                        <div className="sf-twh__gb-item-reg">On-hand {line.regularLabel}</div>
                      )}
                    </div>
                    <div className="sf-twh__gb-item-buy">
                      <div className="sf-twh__gb-item-price font-display">{line.gbLabel}</div>
                      {line.hasSavings && <div className="sf-twh__gb-save">save {line.saveLabel}</div>}
                    </div>
                    {qty === 0 ? (
                      <button type="button" className="sf-twh__gb-add" onClick={() => addToCart(p)}>
                        Join
                      </button>
                    ) : (
                      <div className="sf-twh__stepper sf-twh__stepper--gb" aria-label={`Quantity of ${p.name}`}>
                        <button type="button" aria-label={`Remove one ${p.name}`} onClick={() => decrementCart(p.id)}>
                          −
                        </button>
                        <span aria-live="polite">{qty}</span>
                        <button type="button" aria-label={`Add one ${p.name}`} onClick={() => addToCart(p)}>
                          +
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

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
          How group buys work
        </div>
        <ol className="sf-twh__steps">
          {[
            "Browse what's on hand for instant shipping, or join the live group buy for a lower price.",
            "Pay to lock your slot at the group price while the round is open.",
            "When the round closes, we place one bulk order with the supplier.",
            `Your order ships${view.gb.deliveryEta ? ` ${view.gb.deliveryEta}` : " after the round closes"}, COA posted before shipping.`,
          ].map((text, i) => (
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

// Scoped to .sf-twh. Structure + motion live here (mirrors GroupBuyPage's inline
// <style>); all colour resolves from the brand CSS variables, with the K Glow
// pink design as the fallback so an unthemed preview still reads correctly.
const twhCss = `
.sf-root .sf-twh { max-width: 560px; margin: 0 auto; }
.sf-root .sf-twh__section { padding: 0 20px; margin-top: 28px; }
.sf-root .sf-twh__eyebrow {
  font-size: 12px; letter-spacing: .14em; font-weight: 700; text-transform: uppercase;
  color: var(--brand-main, #c81e6e); margin-bottom: 10px;
}
.sf-root .sf-twh__hero {
  padding: 40px 24px 4px;
  background: linear-gradient(180deg, color-mix(in oklab, var(--brand-main, #c81e6e) 12%, var(--brand-bg, #fdf1f6)) 0%, var(--brand-bg, #fdf1f6) 100%);
}
.sf-root .sf-twh__hero-title { margin: 0; line-height: 1.02; color: var(--brand-main, #c81e6e); }
.sf-root .sf-twh__hero-title span { display: block; }
.sf-root .sf-twh__hero-title > span:first-child { font-size: clamp(40px, 12vw, 52px); font-weight: 700; }
.sf-root .sf-twh__hero-em { font-style: italic; font-size: clamp(34px, 10vw, 44px); font-weight: 500; margin-top: 2px; }
.sf-root .sf-twh__hero-sub {
  margin: 14px 0 0; font-size: 14px; line-height: 1.5; text-wrap: pretty;
  color: var(--brand-text-muted, #8a4a66);
}
.sf-root .sf-twh__ways { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sf-root .sf-twh__way {
  display: flex; flex-direction: column; gap: 6px; border-radius: 18px; padding: 16px 14px;
  text-decoration: none; border: 1px solid var(--hairline, #f6d9e7); background: var(--brand-surface, #fff);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main, #c81e6e) 8%, transparent);
  transition: transform .15s ease, box-shadow .15s ease;
}
.sf-root a.sf-twh__way:hover { transform: translateY(-2px); box-shadow: 0 6px 18px color-mix(in oklab, var(--brand-main, #c81e6e) 16%, transparent); }
.sf-root .sf-twh__way--gb { background: var(--brand-main, #c81e6e); border-color: transparent; box-shadow: 0 4px 14px color-mix(in oklab, var(--brand-main, #c81e6e) 35%, transparent); }
.sf-root .sf-twh__way--closed { border-style: dashed; background: color-mix(in oklab, var(--brand-main, #c81e6e) 6%, #fff); }
.sf-root .sf-twh__way-tag { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.sf-root .sf-twh__way-tag--ships { color: var(--brand-success, #1a8a5c); }
.sf-root .sf-twh__way-tag--open { color: color-mix(in oklab, #fff 78%, var(--brand-main, #c81e6e)); }
.sf-root .sf-twh__way-tag--closed { color: var(--brand-text-muted, #b08a9b); }
.sf-root .sf-twh__way-name { font-size: 20px; color: var(--brand-text, #3a1f2c); }
.sf-root .sf-twh__way--gb .sf-twh__way-name { color: var(--brand-button-text, #fff); }
.sf-root .sf-twh__way-copy { font-size: 12px; line-height: 1.4; color: var(--brand-text-muted, #8a4a66); }
.sf-root .sf-twh__way--gb .sf-twh__way-copy { color: color-mix(in oklab, #fff 82%, var(--brand-main, #c81e6e)); }
.sf-root .sf-twh__sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sf-root .sf-twh__sec-title { margin: 4px 0 0; font-size: clamp(24px, 7vw, 28px); color: var(--brand-text, #3a1f2c); }
.sf-root .sf-twh__sec-count { font-size: 12px; color: var(--brand-text-muted, #8a4a66); white-space: nowrap; }
.sf-root .sf-twh__empty { font-size: 13px; color: var(--brand-text-muted, #8a4a66); margin: 12px 0 0; }
.sf-root .sf-twh__list { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.sf-root .sf-twh__row {
  display: flex; align-items: center; gap: 14px; background: var(--brand-surface, #fff);
  border: 1px solid var(--hairline, #f6d9e7); border-radius: 18px; padding: 14px;
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main, #c81e6e) 7%, transparent);
}
.sf-root .sf-twh__avatar {
  width: 56px; height: 56px; border-radius: 14px; flex-shrink: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
  color: var(--brand-main, #c81e6e); background: color-mix(in oklab, var(--brand-main, #c81e6e) 12%, #fff);
}
.sf-root .sf-twh__avatar img { width: 100%; height: 100%; object-fit: cover; }
.sf-root .sf-twh__row-main { flex: 1; min-width: 0; }
.sf-root .sf-twh__row-name { font-weight: 700; font-size: 15px; color: var(--brand-text, #3a1f2c); }
.sf-root .sf-twh__row-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.sf-root .sf-twh__stock {
  font-size: 11px; font-weight: 700; color: var(--brand-success, #1a8a5c);
  background: color-mix(in oklab, var(--brand-success, #1a8a5c) 14%, #fff); border-radius: 99px; padding: 2px 8px;
}
.sf-root .sf-twh__stock--out { color: var(--brand-text-muted, #8a4a66); background: color-mix(in oklab, var(--brand-text-muted, #8a4a66) 14%, #fff); }
.sf-root .sf-twh__coa { font-size: 11px; color: var(--brand-text-muted, #8a4a66); }
.sf-root .sf-twh__row-buy { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.sf-root .sf-twh__row-price { font-weight: 700; font-size: 16px; color: var(--brand-text, #3a1f2c); }
.sf-root .sf-twh__add {
  border: 0; cursor: pointer; font-weight: 700; font-size: 12px; border-radius: 99px; padding: 5px 14px;
  color: var(--brand-main, #c81e6e); background: color-mix(in oklab, var(--brand-main, #c81e6e) 12%, #fff);
  transition: background .15s ease, color .15s ease;
}
.sf-root .sf-twh__add:hover { background: var(--brand-main, #c81e6e); color: var(--brand-button-text, #fff); }
.sf-root .sf-twh__stepper {
  display: flex; align-items: center; gap: 6px; border-radius: 99px; padding: 3px;
  background: color-mix(in oklab, var(--brand-main, #c81e6e) 12%, #fff);
}
.sf-root .sf-twh__stepper button {
  width: 28px; height: 28px; border: 0; border-radius: 99px; cursor: pointer; line-height: 1;
  font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center;
}
.sf-root .sf-twh__stepper button:first-child { background: #fff; color: var(--brand-main, #c81e6e); }
.sf-root .sf-twh__stepper button:last-child { background: var(--brand-main, #c81e6e); color: var(--brand-button-text, #fff); }
.sf-root .sf-twh__stepper span { font-weight: 700; font-size: 13px; min-width: 16px; text-align: center; color: var(--brand-main, #c81e6e); }
.sf-root .sf-twh__stepper--gb { background: color-mix(in oklab, #fff 22%, transparent); }
.sf-root .sf-twh__stepper--gb span { color: #fff; }
.sf-root .sf-twh__stepper--gb button:first-child { background: #fff; color: var(--brand-main, #c81e6e); }
.sf-root .sf-twh__gb {
  background: var(--brand-main, #c81e6e); color: var(--brand-button-text, #fff);
  border-radius: 26px; padding: 24px 18px;
  box-shadow: 0 8px 28px color-mix(in oklab, var(--brand-main, #c81e6e) 35%, transparent);
}
.sf-root .sf-twh__gb-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sf-root .sf-twh__gb-pill {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--brand-main, #c81e6e); background: #fff; border-radius: 99px; padding: 5px 12px; white-space: nowrap;
}
.sf-root .sf-twh__gb-countdown { font-size: 12px; font-weight: 700; opacity: .92; }
.sf-root .sf-twh__gb-name { font-size: clamp(26px, 8vw, 30px); margin-top: 14px; }
.sf-root .sf-twh__gb-terms { font-size: 13px; line-height: 1.5; margin: 4px 0 0; opacity: .92; }
.sf-root .sf-twh__gb-slots { margin-top: 16px; }
.sf-root .sf-twh__gb-slots-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.sf-root .sf-twh__gb-bar { height: 8px; background: color-mix(in oklab, #fff 25%, transparent); border-radius: 99px; overflow: hidden; }
.sf-root .sf-twh__gb-bar-fill { height: 100%; background: #fff; border-radius: 99px; transition: width .4s ease; }
.sf-root .sf-twh__gb-items { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sf-root .sf-twh__gb-item {
  display: flex; align-items: center; gap: 12px; border-radius: 16px; padding: 12px 14px;
  background: color-mix(in oklab, #fff 12%, transparent); border: 1px solid color-mix(in oklab, #fff 25%, transparent);
}
.sf-root .sf-twh__gb-item-main { flex: 1; min-width: 0; }
.sf-root .sf-twh__gb-item-name { font-weight: 700; font-size: 14px; }
.sf-root .sf-twh__gb-item-reg { font-size: 11px; opacity: .85; margin-top: 2px; text-decoration: line-through; }
.sf-root .sf-twh__gb-item-buy { text-align: right; }
.sf-root .sf-twh__gb-item-price { font-size: 16px; font-weight: 700; }
.sf-root .sf-twh__gb-save {
  font-size: 10px; font-weight: 700; color: var(--brand-main, #c81e6e);
  background: color-mix(in oklab, #fff 82%, var(--brand-main, #c81e6e)); border-radius: 99px; padding: 2px 8px; margin-top: 3px;
}
.sf-root .sf-twh__gb-add {
  border: 0; cursor: pointer; font-weight: 700; font-size: 12px; border-radius: 99px; padding: 8px 14px;
  color: var(--brand-main, #c81e6e); background: #fff; transition: filter .15s ease;
}
.sf-root .sf-twh__gb-add:hover { filter: brightness(0.94); }
.sf-root .sf-twh__gb-cta {
  width: 100%; margin-top: 18px; border: 0; cursor: pointer; border-radius: 99px; padding: 15px;
  font-weight: 700; font-size: 15px; color: var(--brand-main, #c81e6e); background: #fff; transition: filter .15s ease;
}
.sf-root .sf-twh__gb-cta:hover { filter: brightness(0.94); }
.sf-root .sf-twh__gb-foot { font-size: 11px; text-align: center; margin-top: 10px; opacity: .9; }
.sf-root .sf-twh__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sf-root .sf-twh__step { display: flex; gap: 12px; align-items: flex-start; font-size: 13px; line-height: 1.5; color: var(--brand-text, #5d3a4b); }
.sf-root .sf-twh__step-n {
  flex-shrink: 0; width: 26px; height: 26px; border-radius: 99px; font-weight: 700; font-size: 13px;
  display: flex; align-items: center; justify-content: center; margin-top: 1px;
  color: var(--brand-main, #c81e6e); background: color-mix(in oklab, var(--brand-main, #c81e6e) 12%, #fff);
}
`;
