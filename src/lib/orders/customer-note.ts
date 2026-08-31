// The customer's own note on an order — "please deliver after 5pm", "no ice
// packs", "gate code 1234". Written by the buyer at checkout, read by the store
// owner on the order. INBOUND only.
//
// Deliberately NOT StorefrontOrder.shippingNote, which flows the other way: the
// owner types that one and the customer reads it on the public Track page.
// Sharing one column would let an owner overwrite what a buyer asked for, and
// would republish the buyer's words on a page reachable with just an order
// number.
//
// This module exists so there is exactly ONE place where free text from an
// anonymous buyer gets bounded before it reaches the DB, the owner's chat app
// and the owner's spreadsheet.

/** Cap, matching shippingNote. Long enough for real delivery instructions,
 *  short enough that a paste-bomb can't bloat every order row. */
export const CUSTOMER_NOTE_MAX = 500;

/**
 * Coerce an untrusted checkout value into a stored note.
 *
 * Truncation is deliberately silent rather than an error: a buyer who pasted
 * too much should still get their order placed, and the checkout box enforces
 * the same cap client-side, so hitting this path means a tampered or legacy
 * client — not a customer to bounce.
 *
 * Newlines survive (a buyer's list is a list); only the edges are trimmed, and
 * again after the cut so a mid-word truncation can't leave a ragged trailing
 * space in the owner's spreadsheet.
 */
export function normalizeCustomerNote(input: unknown): string {
  if (input == null) return "";
  const raw = typeof input === "string" ? input : String(input);
  return raw.trim().slice(0, CUSTOMER_NOTE_MAX).trimEnd();
}
