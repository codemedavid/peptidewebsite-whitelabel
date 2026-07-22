/**
 * Write-side resilience for the operator's paid-subscription window.
 *
 * The matching read path (subscription-info.ts) already fails open when the
 * `subscriptionPriceCents` column hasn't been db:push'd to the live DB yet
 * ([[live-db-state]], [[subscription-price-override]]). Before this helper the
 * WRITE path had no such tolerance: prisma.tenant.update referenced the column
 * unconditionally, so saving (or clearing) the window on a not-yet-migrated DB
 * threw an uncaught error — the generic "An error occurred in the Server
 * Components render" digest the operator saw.
 *
 * A Prisma write emits a column in its SQL whenever the key is present in
 * `data`, even when its value is null — so tolerating the missing column means
 * OMITTING the key on retry, not sending null.
 */

/** The exact set of columns the subscription-window setter persists. */
export type WindowWrite = {
  subscriptionCycle: string | null;
  subscriptionStartsAt: Date | null;
  subscriptionEndsAt: Date | null;
  subscriptionAmountCents: number | null;
  /** Pending-db:push column; the only field the retry drops. */
  subscriptionPriceCents: number | null;
};

/** What actually made it to the DB. */
export type WindowWriteOutcome = "full" | "without-price";

/**
 * Does this failure look like the not-yet-migrated column? Only then may the
 * retry drop `subscriptionPriceCents` — any OTHER failure (connection blip,
 * serialization conflict) must propagate, because a blind drop-and-retry could
 * succeed and silently lose the operator's Monthly price due behind an ok.
 * Prisma surfaces a missing column as P2022 ("column does not exist"); the
 * message check covers clients that stringify the error differently.
 */
function isMissingColumnError(err: unknown): boolean {
  if ((err as { code?: unknown } | null)?.code === "P2022") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /column/i.test(msg) && /does not exist/i.test(msg);
}

/**
 * Persist the window through `update`, tolerating a not-yet-migrated
 * `subscriptionPriceCents` column.
 *
 * Attempts the full write first. If it throws WITH a missing-column signature,
 * it retries once with the price key omitted so the core window (cycle / start
 * / end / amount, all columns that predate it) still saves. Any other failure
 * — and a retry that fails too — propagates to the caller: those are genuine
 * DB errors the drop can't (and must not silently) recover from.
 *
 * @param update performs the real write (e.g. `(data) => prisma.tenant.update({ where, data })`)
 * @param data   the full window payload
 * @returns "full" when everything (incl. price) persisted, "without-price" when
 *          the price column had to be dropped
 */
export async function writeSubscriptionWindow(
  update: (data: Partial<WindowWrite>) => Promise<unknown>,
  data: WindowWrite,
): Promise<WindowWriteOutcome> {
  try {
    await update(data);
    return "full";
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    // Retry with the pending-migration column removed entirely. `rest` carries
    // no `subscriptionPriceCents` key, so Prisma never references the column.
    const { subscriptionPriceCents: _omit, ...rest } = data;
    void _omit;
    await update(rest);
    return "without-price";
  }
}
