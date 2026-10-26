// The live group-buy round for the Pepweb app — pure (no DB, no React), so the
// shop catalog, the chat cards and npm run test:group-buy-share all share it.
//
// The round itself is the website's: loadStorefrontBrand already builds the
// banner (with the real filled-slot count), the owner's copy and the per-way
// mode. This only projects them into the app's two shapes:
//
//   ShopGroupBuy  — the shop's banner + group-buy screen (shop-contract.ts)
//   GroupBuyCard  — the card shared into chat (contract.ts)
//
// Prices are never computed here: fromPrice is the lowest of the prices the
// catalog already charges (unitPrice with the round's scope applied).

import { normalizeGbStage } from "@/lib/storefront/gb-stage";
import type { GroupBuyBanner } from "@/lib/storefront/group-buy-banner";
import { formatGbMoney } from "@/lib/storefront/group-buy-page";
import { formatMoney } from "@/lib/storefront/currency";
import { normalizeGroupBuyContent, renderGbCopy, type GroupBuyContent } from "@/lib/storefront/gb-content";
import { renderGroupBuyLiveBanner } from "@/lib/storefront/gb-live-banner";
import { normalizeGroupBuyInvoice } from "@/lib/storefront/gb-invoice";
import type { GbPaymentMode } from "@/lib/storefront/gb-payment-mode";
import type { TwoWaysMode } from "@/lib/storefront/two-ways-mode";
import type { GroupBuyCard } from "./contract";
import type { ShopGroupBuy, ShopGroupBuyTeaser, ShopProduct } from "./shop-contract";

const MAX_IMAGES = 4;

export type ShopGroupBuyInput = {
  banner: GroupBuyBanner | null | undefined;
  content: GroupBuyContent | null | undefined;
  /** The owner's live-strip settings (brand.groupBuyLiveBanner); absent = on, automatic text. */
  liveBanner?: unknown;
  /** branding.config.groupBuyInvoice; absent = pay at checkout. */
  invoice?: unknown;
  /** The store's resolved payment mode (gbPaymentModeFor); absent = the invoice switch decides. */
  paymentMode?: GbPaymentMode;
  /** The resolved per-way mode (brand.twoWaysMode); absent = both open. */
  ways: TwoWaysMode | null | undefined;
  /** The catalog's listed products, already mapped (isGroupBuy set). */
  products: readonly ShopProduct[];
};

function lowestPrice(products: readonly ShopProduct[]): number | null {
  const prices = products.flatMap((p) => [...(p.baseSelectable ? [p.price] : []), ...p.variations.map((v) => v.price)]);
  const valid = prices.filter((n) => Number.isFinite(n) && n > 0);
  return valid.length ? Math.min(...valid) : null;
}

/** The live round as the shop shows it, or null when there's nothing to show. */
export function buildShopGroupBuy({ banner, content, liveBanner, invoice, paymentMode, ways, products }: ShopGroupBuyInput): ShopGroupBuy | null {
  if (!banner || ways?.groupBuy === "hidden") return null;
  const inRound = products.filter((p) => p.isGroupBuy);
  if (inRound.length === 0) return null;
  const copy = normalizeGroupBuyContent(content);
  const fill = (text: string) => renderGbCopy(text, banner.deliveryEta);
  return {
    id: banner.id,
    name: banner.name,
    description: banner.description,
    deliveryEta: banner.deliveryEta,
    endsAt: banner.endsAt,
    ordering: ways?.groupBuy === "closed" ? "closed" : "open",
    slotGoal: Math.max(0, Math.floor(banner.slotGoal || 0)),
    filled: Math.max(0, Math.floor(banner.filled || 0)),
    productIds: inRound.map((p) => p.id),
    fromPrice: lowestPrice(inRound),
    images: inRound.flatMap((p) => (p.image ? [p.image] : [])).slice(0, MAX_IMAGES),
    howTitle: copy.howTitle,
    steps: copy.steps.map(fill),
    terms: fill(copy.terms),
    liveBanner: renderGroupBuyLiveBanner(liveBanner, banner),
    invoice: invoiceTerms(invoice, paymentMode),
    ...(banner.stage ? { stage: normalizeGbStage(banner.stage) } : {}),
    ...(banner.bunuan ? { bunuan: { open: banner.bunuan.open.map((i) => ({ ...i })) } } : {}),
  };
}

function invoiceTerms(raw: unknown, mode: GbPaymentMode | undefined): ShopGroupBuy["invoice"] {
  const config = normalizeGroupBuyInvoice(raw);
  const payLater = mode ? mode === "pay_later" : config.enabled;
  return payLater ? { shippingFee: config.shippingFee } : null;
}

/** The live round as a chat card. */
export function groupBuyCardFrom(gb: ShopGroupBuy, currency: string): GroupBuyCard {
  return {
    id: gb.id,
    name: gb.name,
    description: gb.description,
    deliveryEta: gb.deliveryEta,
    endsAt: gb.endsAt,
    status: gb.ordering === "closed" ? "closed" : "open",
    slotGoal: gb.slotGoal,
    filled: gb.filled,
    productCount: gb.productIds.length,
    fromPriceLabel: gb.fromPrice === null ? null : formatGbMoney(currency, gb.fromPrice),
    images: [...gb.images],
    terms: gb.terms,
  };
}

/** "₱500" / "₱499.50" — centavos kept only when there are any. */
export function joinFeeLabel(currency: string, cents: number): string {
  const safe = Math.max(0, Math.floor(cents || 0));
  return formatMoney(safe / 100, currency, { decimals: safe % 100 !== 0 });
}

/** A paid round as a chat card (gb-access). The card is cached per store and
 *  shown to every member, so it is the teaser for everyone: no photos, no
 *  prices, no product count — the shop shows approved members the rest.
 *  Null unless the round is live (an upcoming/closed round isn't sendable). */
export function teaserGroupBuyCard(teaser: ShopGroupBuyTeaser, currency: string): GroupBuyCard | null {
  if (teaser.state !== "live") return null;
  return {
    id: teaser.id,
    name: teaser.name,
    description: "",
    deliveryEta: "",
    endsAt: teaser.endsAt,
    status: "open",
    slotGoal: 0,
    filled: 0,
    productCount: 0,
    fromPriceLabel: null,
    images: [],
    terms: `Members only · ${teaserWayIn(teaser, currency)}. Join in the shop to see this group buy.`,
  };
}

/** "₱500 to join" / "Pay ₱500 → Admin approval" — the way in, never a price list. */
function teaserWayIn(teaser: ShopGroupBuyTeaser, currency: string): string {
  const steps = (teaser.steps ?? []).filter((s) => s !== "Access");
  if (steps.length > 0) return steps.join(" → ");
  return teaser.joinFeeCents > 0 ? `${joinFeeLabel(currency, teaser.joinFeeCents)} to join` : "join to get in";
}

/** A round that is no longer live: its name survives, nothing else is promised. */
export function endedGroupBuyCard(round: { id: string; name: string }): GroupBuyCard {
  return {
    id: round.id,
    name: round.name,
    description: "",
    deliveryEta: "",
    endsAt: null,
    status: "ended",
    slotGoal: 0,
    filled: 0,
    productCount: 0,
    fromPriceLabel: null,
    images: [],
    terms: "",
  };
}
