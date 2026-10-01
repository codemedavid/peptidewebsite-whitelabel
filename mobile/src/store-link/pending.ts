/**
 * Hand-off between the deep-link entry point (+native-intent, which runs
 * outside React) and StoreLinkProvider. Holds the latest store identifier a
 * link carried until the provider takes it.
 */

type Listener = (identifier: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

export function offerStoreLink(identifier: string): void {
  pending = identifier;
  for (const l of listeners) l(identifier);
}

/** Take (and clear) a link that arrived before the provider mounted. */
export function takePendingStoreLink(): string | null {
  const v = pending;
  pending = null;
  return v;
}

export function onStoreLink(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
