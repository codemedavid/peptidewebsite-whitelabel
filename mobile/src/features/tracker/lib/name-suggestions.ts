/**
 * "What are you taking?" suggestions (setup step 1). The name is FREE TEXT —
 * any peptide or product, in the shop or not. Suggestions only save typing:
 *   - mine: names this account already tracks (newest first, one per name);
 *   - shop: the store's products (links the product for "Reorder").
 * `isCustom` says the typed name isn't one of the store's products, so the
 * screen can confirm it'll be tracked as the person's own. Pure.
 */

export type NameOption = { name: string; catalogId: string | null };

export type NameSuggestions = {
  mine: NameOption[];
  shop: NameOption[];
  /** Something is typed and it isn't a shop product's name. */
  isCustom: boolean;
};

export const MAX_MINE = 4;
export const MAX_SHOP = 6;

/** Case- and spacing-insensitive form used for matching. */
export function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function nameSuggestions(
  typed: string,
  mine: readonly { name: string; catalogId: string | null }[],
  shop: readonly { id: string; name: string }[],
): NameSuggestions {
  const q = normName(typed);
  const matches = (name: string) => {
    const n = normName(name);
    return n !== "" && n !== q && (q === "" || n.includes(q));
  };

  const seen = new Set<string>();
  const mineOut: NameOption[] = [];
  for (const p of mine) {
    const key = normName(p.name);
    if (seen.has(key) || !matches(p.name)) continue;
    seen.add(key);
    mineOut.push({ name: p.name.trim(), catalogId: p.catalogId });
    if (mineOut.length === MAX_MINE) break;
  }

  const shopOut: NameOption[] = [];
  for (const p of shop) {
    const key = normName(p.name);
    if (seen.has(key) || !matches(p.name)) continue;
    seen.add(key);
    shopOut.push({ name: p.name, catalogId: p.id });
    if (shopOut.length === MAX_SHOP) break;
  }

  const isCustom = q !== "" && !shop.some((p) => normName(p.name) === q);
  return { mine: mineOut, shop: shopOut, isCustom };
}
