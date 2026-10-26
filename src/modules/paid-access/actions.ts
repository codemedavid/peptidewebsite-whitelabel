"use server";

// Paid Access's server actions — the ONLY session-gated doors into the module.
//
//   member actions: the store comes from the request host and the customer
//   from their own session — a signed-in account, or on the website the
//   group-buy EMAIL PASS a shopper gets by typing their email (no account
//   needed; lib/auth/gb-pass.ts). The app reaches the same actions as the
//   signed-in shopper via asShopper. Nothing here accepts a customer id, a
//   store id or an amount from the client.
//
//   admin actions: a store-admin session holding the `groupbuys` module, on
//   the request's own store (website #admin, and the app via the admin bridge).
//
// Logic: ./index.ts (server/*). Results use the shared app contract
// (lib/mobile/shop-contract), which the assignments below type-check against.

import { prisma } from "@/lib/db/prisma";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { clearGroupBuyPass, getGroupBuyShopper, saveGroupBuyPass, type GroupBuyShopper } from "@/lib/auth/gb-pass";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { resolveGroupBuyCaps } from "@/lib/storefront/group-buy-server";
import { findCustomerByEmail, findOrCreateGuestCustomer, parseShopperEmail } from "@/lib/storefront/guest-customer";
import type { GroupBuyJoinResult } from "@/lib/mobile/shop-contract";
import * as paidAccess from "./index";
import type { Admin, Customer, Fail, JoinResult } from "./index";

const TEN_MIN = 10 * 60 * 1000;
const MAX_WRITES = 30;
const MAX_PROOFS = 10;
const MAX_EMAIL_TRIES = 10;

const SIGN_IN: Fail = { ok: false, code: "unauthenticated", message: "Enter your email to join this group buy." };
const BAD_EMAIL: Fail = { ok: false, code: "invalid_input", message: "Please enter a valid email address." };
const ACCOUNT_ONLY: Fail = { ok: false, code: "forbidden", message: "Message the store if you need this — it isn't available with an email-only join." };
const NO_STORE: Fail = { ok: false, code: "not_found", message: "Store not found." };
const SLOW_DOWN: GroupBuyJoinResult = { ok: false, code: "rate_limited", message: "Too many tries. Please wait a few minutes." };
const NOT_ADMIN: Fail = { ok: false, code: "forbidden", message: "Sign in to the store admin with group-buy access." };

/** The module's result IS the app contract — this line fails to compile if they drift. */
const toContract = (r: JoinResult): GroupBuyJoinResult => r;

type MemberCtx = { tenantId: string; customer: Customer; via: GroupBuyShopper["via"] };

async function member(): Promise<MemberCtx | Fail> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return NO_STORE;
  const c = await getGroupBuyShopper(tenantId);
  if (!c) return SIGN_IN;
  return { tenantId, via: c.via, customer: { id: c.id, name: c.name, email: c.email } };
}

/** The ctx Paid Access's server functions take (they don't know how the shopper got here). */
const asMember = ({ tenantId, customer }: MemberCtx) => ({ tenantId, customer });

const limited = (key: string, max: number) => !rateLimit(key, max, TEN_MIN).ok;

export async function getPaidAccessJoinAction(groupBuyId: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  return toContract(await paidAccess.getJoinState({ ...asMember(ctx), groupBuyId }));
}

/** Start (or re-show) the member's way in — never a second one. */
export async function startPaidAccessJoinAction(groupBuyId: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  if (limited(`paid-access-join:${ctx.tenantId}:${ctx.customer.id}`, MAX_WRITES)) return SLOW_DOWN;
  return toContract(await paidAccess.startJoin({ ...asMember(ctx), groupBuyId }));
}

/** answers: { [questionId]: string } — validated against the member's snapshot. */
export async function submitPaidAccessFormAction(groupBuyId: unknown, answers: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  if (limited(`paid-access-join:${ctx.tenantId}:${ctx.customer.id}`, MAX_WRITES)) return SLOW_DOWN;
  return toContract(await paidAccess.submitStep({ ...asMember(ctx), groupBuyId, step: "form", data: answers }));
}

/** multipart { groupBuyId, file, reference, method?, paidAt? } — no amount field is read. */
export async function submitPaidAccessProofAction(form: FormData): Promise<GroupBuyJoinResult> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  if (limited(`paid-access-proof:${ctx.tenantId}:${ctx.customer.id}`, MAX_PROOFS)) return SLOW_DOWN;
  return toContract(
    await paidAccess.submitStep({
      ...asMember(ctx),
      groupBuyId: form.get("groupBuyId"),
      step: "payment",
      data: { kind: "proof", file: form.get("file"), reference: form.get("reference"), method: form.get("method"), paidAt: form.get("paidAt") },
    }),
  );
}

/** Opens the provider's checkout; the payment counts only once its webhook arrives. */
export async function startPaidAccessOnlinePaymentAction(groupBuyId: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  if (limited(`paid-access-proof:${ctx.tenantId}:${ctx.customer.id}`, MAX_PROOFS)) return SLOW_DOWN;
  return toContract(await paidAccess.submitStep({ ...asMember(ctx), groupBuyId, step: "payment", data: { kind: "online" } }));
}

/** Account only: anyone can TYPE an email, so an email pass can't undo someone's join. */
export async function cancelPaidAccessJoinAction(groupBuyId: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  if (ctx.via !== "account") return ACCOUNT_ONLY;
  if (limited(`paid-access-join:${ctx.tenantId}:${ctx.customer.id}`, MAX_WRITES)) return SLOW_DOWN;
  return toContract(await paidAccess.cancelJoin({ ...asMember(ctx), groupBuyId }));
}

/** A 10-minute link to the member's OWN proof of payment. Account only — an
 *  email pass must never open the screenshot of whoever owns that email. */
export async function getPaidAccessReceiptUrlAction(groupBuyId: unknown): Promise<{ ok: true; url: string } | Fail> {
  const ctx = await member();
  if ("ok" in ctx) return ctx;
  if (ctx.via !== "account") return ACCOUNT_ONLY;
  return paidAccess.customerReceiptUrl({ ...asMember(ctx), groupBuyId });
}

// ── Website: join with just an email ─────────────────────────────────────────
//
// No sign-in, no account. The shopper types their email; it names a customer
// row (an existing account's, or a password-less guest's) and the browser gets
// the group-buy email pass for it. From then on the member actions above run
// as that customer. Rate-limited per device: whether an email has a request is
// exactly what "Already approved?" reveals, so it must not be enumerable.

export type PaidAccessJoinViewer = { kind: "account" | "email" | "guest"; email: string };
export type PaidAccessJoinPage = { result: GroupBuyJoinResult; viewer: PaidAccessJoinViewer };

const GUEST: PaidAccessJoinViewer = { kind: "guest", email: "" };
const viewerOf = (c: { via: GroupBuyShopper["via"]; email: string }): PaidAccessJoinViewer => ({ kind: c.via, email: c.email });
const page = (result: GroupBuyJoinResult, viewer: PaidAccessJoinViewer): PaidAccessJoinPage => ({ result, viewer });

/** The store's id for an email try, or the refusal (no store / too many tries). */
async function emailTry(): Promise<string | GroupBuyJoinResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return NO_STORE;
  if (limited(`paid-access-email:${tenantId}:${await clientIp()}`, MAX_EMAIL_TRIES)) return SLOW_DOWN;
  return tenantId;
}

/** The join page: the shopper's own state, or — nobody yet — what joining looks like. */
export async function getPaidAccessJoinPageAction(groupBuyId: unknown): Promise<PaidAccessJoinPage> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return page(NO_STORE, GUEST);
  const c = await getGroupBuyShopper(tenantId);
  if (!c) return page(toContract(await paidAccess.previewJoinState({ tenantId, groupBuyId })), GUEST);
  return page(toContract(await paidAccess.getJoinState({ tenantId, groupBuyId, customer: c })), viewerOf(c));
}

/** "Already approved?" — picks up an EXISTING request by email. Creates nothing. */
export async function verifyPaidAccessEmailAction(groupBuyId: unknown, email: unknown): Promise<PaidAccessJoinPage> {
  const parsed = parseShopperEmail(email);
  if (!parsed) return page(BAD_EMAIL, GUEST);
  const tenantId = await emailTry();
  if (typeof tenantId !== "string") return page(tenantId, GUEST);
  const row = await findCustomerByEmail(tenantId, parsed);
  const customer = row && row.status === "active" ? { id: row.id, name: row.name, email: row.email } : null;
  const res = customer ? await paidAccess.getJoinState({ tenantId, groupBuyId, customer }) : null;
  if (!res || (res.ok && !res.state.status)) {
    return page({ ok: false, code: "not_found", message: "We couldn't find a request from that email for this group buy. Fill in the form below to join." }, GUEST);
  }
  if (!res.ok) return page(toContract(res), GUEST);
  await saveGroupBuyPass(tenantId, customer!.id);
  return page(toContract(res), { kind: "email", email: customer!.email });
}

/** Join with an email: that email's row (or a new guest), the pass, then Join. */
export async function continuePaidAccessWithEmailAction(groupBuyId: unknown, email: unknown): Promise<PaidAccessJoinPage> {
  const parsed = parseShopperEmail(email);
  if (!parsed) return page(BAD_EMAIL, GUEST);
  const tenantId = await emailTry();
  if (typeof tenantId !== "string") return page(tenantId, GUEST);
  const row = await findOrCreateGuestCustomer(tenantId, parsed);
  if (row.status !== "active") return page({ ok: false, code: "forbidden", message: "This email can't join right now. Message the store." }, GUEST);
  await saveGroupBuyPass(tenantId, row.id);
  const customer = { id: row.id, name: row.name, email: row.email };
  return page(toContract(await paidAccess.startJoin({ tenantId, groupBuyId, customer })), { kind: "email", email: row.email });
}

/** "Not you?" — drop the email pass (an account session is untouched). */
export async function forgetPaidAccessEmailAction(): Promise<{ ok: true }> {
  await clearGroupBuyPass();
  return { ok: true };
}

// ── Store admin ──────────────────────────────────────────────────────────────

type AdminCtx = { tenantId: string; admin: Admin; canEdit: boolean };

async function storeAdmin(): Promise<AdminCtx | Fail> {
  const ctx = await requireStaffPermission("groupbuys");
  if (!ctx) return NOT_ADMIN;
  const caps = await resolveGroupBuyCaps(ctx.tenantId);
  if (!caps.enabled) return { ok: false, code: "unavailable", message: "Group buys aren't enabled for this store." };
  // The reviewer's email decides self-review ("you can't approve yourself").
  if (ctx.actor.kind === "owner") {
    const t = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { storeAdminEmail: true } });
    return { tenantId: ctx.tenantId, canEdit: caps.canEdit, admin: { kind: "admin", id: "owner", email: t?.storeAdminEmail ?? "" } };
  }
  const s = await prisma.storefrontStaff.findFirst({ where: { id: ctx.actor.id, tenantId: ctx.tenantId }, select: { email: true } });
  return { tenantId: ctx.tenantId, canEdit: caps.canEdit, admin: { kind: "admin", id: `staff:${ctx.actor.id}`, email: s?.email ?? "" } };
}

export async function getPaidAccessSettingsAction(groupBuyId: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  return paidAccess.getSettings({ tenantId: g.tenantId, groupBuyId });
}

export async function savePaidAccessSettingsAction(groupBuyId: unknown, settings: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  if (!g.canEdit) return { ok: false as const, code: "forbidden" as const, message: "Editing group buys isn't enabled for this store." };
  return paidAccess.updateSettings({ tenantId: g.tenantId, groupBuyId, admin: g.admin, input: settings });
}

/** { groupBuyId?, tab?: payments | approvals | refunds | waitlist | all } */
export async function listPaidAccessQueueAction(filters: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  const f = (filters && typeof filters === "object" ? filters : {}) as Record<string, unknown>;
  return paidAccess.listQueue({ tenantId: g.tenantId, groupBuyId: f.groupBuyId, tab: f.tab });
}

export type PaidAccessDecision =
  | { action: "approve" | "reject" | "refund" | "revoke"; membershipId: string; reason?: string; reference?: string }
  | { action: "confirm_payment" | "confirm_and_approve" | "reject_payment"; paymentId: string; reason?: string };

export async function decidePaidAccessAction(input: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const base = { tenantId: g.tenantId, admin: g.admin };
  switch (o.action) {
    case "approve":
      return paidAccess.approve({ ...base, membershipId: o.membershipId });
    case "reject":
      return paidAccess.reject({ ...base, membershipId: o.membershipId, reason: o.reason });
    case "refund":
      return paidAccess.markRefunded({ ...base, membershipId: o.membershipId, reference: o.reference });
    case "revoke":
      return paidAccess.revoke({ ...base, membershipId: o.membershipId, reason: o.reason });
    case "confirm_payment":
      return paidAccess.confirmPayment({ ...base, paymentId: o.paymentId });
    case "confirm_and_approve":
      return paidAccess.confirmPayment({ ...base, paymentId: o.paymentId, alsoApprove: true });
    case "reject_payment":
      return paidAccess.rejectPayment({ ...base, paymentId: o.paymentId, reason: o.reason });
    default:
      return { ok: false as const, code: "invalid_input" as const, message: "Unknown action." };
  }
}

/** A 10-minute signed link to a payment's proof. */
export async function getPaidAccessProofUrlAction(paymentId: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  return paidAccess.adminReceiptUrl({ tenantId: g.tenantId, paymentId });
}

export async function getPaidAccessHistoryAction(filters: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  const f = (filters && typeof filters === "object" ? filters : {}) as Record<string, unknown>;
  return paidAccess.history({ tenantId: g.tenantId, groupBuyId: f.groupBuyId, membershipId: f.membershipId });
}

/** Release lapsed payment holds on a round now (and promote the waitlist). */
export async function expirePaidAccessHoldsAction(groupBuyId: unknown) {
  const g = await storeAdmin();
  if ("ok" in g) return g;
  if (typeof groupBuyId !== "string") return { ok: false as const, code: "invalid_input" as const, message: "Unknown group buy." };
  return { ok: true as const, ...(await paidAccess.expireStale({ tenantId: g.tenantId, groupBuyId })) };
}
