import type { ShopCartLine, ShopCatalog, ShopProduct } from "@shop-contract";
import { findOption, MAX_LINE_QTY, maxQtyFor, type ShopOption } from "./catalog";

/**
 * The cart as plain data: { productId, variation?, qty } lines, exactly what
 * POST /shop/quote and /shop/orders take. Pure and immutable — every change
 * returns a new array. Stock clamping uses the catalog the shopper is looking
 * at; the server re-checks everything at quote and placement.
 */

export type CartLine = ShopCartLine;

export const MAX_CART_LINES = 50; // the server's MAX_LINES

export function lineKey(line: Pick<CartLine, "productId" | "variation">): string {
  return `${line.productId}::${line.variation ?? ""}`;
}

const clampQty = (qty: number, max: number) => Math.max(0, Math.min(Math.floor(qty), max, MAX_LINE_QTY));

export type AddResult = { lines: CartLine[]; added: number; capped: boolean };

/** Add `qty` of one option, never past `max` in total. */
export function addLine(lines: CartLine[], line: CartLine, max: number = MAX_LINE_QTY): AddResult {
  const key = lineKey(line);
  const existing = lines.find((l) => lineKey(l) === key);
  const current = existing?.qty ?? 0;
  const next = clampQty(current + line.qty, max);
  const added = Math.max(0, next - current);
  const capped = next < current + line.qty;
  if (added === 0) return { lines, added: 0, capped };
  if (existing) {
    return { lines: lines.map((l) => (lineKey(l) === key ? { ...l, qty: next } : l)), added, capped };
  }
  if (lines.length >= MAX_CART_LINES) return { lines, added: 0, capped: true };
  const fresh: CartLine = line.variation ? { productId: line.productId, variation: line.variation, qty: next } : { productId: line.productId, qty: next };
  return { lines: [...lines, fresh], added, capped };
}

/** Set a line's quantity; 0 removes it. */
export function setLineQty(lines: CartLine[], key: string, qty: number, max: number = MAX_LINE_QTY): CartLine[] {
  const next = clampQty(qty, max);
  if (next <= 0) return removeLine(lines, key);
  return lines.map((l) => (lineKey(l) === key ? { ...l, qty: next } : l));
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => lineKey(l) !== key);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export function qtyInCart(lines: CartLine[], productId: string, variation?: string): number {
  return lines.find((l) => lineKey(l) === lineKey({ productId, variation }))?.qty ?? 0;
}

/** A stored cart (AsyncStorage) → valid lines only; anything malformed is dropped. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? (data as { lines?: unknown }).lines : null;
  if (!Array.isArray(list)) return [];
  let out: CartLine[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { productId, variation, qty } = item as Record<string, unknown>;
    if (typeof productId !== "string" || !productId) continue;
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 1) continue;
    const v = typeof variation === "string" && variation ? variation : undefined;
    out = addLine(out, v ? { productId, variation: v, qty } : { productId, qty }).lines;
  }
  return out;
}

export function serializeCart(lines: CartLine[]): string {
  return JSON.stringify({ v: 1, lines });
}

// ── cart × catalog ───────────────────────────────────────────────────────────

export type CartIssue = "missing" | "unavailable" | "soldOut" | "reduced" | null;

export type CartRow = {
  key: string;
  line: CartLine;
  product: ShopProduct | null;
  option: ShopOption | null;
  /** Most this line can hold right now. */
  max: number;
  issue: CartIssue;
};

/**
 * Match every line to the catalog. Lines over the stock left are clamped
 * (issue "reduced"); gone / unbuyable / sold-out lines are kept and flagged so
 * the shopper sees why, rather than vanishing silently.
 */
export function reconcileCart(lines: CartLine[], catalog: Pick<ShopCatalog, "products">): { rows: CartRow[]; lines: CartLine[] } {
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const rows: CartRow[] = [];
  const next: CartLine[] = [];
  for (const line of lines) {
    const key = lineKey(line);
    const product = byId.get(line.productId) ?? null;
    const option = product ? findOption(product, line.variation) : null;
    if (!product || !option) {
      rows.push({ key, line, product, option, max: 0, issue: "missing" });
      next.push(line);
      continue;
    }
    const max = maxQtyFor(option);
    if (option.soldOut || max === 0) {
      rows.push({ key, line, product, option, max: 0, issue: "soldOut" });
      next.push(line);
      continue;
    }
    if (!product.purchasable) {
      rows.push({ key, line, product, option, max, issue: "unavailable" });
      next.push(line);
      continue;
    }
    const qty = Math.min(line.qty, max);
    const fixed = qty === line.qty ? line : { ...line, qty };
    rows.push({ key, line: fixed, product, option, max, issue: qty < line.qty ? "reduced" : null });
    next.push(fixed);
  }
  return { rows, lines: next };
}

/** Lines that can go to the server (flagged ones would only fail the quote). */
export function buyableLines(rows: CartRow[]): CartLine[] {
  return rows.filter((r) => r.issue === null || r.issue === "reduced").map((r) => r.line);
}

export function issueCopy(issue: CartIssue, max: number): string | null {
  switch (issue) {
    case "missing":
      return "No longer available — remove it to continue.";
    case "unavailable":
      return "Can't be ordered right now.";
    case "soldOut":
      return "Sold out — remove it to continue.";
    case "reduced":
      return `Only ${max} left — we lowered the quantity.`;
    default:
      return null;
  }
}

/** True when two line lists hold the same items (order-insensitive). */
export function sameLines(a: CartLine[], b: CartLine[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(a.map((l) => [lineKey(l), l.qty]));
  return b.every((l) => m.get(lineKey(l)) === l.qty);
}
