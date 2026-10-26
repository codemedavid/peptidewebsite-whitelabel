import "server-only";

// Deposits (decision Q4): a deposit is charged when the member joins and is
// credited ONCE against their group-buy order. Checkout calls these with its
// own transaction so the credit and the order commit (or roll back) together;
// the DB refuses a second credit of the same payment.

import type { TenantTx } from "@/lib/db/tenant-client";
import { creditableDeposit, creditDeposit } from "./repo";

/** The deposit a member can still use on this round, in centavos (0 = none). */
export async function depositCreditCents(db: TenantTx, input: { groupBuyId: string; customerId: string }): Promise<number> {
  return (await creditableDeposit(db, input.groupBuyId, input.customerId))?.amountCents ?? 0;
}

/**
 * Credit the member's deposit to `orderId`, capped at the order total.
 * Returns the centavos credited (0 = nothing to credit). Call inside the
 * order's transaction.
 */
export async function claimDepositCredit(
  db: TenantTx,
  input: { groupBuyId: string; customerId: string; orderId: string; orderTotalCents: number; now?: Date },
): Promise<number> {
  const deposit = await creditableDeposit(db, input.groupBuyId, input.customerId);
  if (!deposit || input.orderTotalCents <= 0) return 0;
  const credited = await creditDeposit(db, deposit.id, input.orderId, input.now ?? new Date());
  return credited ? Math.min(deposit.amountCents, input.orderTotalCents) : 0;
}
