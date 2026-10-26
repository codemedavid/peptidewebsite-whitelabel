// Group-buy kits — what a kit IS, how big it is, and which vials count toward it.
//
//   Kit identity — one kit per VARIATION (product + variation), the same SKU
//     identity the supplier report uses (productLineKey). "Tirzepatide — 30mg"
//     fills its own kit, never the 15mg one.
//   Kit size — the variation's `kitSize`, falling back to the product's
//     `vialsPerKit` (gb-moq-kits). No size anywhere = not part of kits.
//   Counting rule — ONE function per payment mode, read by the admin counter,
//     the Bunuan checkout cap, Ligwak and the supplier report, so none of them
//     can promise a kit another later says is incomplete:
//       pay_first → only orders whose payment was checked (committed);
//       pay_later → every placed order that isn't cancelled / refunded.
//
// Pure + JSON-safe (orders arrive as StorefrontOrder rows; items is untrusted
// JSON). Tested by npm run test:gb-kits.

import { kitsToOrder, normalizeVialsPerKit, type KitColumns } from "./gb-moq-kits";
import { orderCountsAsCommitted, orderCountsAsDemand, productLineKey } from "./group-buy";

/** How a round collects money. Mirrors Wave 1B's gb-payment-mode union. */
export type GbPaymentMode = "pay_first" | "pay_later";

/** One order line as the kit rules read it. `cancelledQty` = vials ligwak'd off
 *  this line; `placedAt` = when store-added vials were added (else the order's). */
export type KitLine = {
  index: number;
  name: string;
  qty: number;
  productId?: string;
  variation?: string;
  cancelledQty?: number;
  placedAt?: string;
};

/** The order fields the kit rules read. `items` is the raw items JSON. */
export type KitOrder = {
  id: string;
  orderNumber?: string;
  placedAt: string;
  status: string;
  paymentStatus?: string;
  items: unknown;
};

/** The product fields the kit rules read (storefront Product fits). */
export type KitProduct = {
  id: string;
  vialsPerKit?: unknown;
  variations?: readonly { name: string; kitSize?: unknown }[];
};

/** Where one kit (variation) stands. vialsNeeded = 0 when leftover is 0. */
export type KitTallyEntry = {
  key: string;
  productId: string | null;
  variation: string | null;
  name: string;
  vials: number;
  kitSize: number | null;
  fullKits: number;
  leftover: number;
  vialsNeeded: number;
};

export type KitTally = Readonly<Record<string, KitTallyEntry>>;

type ProductIndex = ReadonlyMap<string, KitProduct>;

/** The kit a line fills — exactly the supplier report's SKU key. */
export function kitKey(line: { name: string; productId?: string; variation?: string }): string {
  return productLineKey(line);
}

/** Untrusted kit size → a positive whole number, or undefined (not set). */
export function normalizeKitSize(raw: unknown): number | undefined {
  return normalizeVialsPerKit(raw);
}

/** The kit size for one option of a product: the variation's own kitSize, else
 *  the product's vialsPerKit, else null. An empty/absent variation = the base. */
export function kitSizeFor(product: KitProduct, variationName?: string): number | null {
  const wanted = (variationName ?? "").trim();
  if (wanted) {
    const variation = (product.variations ?? []).find((v) => (v?.name ?? "").trim() === wanted);
    const own = normalizeKitSize(variation?.kitSize);
    if (own) return own;
  }
  return normalizeKitSize(product.vialsPerKit) ?? null;
}

/** The spec formulas for `vials` of demand against one kit size. */
export function kitMath(
  vials: number,
  kitSize: number | null | undefined,
): { fullKits: number; leftover: number; vialsNeeded: number } {
  const total = Math.max(0, Math.floor(vials));
  if (!kitSize || kitSize <= 0) return { fullKits: 0, leftover: 0, vialsNeeded: 0 };
  const leftover = total % kitSize;
  return { fullKits: Math.floor(total / kitSize), leftover, vialsNeeded: leftover === 0 ? 0 : kitSize - leftover };
}

/** THE counting rule: does this order's demand count toward kits? */
export function countsTowardKits(
  order: { status: string; paymentStatus?: string },
  mode: GbPaymentMode,
): boolean {
  if (!orderCountsAsDemand(order.status)) return false;
  return mode === "pay_later" || orderCountsAsCommitted(order.status, order.paymentStatus);
}

const optionalText = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.trim() ? raw : undefined;

/** Untrusted items JSON → the lines that carry real vials, each keeping its
 *  index in the original array so results can be written back to the order. */
export function readKitLines(items: unknown): KitLine[] {
  if (!Array.isArray(items)) return [];
  const lines: KitLine[] = [];
  items.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as Record<string, unknown>;
    const qty = Math.floor(Number(item.qty));
    if (!Number.isFinite(qty) || qty <= 0) return;
    const cancelled = Math.floor(Number(item.cancelledQty));
    lines.push({
      index,
      name: typeof item.name === "string" ? item.name : "",
      qty,
      productId: optionalText(item.productId),
      variation: optionalText(item.variation),
      cancelledQty: Number.isFinite(cancelled) && cancelled > 0 ? Math.min(cancelled, qty) : undefined,
      placedAt: optionalText(item.placedAt),
    });
  });
  return lines;
}

/** Vials a line still contributes after any ligwak cancellation. */
export function countedVials(line: Pick<KitLine, "qty" | "cancelledQty">): number {
  return Math.max(0, line.qty - (line.cancelledQty ?? 0));
}

export function indexProducts(products: readonly KitProduct[]): ProductIndex {
  return new Map(products.map((p) => [p.id, p]));
}

/** The kit size a line's variation gets from the catalog (null when unknown). */
export function kitSizeForLine(line: { productId?: string; variation?: string }, index: ProductIndex): number | null {
  const product = line.productId ? index.get(line.productId) : undefined;
  return product ? kitSizeFor(product, line.variation) : null;
}

/** Per kit: vials counted under the payment mode, and where the kit stands. */
export function tallyKits(
  orders: readonly KitOrder[],
  products: readonly KitProduct[],
  mode: GbPaymentMode,
): KitTally {
  const index = indexProducts(products);
  const vials = new Map<string, { line: KitLine; vials: number }>();
  for (const order of orders) {
    if (!countsTowardKits(order, mode)) continue;
    for (const line of readKitLines(order.items)) {
      const key = kitKey(line);
      const prev = vials.get(key);
      vials.set(key, { line: prev?.line ?? line, vials: (prev?.vials ?? 0) + countedVials(line) });
    }
  }
  const out: Record<string, KitTallyEntry> = {};
  for (const [key, { line, vials: count }] of vials) {
    const kitSize = kitSizeForLine(line, index);
    out[key] = {
      key,
      productId: line.productId ?? null,
      variation: line.variation ?? null,
      name: line.name,
      vials: count,
      kitSize,
      ...kitMath(count, kitSize),
    };
  }
  return out;
}

/** Decorate supplier rows (one per product + variation) with kits to order and
 *  how short the last kit is, using each VARIATION's kit size. Returns new rows. */
export function withLineKitColumns<
  R extends { productId: string | null; variation?: string | null; vials: number },
>(rows: readonly R[], products: readonly KitProduct[]): Array<R & KitColumns> {
  const index = indexProducts(products);
  return rows.map((row) => {
    const size = kitSizeForLine({ productId: row.productId ?? undefined, variation: row.variation ?? undefined }, index);
    const kit = kitsToOrder(row.vials, size);
    return { ...row, vialsPerKit: kit ? size : null, kits: kit?.kits ?? null, shortBy: kit?.shortBy ?? null };
  });
}
