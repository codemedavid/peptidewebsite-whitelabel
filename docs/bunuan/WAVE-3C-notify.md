# Wave 3C — notifications + invoice timing

Branch `bunuan/3c-notify` (after 2A merged), worktree `../pepweb-3c`, port 3133. Read README.md + HANDOFF-2A.md first.

## Build
Reuse the order-update bot (app chat DM + push, `clientId` conventions), `src/lib/community/push.server.ts`, and PostHog email (EmailBrand). Never send twice: deterministic clientIds like `bot:bunuan:<roundId>:<event>:<orderId>`.
- **Bunuan opened** → everyone in the round (buyers + approved Paid Access members): which variations are open and how many vials each.
- **Bunuan auto-closed** (all kits filled) → admin.
- **Ligwak locked** → each affected customer: their Success / Cancelled lines (with variation names) + new amount due (pay_later) or refund owed (pay_first).
- **Payment time started** → every pay_later customer with their final amount due (+ due date). MOVE the existing invoice send (`src/lib/community/gb-invoice.server.ts` `sendGroupBuyInvoices`) from round close to Payment time for stores in the new flow; keep the old behaviour for stores without it.
- **Order edited by the store** → that customer.
- **Refund status changed** → that customer.
- Hook calls into 2A's actions via `after()` (never inside the DB transaction).

**Done when:** a PGlite flow test (`test:bunuan-notify`) proves each event sends once with the right text; `test:order-bot`, `test:gb-invoice-flow` green; both `tsc` clean; HANDOFF-3C.md written.
