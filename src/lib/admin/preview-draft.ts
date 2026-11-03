// The branding editor's live preview: how the operator's UNSAVED draft lands
// on top of the tenant's real, server-resolved storefront Brand.
//
// The preview frame starts from loadStorefrontBrand — exactly what the live
// site renders, entitlement flags, page switches and all — and lays the draft
// config over it. A few values the server normally DERIVES must be re-derived
// here, or the draft would show something the saved store never could:
//
//   homeLayout — "two-ways" is a sold module and "groupbuy" needs the Group Buy
//                module: a draft can't conjure either; it falls back to classic.
//   intlLocal  — normalized, as storefront-brand.ts does on every read.
//   dualMarket — recomputed from the draft's layout + International switch.
//
// And two preview-only stamps: checkout never places an order, and the
// owner's pop-up notice stays shut (it would cover the page on every edit).
//
// Pure — covered by test:preview-draft.

import type { Brand } from "@/storefront/types";
import { normalizeIntlLocalConfig } from "@/lib/storefront/intl-local/normalize";
import { isDualMarket } from "@/lib/storefront/intl-market";

export type PreviewDraftExtras = {
  /** The tenant's name (the editor keeps it outside the config blob). */
  name?: string;
  /** The Branding.logoUrl column — also outside the config blob. */
  logoUrl?: string | null;
};

export function mergePreviewDraft(base: Brand, draft: Partial<Brand>, extras: PreviewDraftExtras = {}): Brand {
  const next: Brand = { ...base, ...draft };
  next.name = draft.name || extras.name || base.name;
  next.logoUrl = draft.logoUrl || extras.logoUrl || base.logoUrl;

  const asked = draft.homeLayout ?? base.homeLayout;
  next.homeLayout =
    asked === "two-ways" && base.homeLayout !== "two-ways"
      ? "classic"
      : asked === "groupbuy" && base.groupBuyCaps?.enabled !== true
        ? "classic"
        : asked;

  if (next.homeLayout === "intl-local" || draft.intlLocal !== undefined) {
    next.intlLocal = normalizeIntlLocalConfig(draft.intlLocal ?? base.intlLocal);
  }
  next.dualMarket = isDualMarket({ homeLayout: next.homeLayout, intlMarket: next.intlMarket });

  next.checkoutPreviewOnly = true;
  next.noticeModal = undefined;
  return next;
}

/** Message protocol between the editor (parent) and the preview frame. */
export type PreviewMessage =
  | { type: "sf-preview:draft"; draft: Partial<Brand>; extras: PreviewDraftExtras }
  | { type: "sf-preview:goto"; hash: string }
  | { type: "sf-preview:select-mode"; on: boolean }
  | { type: "sf-preview:ready" }
  | { type: "sf-preview:route"; hash: string }
  | { type: "sf-preview:select"; region: string };

const TYPES = new Set([
  "sf-preview:draft",
  "sf-preview:goto",
  "sf-preview:select-mode",
  "sf-preview:ready",
  "sf-preview:route",
  "sf-preview:select",
]);

/** A message from the other side — same origin and a known shape only. */
export function readPreviewMessage(e: { origin: string; data: unknown }, expectedOrigin: string): PreviewMessage | null {
  if (e.origin !== expectedOrigin) return null;
  const d = e.data as { type?: unknown } | null;
  return d && typeof d === "object" && typeof d.type === "string" && TYPES.has(d.type) ? (d as PreviewMessage) : null;
}
