// Bounded "have I already handled this update?" memory.
//
// Telegram redelivers an update until it receives a 200. The webhook always
// answers 200, so redelivery should be rare — but it still happens (a timeout on
// our side that Telegram never saw), and a redelivered callback would otherwise
// re-run a handler and post a second reply into the chat.
//
// This is deliberately IN-PROCESS and bounded. It is a politeness layer, not the
// safety net: correctness against a repeat comes from planStatusChange, which
// treats a second confirm as a no-op that moves no stock. A multi-instance
// deployment therefore degrades to "the user might see one duplicate reply",
// never to "the order was confirmed twice".

/** Remembers the most recent update ids, evicting the oldest first. */
export interface UpdateDeduper {
  /** True when this update id was already seen; records it either way. */
  seen(updateId: number): boolean;
}

const DEFAULT_MAX = 500;

export function makeUpdateDeduper(max = DEFAULT_MAX): UpdateDeduper {
  // A Set preserves insertion order, which is all the LRU we need: an update id
  // is handled once and never touched again, so "oldest inserted" is "coldest".
  const seenIds = new Set<number>();
  const cap = Math.max(1, max);

  return {
    seen(updateId: number): boolean {
      if (!Number.isFinite(updateId)) return false;
      if (seenIds.has(updateId)) return true;
      seenIds.add(updateId);
      while (seenIds.size > cap) {
        const oldest = seenIds.values().next().value;
        if (oldest === undefined) break;
        seenIds.delete(oldest);
      }
      return false;
    },
  };
}

/** The process-wide deduper the webhook route uses. */
export const webhookDeduper = makeUpdateDeduper();
