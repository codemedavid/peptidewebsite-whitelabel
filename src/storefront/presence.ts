// What the "live now" beacon reports about this tab (components/PresenceBeacon).
// A tiny module store the checkout drawer writes (open, step, cart) and the
// beacon reads. The open product is not here: the beacon reads it from the
// URL hash, which every product quick-view keeps in sync.

export type WebPresence = {
  cartOpen: boolean;
  checkoutStep: "cart" | "details" | "payment";
  cartItems: number;
  cartValue: number;
  currency: string | null;
};

let state: WebPresence = {
  cartOpen: false,
  checkoutStep: "cart",
  cartItems: 0,
  cartValue: 0,
  currency: null,
};
const listeners = new Set<() => void>();

export function getPresence(): WebPresence {
  return state;
}

/** Merge a patch; listeners hear about it only when something changed. */
export function reportPresence(patch: Partial<WebPresence>): void {
  const next = { ...state, ...patch };
  const changed = (Object.keys(next) as (keyof WebPresence)[]).some((k) => next[k] !== state[k]);
  if (!changed) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function subscribePresence(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
