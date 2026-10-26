import "server-only";

/**
 * Paid Access — how a customer gets INTO a group buy. The module's public, SERVER
 * interface: the rest of the app (GB pages, checkout, the app API, the
 * webhook and cron routes) talks to Paid Access only through these functions and
 * never reads its tables (npm run test:paid-access-boundary).
 *
 *   getAccess(…)            → { gated, status, canAccess, nextStep, visibility }
 *   startJoin / submitStep / cancelJoin / getJoinState     (the member)
 *   previewJoinState        (a visitor who hasn't given their email yet)
 *   confirmPayment / rejectPayment / approve / reject / markRefunded / revoke   (an admin)
 *   handleWebhook(…)        (verified online payments, idempotent)
 *   getSettings / updateSettings / listQueue / history
 *
 * These take the acting customer/admin as an argument, so they must only be
 * called with an identity the caller authenticated (see ./actions.ts). Client
 * components import the pure rules from `@/modules/paid-access/client`.
 * Reference: src/modules/paid-access/README.md
 */

export { getAccess, gatePolicies, gatePoliciesLive, policyFor, type AccessResult, type GatePolicy } from "./server/access";
export { startJoin, submitStep, cancelJoin, getJoinState, previewJoinState, customerReceiptUrl, type JoinResult, type StepInput } from "./server/customer";
export {
  approve,
  reject,
  markRefunded,
  revoke,
  confirmPayment,
  rejectPayment,
  listQueue,
  adminReceiptUrl,
  history,
  type DecisionResult,
  type QueueRow,
  type QueueCounts,
  type QueueTab,
  type HistoryEvent,
} from "./server/admin";
export { getSettings, updateSettings, paidAccessTag, type SettingsView } from "./server/settings";
export { handleWebhook, type WebhookResult } from "./server/webhook";
export { expireStale, expireStaleEverywhere } from "./server/sweep";
export { claimDepositCredit } from "./server/deposit";
export type { JoinState } from "./server/state";
export type { Admin, Customer, Fail, FailCode } from "./server/context";
