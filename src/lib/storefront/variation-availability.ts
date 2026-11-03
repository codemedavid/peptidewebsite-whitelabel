// Per-variation availability — one option of a product taken off sale while
// the rest keep selling ("Tirzepatide 50mg isn't in this group buy").
//
// Stored on the variation as `available: false` (only ever `false`: absent =
// listed, so every existing variation keeps selling with no backfill). The
// flag is NOT stripped from the page data: the store admin edits the same
// product objects the storefront renders, and a strip would make the next
// admin save delete the hidden option. Instead every customer-facing option
// builder reads through `listedVariations`, and placement re-checks with
// `unavailableLineViolation`.
//
// Pure; pinned by `npm run test:variation-availability`.

type Listable = { available?: boolean; notInRound?: boolean };

/** Hidden when the owner switched the option off for the whole store
 *  (`available: false`, persisted) OR the live round leaves it out
 *  (`notInRound`, stamped at render/placement by applyRoundExclusions and
 *  never persisted — normalizeProductInput doesn't name it). */
export function isVariationListed(v: Listable | null | undefined): boolean {
  return v?.available !== false && v?.notInRound !== true;
}

/**
 * Stamp `notInRound` on the options the live round excludes (GroupBuy.
 * excludedVariations: productId → names). Products it doesn't name come back
 * as the same objects; no exclusions → the same array.
 */
export function applyRoundExclusions<
  P extends { id: string; variations?: readonly ({ name: string } & Listable)[] | null },
>(products: readonly P[], excluded: Readonly<Record<string, readonly string[]>> | null | undefined): P[] {
  if (!excluded || Object.keys(excluded).length === 0) return products as P[];
  return products.map((p) => {
    const names = excluded[p.id];
    if (!names?.length || !Array.isArray(p.variations)) return p;
    return {
      ...p,
      variations: p.variations.map((v) => (names.includes(v.name) ? { ...v, notInRound: true } : v)),
    };
  });
}

/** The options a customer may see and pick, in the seller's order. */
export function listedVariations<T extends Listable>(variations: readonly T[] | null | undefined): T[] {
  return Array.isArray(variations) ? variations.filter(isVariationListed) : [];
}

/** False when the product HAS variations but every one is hidden — there is
 *  nothing left to sell. A product without variations is a plain listing. */
export function hasListedOption<T extends Listable>(product: { variations?: readonly T[] | null }): boolean {
  const all = Array.isArray(product.variations) ? product.variations : [];
  return all.length === 0 || all.some(isVariationListed);
}

type GuardProduct = {
  id: string;
  name: string;
  available?: boolean;
  variations?: readonly ({ name: string } & Listable)[] | null;
};
type GuardLine = { productId?: string; name: string; variation?: string };

/**
 * The placement boundary: refuse a line whose product the owner switched off,
 * whose chosen option is hidden, or (a bare line) whose every option is hidden.
 * Lines matching no product are skipped — the same matching rule every other
 * order guard uses (productId, else exact name).
 */
export function unavailableLineViolation(products: readonly GuardProduct[], items: readonly GuardLine[]): string | null {
  for (const it of items) {
    const prod = products.find((x) => (it.productId ? x.id === it.productId : x.name === it.name));
    if (!prod) continue;
    if (prod.available === false || !hasListedOption(prod)) {
      return `"${prod.name}" isn't available right now — please remove it from your cart.`;
    }
    if (!it.variation) continue;
    const option = (prod.variations ?? []).find((v) => v.name === it.variation);
    if (option && !isVariationListed(option)) {
      return `"${prod.name} ${it.variation}" isn't available right now — please remove it from your cart.`;
    }
  }
  return null;
}
