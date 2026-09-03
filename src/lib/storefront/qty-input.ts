// What a TYPED quantity means.
//
// Every quantity control on the storefront used to be a −/+ stepper wrapped
// around a read-only <span>: the only way to order 12 vials was to tap "+"
// eleven times, and a reseller on a 50-unit MOQ had to tap it forty-nine. This
// module is the one place that decides what the digits a customer types mean,
// so the six surfaces that now accept typing (catalog card, quick-view modal,
// wholesale page, cart drawer, two-ways rows, group-buy cards) cannot drift
// into six different answers for "what is 0?" or "what happens above stock?".
//
// The split that matters: a quantity being TYPED and a quantity being COMMITTED
// are not the same value. Mid-edit the box must be allowed to hold "" (they
// cleared it to retype) and "1" (a legal prefix of "12" even on a 50-unit MOQ),
// so `sanitizeQtyDraft` applies only the upper bound. The minimum lands in
// `commitQtyDraft`, once, when the customer is finished.
//
// Pure (no DB, no React). Covered by scripts/test-qty-typing.ts.

/**
 * The largest quantity the box will hold, and the answer for an uncapped
 * product (made-to-order resolves `effectiveStock` to Infinity — see
 * ./inventory — and a number field must never render "Infinity").
 */
export const QTY_INPUT_MAX = 9999;

/** Bounds for one control: the product's minimum order quantity and the units
 *  it can actually supply. Both optional — `min` defaults to 1 and an absent
 *  `max` means "uncapped", which still resolves to QTY_INPUT_MAX. */
export type QtyBounds = { min?: number; max?: number };

/** Floor of the range. 0 is legal and meaningful: on a cart-backed control it
 *  is how "−" at one unit, or an emptied box, removes the line. */
function resolveMin(b: QtyBounds): number {
  return Number.isFinite(b.min) ? Math.max(0, Math.floor(b.min as number)) : 1;
}

/** Ceiling of the range, always a real number. */
function resolveMax(b: QtyBounds): number {
  const raw = Number.isFinite(b.max) ? Math.floor(b.max as number) : QTY_INPUT_MAX;
  return Math.min(QTY_INPUT_MAX, Math.max(0, raw));
}

/** Digits only, with leading zeros dropped so typing over an existing value
 *  reads naturally ("0" is nothing yet, "07" is 7). */
function digitsOf(raw: string): string {
  return String(raw ?? "").replace(/\D+/g, "").replace(/^0+/, "");
}

/**
 * Bring any number into range: whole pieces, not below the minimum, not above
 * what the store can supply.
 *
 * The upper bound is applied LAST and so wins a conflict: a line whose stock
 * has fallen below its own MOQ can only shrink, never be nudged back up to a
 * minimum the store cannot fill.
 */
export function clampQty(n: number, b: QtyBounds = {}): number {
  const min = resolveMin(b);
  const max = resolveMax(b);
  if (Number.isNaN(n)) return Math.min(max, min);
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * What the box shows while the customer is still typing.
 *
 * Deliberately does NOT apply the minimum: on a 50-unit MOQ, "1" has to survive
 * long enough to become "120". It does apply the cap, so an impossible number
 * never sits in the field waiting to be rejected later.
 *
 * Returns "" for an empty or all-garbage draft — an empty box is a legal state
 * mid-edit, and snapping it to the minimum on every keystroke makes the field
 * impossible to clear.
 */
export function sanitizeQtyDraft(raw: string, b: QtyBounds = {}): string {
  const digits = digitsOf(raw);
  if (digits === "") return "";
  return String(Math.min(resolveMax(b), Number(digits)));
}

/**
 * The number the cart is actually given — on blur, on Enter, or when
 * Add-to-Cart is pressed. This is where the minimum finally applies, so an
 * abandoned empty box settles on the smallest legal order rather than 0 or NaN.
 */
export function commitQtyDraft(raw: string, b: QtyBounds = {}): number {
  const digits = digitsOf(raw);
  if (digits === "") return clampQty(resolveMin(b), b);
  return clampQty(Number(digits), b);
}

/**
 * How many units to add or remove to make a line hold `target`.
 *
 * The cart is a flat `Product[]` (one entry per unit), so a typed quantity has
 * to become a delta. Crucially it is a delta and not an add: typing 5 into a
 * line of 2 must add 3, never stack 5 more on top.
 */
export function qtyDelta(current: number, target: number): number {
  return Math.floor(target) - Math.floor(current);
}
