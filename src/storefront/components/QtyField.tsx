"use client";

// The one quantity control on the storefront: −, a TYPABLE box, +.
//
// Six surfaces each carried their own copy of a −/+ stepper around a read-only
// <span>, so ordering in bulk meant tapping "+" once per piece. They now all
// render this, which keeps the stepper (still the fastest way to go from 2 to 3)
// and adds the box (the only sane way to go from 2 to 120).
//
// It owns exactly one piece of state — the DRAFT string the customer is typing —
// and defers every decision about what those digits mean to
// @/lib/storefront/qty-input. `value` stays the caller's: local state on a
// pre-add control, the live cart count on a cart-backed one. Every `onChange`
// carries an ABSOLUTE quantity, never a delta.

import { useMemo, useRef, useState } from "react";

import {
  clampQty,
  commitQtyDraft,
  sanitizeQtyDraft,
  type QtyBounds,
} from "@/lib/storefront/qty-input";

export type QtyFieldProps = {
  /** The committed quantity: local state on a pre-add control, the cart count
   *  on a cart-backed one. */
  value: number;
  /** Receives the new ABSOLUTE quantity. A cart-backed caller turns it into a
   *  delta through store.setLineQty. */
  onChange: (next: number) => void;
  /**
   * Smallest legal quantity. 1 for a normal product, the MOQ on the wholesale
   * page, and 0 on a cart-backed control — there, "−" at one unit removing the
   * line is the existing (and expected) behaviour.
   */
  min?: number;
  /** Units the store can supply. Omit (or pass Infinity, as a made-to-order
   *  product's stock resolves to) for uncapped. */
  max?: number;
  /** Product name — the accessible labels are built from it. */
  itemName: string;
  /** Wrapper class, so each surface keeps the skin it already had: `sf-qty` on
   *  the catalog and wholesale pages, `sf-cart__qty` in the drawer,
   *  `sf-twh__stepper` / `gbpage__stepper` on the two order-path surfaces. */
  className?: string;
  /**
   * When the typed digits reach `onChange`:
   *
   * "live" — on every keystroke. For a control whose value is LOCAL state (the
   *   catalog card, the quick-view modal, the wholesale row), because the
   *   Add-to-Cart button next to it has to read the typed number even when the
   *   field never loses focus first.
   *
   * "blur" — on blur, Enter, or a stepper tap. For a control bound to the CART,
   *   because committing per keystroke would add and remove real cart entries —
   *   and fire real "only N in stock" toasts — as each digit lands.
   */
  commit?: "live" | "blur";
  /** A further reason "+" must be inert, beyond hitting `max` (the cart passes
   *  its remaining stock room). */
  plusDisabled?: boolean;
};

export function QtyField({
  value,
  onChange,
  min = 1,
  max = Infinity,
  itemName,
  className = "sf-qty",
  commit = "live",
  plusDisabled = false,
}: QtyFieldProps) {
  const bounds = useMemo<QtyBounds>(() => ({ min, max }), [min, max]);
  // null = not editing, so the box mirrors `value`. A string (including "") is
  // the customer's own keystrokes, which must survive re-renders untouched —
  // clamping an in-progress "1" up to a 50-unit MOQ makes the field unusable.
  const [draft, setDraft] = useState<string | null>(null);

  // The last quantity this field itself asked for. Without it the field cannot
  // tell "the owner reset me" from "I just committed", and it has to handle
  // those opposite ways — see the resync below.
  const pushedRef = useRef<number | null>(null);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    // The quantity moved underneath an open draft. If this field asked for the
    // move, the draft is still the customer's live text and must survive —
    // otherwise typing "1" toward "120" on a 50-unit MOQ would be snapped back
    // to "50" mid-word. If anything ELSE moved it — Add-to-Cart resetting the
    // card to 1, or the cart trimming a line to available stock — the draft is
    // describing a quantity that no longer exists, so the box follows the truth.
    if (pushedRef.current !== value) setDraft(null);
  }

  const shown = draft ?? String(value);

  const push = (next: number) => {
    pushedRef.current = next;
    if (next !== value) onChange(next);
  };

  const handleType = (raw: string) => {
    const next = sanitizeQtyDraft(raw, bounds);
    setDraft(next);
    // An empty box is never committed mid-edit: it is a state on the way to the
    // next number, not a request for the minimum.
    if (commit === "live" && next !== "") push(commitQtyDraft(next, bounds));
  };

  const settle = () => {
    if (draft === null) return;
    const next = commitQtyDraft(draft, bounds);
    setDraft(null);
    push(next);
  };

  const step = (delta: number) => {
    // Stepping while a draft is open works from what they typed, not from the
    // stale committed value.
    const base = draft === null ? value : commitQtyDraft(draft, bounds);
    setDraft(null);
    push(clampQty(base + delta, bounds));
  };

  return (
    <div className={className}>
      <button
        type="button"
        aria-label={`Remove one ${itemName}`}
        onClick={() => step(-1)}
        disabled={value <= min}
      >
        −
      </button>
      {/* type="text" + inputMode="numeric", not type="number": the spinner
          duplicates the buttons either side of it, and a number input reports
          "" for any partial entry, which loses the draft this control depends
          on. Non-digits are stripped by sanitizeQtyDraft regardless. */}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`Quantity of ${itemName}`}
        value={shown}
        onChange={(e) => handleType(e.target.value)}
        // Select-all on focus so tapping the box and typing REPLACES the
        // quantity instead of appending to it ("12" after "1" is not 112).
        onFocus={(e) => e.currentTarget.select()}
        onBlur={settle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Some surfaces sit inside the checkout <form> — Enter must commit
            // the quantity, not submit the order.
            e.preventDefault();
            settle();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
          }
        }}
      />
      <button
        type="button"
        aria-label={`Add one ${itemName}`}
        onClick={() => step(1)}
        disabled={plusDisabled || value >= max}
      >
        +
      </button>
    </div>
  );
}
