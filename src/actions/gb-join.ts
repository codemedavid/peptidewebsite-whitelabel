"use server";

// Paid group-buy JOIN — the customer's server actions (website #groupbuy; the
// app reaches the same actions as the signed-in shopper via asShopper). The
// store comes from the request host and the customer from their own session;
// nothing here accepts a customer id, a store id or an amount from the client.
// Logic: lib/storefront/gb-join.server.ts.

import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { getSignedInCustomer } from "@/lib/auth/customer-session";
import { after } from "next/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { alertJoinRequest } from "@/lib/community/gb-join-bot.server";
import { getJoinState, receiptUrlFor, startJoin, submitReceipt, type JoinCustomer } from "@/lib/storefront/gb-join.server";
import type { GroupBuyJoinResult } from "@/lib/mobile/shop-contract";

const TEN_MIN = 10 * 60 * 1000;
const MAX_JOIN_WRITES = 20;
const MAX_RECEIPTS = 10;

type Fail = Extract<GroupBuyJoinResult, { ok: false }>;
const SIGN_IN: Fail = { ok: false, code: "unauthenticated", message: "Sign in to join this group buy." };
const NO_STORE: Fail = { ok: false, code: "not_found", message: "Store not found." };
const SLOW_DOWN: Fail = { ok: false, code: "rate_limited", message: "Too many tries. Please wait a few minutes." };

async function whoAndWhere(): Promise<{ store: { tenantId: string; slug: string }; customer: JoinCustomer } | Fail> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return NO_STORE;
  const customer = await getSignedInCustomer(tenantId);
  if (!customer) return SIGN_IN;
  return {
    store: { tenantId, slug: (await getTenantSlug()) ?? tenantId },
    customer: { id: customer.id, name: customer.name, email: customer.email },
  };
}

/** The customer's join screen for a round. */
export async function getGroupBuyJoinAction(roundId: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await whoAndWhere();
  if ("ok" in ctx) return ctx;
  return getJoinState(ctx.store, ctx.customer, roundId);
}

/** Start (or re-show) the customer's request — never a second one. */
export async function startGroupBuyJoinAction(roundId: unknown): Promise<GroupBuyJoinResult> {
  const ctx = await whoAndWhere();
  if ("ok" in ctx) return ctx;
  if (!rateLimit(`gb-join:${ctx.store.tenantId}:${ctx.customer.id}`, MAX_JOIN_WRITES, TEN_MIN).ok) return SLOW_DOWN;
  return startJoin(ctx.store, ctx.customer, roundId);
}

/** multipart { roundId, file, reference, method?, paidAt? } — no amount field is read. */
export async function submitGroupBuyReceiptAction(form: FormData): Promise<GroupBuyJoinResult> {
  const ctx = await whoAndWhere();
  if ("ok" in ctx) return ctx;
  if (!rateLimit(`gb-receipt:${ctx.store.tenantId}:${ctx.customer.id}`, MAX_RECEIPTS, TEN_MIN).ok) return SLOW_DOWN;
  const res = await submitReceipt(ctx.store, ctx.customer, form.get("roundId"), {
    file: form.get("file"),
    reference: form.get("reference"),
    method: form.get("method"),
    paidAt: form.get("paidAt"),
  });
  // A paid request is waiting: tell the store team (push + the owner's email).
  if (res.ok && res.state.request?.status === "paid_pending_approval") {
    const { tenantId } = ctx.store;
    const id = res.state.request.id;
    after(() => alertJoinRequest(tenantId, id));
  }
  return res;
}

/** A 10-minute link to the customer's own receipt. */
export async function getGroupBuyReceiptUrlAction(roundId: unknown): Promise<{ ok: true; url: string } | Fail> {
  const ctx = await whoAndWhere();
  if ("ok" in ctx) return ctx;
  return receiptUrlFor(ctx.store, ctx.customer, roundId);
}
