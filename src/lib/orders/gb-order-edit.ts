// Admin edits to a customer's order lines (add, remove, change quantity),
// re-priced on the server.
//
// The admin sends the WHOLE edited line list: `{ index, qty }` for a line the
// order already has (leaving one out removes it), `{ productId, variation?,
// qty }` for a new one. Prices never come from the browser:
//   • a kept or lowered line holds its snapshot price — what the customer was
//     charged;
//   • a new line, and the extra vials when a line is raised, are priced from
//     the live catalog through the checkout's own authoritativeItemPrice (so a
//     variation of a round product gets the same gbPrice the cart charges).
// Raising a line APPENDS the extra vials as their own line stamped
// placedAt/addedBy, so Ligwak treats them as the newest vials, not as vials
// placed when the order was.
//
// Pure. Stock moves, the audit trail and the Bunuan warning (bunuanEditWarnings
// on `kitDeltas`) are the caller's. Tested by npm run test:gb-reprice.

import { kitKey } from "@/lib/storefront/gb-kits";
import type { GroupBuyPriceScope } from "@/lib/storefront/two-ways";
import { authoritativeItemPrice, makeVariationEntry } from "@/storefront/checkout";
import type { OrderItem, Product } from "@/storefront/types";

const MAX_QTY = 999;
const MAX_LINES = 100;

/** An order line, plus the stamps a store-added line carries. */
export type EditedOrderItem = OrderItem & { placedAt?: string; addedBy?: "store" };

/** One line of the admin's edited list (untrusted). */
export type EditedLine = { index?: number; productId?: string; variation?: string; qty: unknown };

export type LineChange = {
  kind: "added" | "removed" | "qty";
  key: string;
  name: string;
  variation: string | null;
  fromQty: number;
  toQty: number;
  price: number;
};

export type RepriceResult =
  | { ok: true; items: EditedOrderItem[]; changes: LineChange[]; kitDeltas: Record<string, number> }
  | { ok: false; error: string };

type Opts = { scope?: GroupBuyPriceScope | null; now: string };
type Priced = { ok: true; item: EditedOrderItem } | { ok: false; error: string };

function parseQty(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= MAX_QTY ? raw : null;
}

/** A fresh line for `qty` of a catalog option, priced live and stamped. */
function catalogLine(
  ref: { productId?: string; variation?: string },
  qty: number,
  catalog: readonly Product[],
  opts: Opts,
): Priced {
  const product = ref.productId ? catalog.find((p) => p.id === ref.productId) : undefined;
  if (!product) return { ok: false, error: "That product isn't in the catalog anymore." };
  const variation = ref.variation ? (product.variations ?? []).find((v) => v.name === ref.variation) : undefined;
  if (ref.variation && !variation) return { ok: false, error: `${product.name} has no "${ref.variation}" option.` };
  const price = authoritativeItemPrice(
    { productId: product.id, name: product.name, qty, variation: variation?.name },
    catalog as Product[],
    opts.scope ?? null,
  );
  if (price == null) return { ok: false, error: `${product.name} can't be priced from the catalog.` };
  const name = variation ? makeVariationEntry(product, variation).name : product.name;
  return {
    ok: true,
    item: {
      name,
      qty,
      price,
      productId: product.id,
      ...(variation ? { variation: variation.name } : {}),
      placedAt: opts.now,
      addedBy: "store",
    },
  };
}

function change(kind: LineChange["kind"], item: OrderItem, fromQty: number, toQty: number): LineChange {
  return { kind, key: kitKey(item), name: item.name, variation: item.variation ?? null, fromQty, toQty, price: item.price };
}

/** Existing-line refs by index, or an error for a bad / repeated index or qty. */
function readRefs(edited: readonly EditedLine[], count: number): Map<number, number> | string {
  const refs = new Map<number, number>();
  for (const line of edited) {
    if (line.index === undefined) continue;
    if (!Number.isInteger(line.index) || line.index < 0 || line.index >= count) return "That line isn't on this order.";
    if (refs.has(line.index)) return "A line appears twice in the edit.";
    const qty = parseQty(line.qty);
    if (qty === null) return `Quantities must be whole numbers from 0 to ${MAX_QTY}.`;
    refs.set(line.index, qty);
  }
  return refs;
}

function vialsByKey(items: readonly OrderItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(kitKey(item), (out.get(kitKey(item)) ?? 0) + item.qty);
  return out;
}

function kitDeltasBetween(before: readonly OrderItem[], after: readonly OrderItem[]): Record<string, number> {
  const was = vialsByKey(before);
  const now = vialsByKey(after);
  const out: Record<string, number> = {};
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const delta = (now.get(key) ?? 0) - (was.get(key) ?? 0);
    if (delta !== 0) out[key] = delta;
  }
  return out;
}

/** Re-price the admin's edited line list against the live catalog. */
export function repriceEditedLines(
  current: readonly OrderItem[],
  edited: readonly EditedLine[],
  catalog: readonly Product[],
  opts: Opts,
): RepriceResult {
  if (!Array.isArray(edited) || edited.length > MAX_LINES) return { ok: false, error: `An order can hold up to ${MAX_LINES} lines.` };
  const refs = readRefs(edited, current.length);
  if (typeof refs === "string") return { ok: false, error: refs };

  const kept: EditedOrderItem[] = [];
  const appended: EditedOrderItem[] = [];
  const changes: LineChange[] = [];
  for (const [index, item] of current.entries()) {
    const qty = refs.get(index) ?? 0;
    if (qty === 0) {
      changes.push(change("removed", item, item.qty, 0));
      continue;
    }
    kept.push({ ...item, qty: Math.min(qty, item.qty) });
    if (qty < item.qty) changes.push(change("qty", item, item.qty, qty));
    if (qty > item.qty) {
      const extra = catalogLine(item, qty - item.qty, catalog, opts);
      if (!extra.ok) return extra;
      appended.push(extra.item);
      changes.push(change("added", extra.item, 0, extra.item.qty));
    }
  }
  for (const line of edited) {
    if (line.index !== undefined) continue;
    const qty = parseQty(line.qty);
    if (!qty) return { ok: false, error: `New lines need a quantity from 1 to ${MAX_QTY}.` };
    const added = catalogLine(line, qty, catalog, opts);
    if (!added.ok) return added;
    appended.push(added.item);
    changes.push(change("added", added.item, 0, qty));
  }

  const items = [...kept, ...appended];
  if (items.length === 0) return { ok: false, error: "An order needs at least one line — cancel the order instead." };
  if (items.length > MAX_LINES) return { ok: false, error: `An order can hold up to ${MAX_LINES} lines.` };
  return { ok: true, items, changes, kitDeltas: kitDeltasBetween(current, items) };
}
