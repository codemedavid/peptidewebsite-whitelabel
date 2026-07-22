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
 * Persist the window through `update`, tolerating a not-yet-migrated
 * `subscriptionPriceCents` column.
 *
 * Attempts the full write first. If it throws — the way it would when the price
 * column doesn't exist yet — it retries once with that key omitted so the core
 * window (cycle / start / end / amount, all columns that predate it) still
 * saves. If the retry also throws, the failure is a genuine DB error the drop
 * can't recover from, so it propagates to the caller.
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
  } catch {
    // Retry with the pending-migration column removed entirely. `rest` carries
    // no `subscriptionPriceCents` key, so Prisma never references the column.
    const { subscriptionPriceCents: _omit, ...rest } = data;
    void _omit;
    await update(rest);
    return "without-price";
  }
}
