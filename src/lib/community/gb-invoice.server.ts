import "server-only";

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { storeDisplayName } from "@/lib/mobile/store-name";
import { getTenantContext } from "@/lib/tenant/context";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { formatMoney } from "@/lib/storefront/currency";
import { effectiveGroupBuyStatus, type GroupBuy } from "@/lib/storefront/group-buy";
import { loadGroupBuys, resolveGroupBuyCaps } from "@/lib/storefront/group-buy-server";
import {
  buildGroupBuyInvoice,
  fnv32,
  invoiceClientId,
  invoiceClientPrefix,
  invoiceImageClientId,
  normalizeGroupBuyInvoice,
  shouldAutoInvoice,
  INVOICE_PAYMENT_METHOD,
  type GroupBuyInvoice,
  type GroupBuyInvoiceConfig,
  type InvoiceOrder,
} from "@/lib/storefront/gb-invoice";
import type { Order } from "@/storefront/types";
import { STORE_KEY, customerKey, dmPair } from "./keys";
import { ORDER_BOT_AUTHOR, ORDER_MESSAGE_KIND } from "./order-bot";
import { notifyOrderUpdate } from "./push.server";

/**
 * Group-buy invoices, delivered. When a round closes, every customer who
 * ordered in it from their app account gets ONE invoice (all their orders in
 * the round, one shipping fee — lib/storefront/gb-invoice.ts) in the store ⇄
 * customer DM, as the order bot, followed by the owner's payment-option images,
 * and a push.
 *
 * Three doors, one sender:
 *   • the owner closes the round (saveGroupBuyAction → after())
 *   • the round's end date passes — nothing writes that close, so the app's
 *     shop catalog nudges sweepClosedRoundInvoices (throttled)
 *   • the owner's "Send invoices" button (force: any closed round, any time)
 *
 * Idempotent through the message clientId: the automatic doors skip a customer
 * who already has this round's invoice; the button re-sends only an invoice
 * whose text changed (an order edited after close). Guest orders have no one
 * to message and are counted, not sent. Never throws.
 */

export type InvoiceSendResult = { sent: number; unchanged: number; guests: number; skipped: number };

const BLOCKED_MEMBER = new Set(["rejected", "revoked"]);
const SENDERS_AT_ONCE = 4;

type CustomerInvoice = { customerId: string; invoice: GroupBuyInvoice; firstOrderId: string };

function toInvoiceOrder(o: Order): InvoiceOrder {
  return {
    id: o.id,
    orderNumber: o.orderNumber || o.id,
    placedAt: o.date,
    customer: { name: o.customer?.name ?? "", phone: o.customer?.phone ?? "", email: o.customer?.email ?? "" },
    shipping: {
      address: o.shipping?.address ?? "",
      barangay: o.shipping?.barangay ?? "",
      city: o.shipping?.city ?? "",
      province: o.shipping?.province ?? "",
      postal: o.shipping?.postal ?? "",
      fee: o.shipping?.fee ?? 0,
    },
    courier: o.courier ?? "",
    items: (o.items ?? []).map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    adminFee: o.adminFee ?? null,
    paymentFee: o.paymentFee ?? null,
    discount: o.discount ?? null,
  };
}

/**
 * When the round finished: the stamped close, else the end date that lapsed.
 * Deliberately not updatedAt — editing an old round must never make it look
 * freshly closed to the automatic doors.
 */
export function roundClosedAt(gb: Pick<GroupBuy, "closedAt" | "endsAt">): string | null {
  return gb.closedAt ?? gb.endsAt ?? null;
}

/** Every app customer's invoice for the round (guest orders counted separately). */
async function buildRoundInvoices(
  tenantId: string,
  gb: GroupBuy,
  config: GroupBuyInvoiceConfig,
  currency: unknown,
): Promise<{ invoices: CustomerInvoice[]; guests: number; skipped: number }> {
  const rows = await withTenant(tenantId, (db) =>
    db.storefrontOrder.findMany({
      // Only orders checkout took as pay-on-invoice. Anything else in the
      // round (a website order, one placed before the switch went on) was
      // paid — or is being paid — the ordinary way.
      where: { ...ACTIVE_ORDERS_WHERE, groupBuyId: gb.id, status: { not: "cancelled" }, paymentMethod: INVOICE_PAYMENT_METHOD },
      orderBy: { placedAt: "asc" },
      include: { customerAccount: { select: { status: true, communityMember: { select: { status: true } } } } },
    }),
  );
  const byCustomer = new Map<string, Order[]>();
  let guests = 0;
  let skipped = 0;
  for (const row of rows) {
    const customerId = row.customerAccountId;
    if (!customerId) {
      guests++;
      continue;
    }
    if (row.customerAccount?.status !== "active" || BLOCKED_MEMBER.has(row.customerAccount.communityMember?.status ?? "")) {
      skipped++;
      continue;
    }
    byCustomer.set(customerId, [...(byCustomer.get(customerId) ?? []), dbOrderToStorefront(row as unknown as DbOrderRow)]);
  }

  const money = (n: number) => formatMoney(n, currency);
  const invoices: CustomerInvoice[] = [];
  for (const [customerId, orders] of byCustomer) {
    const invoice = buildGroupBuyInvoice({
      orders: orders.map(toInvoiceOrder),
      roundName: gb.name,
      closedAt: roundClosedAt(gb),
      config,
      money,
    });
    if (invoice) invoices.push({ customerId, invoice, firstOrderId: invoice.orderIds[0] });
  }
  return { invoices, guests, skipped };
}

type Posted = { conversationId: string } | "unchanged" | "already";

/**
 * Who triggered the send:
 *   sweep  — a lapsed end date; first send only
 *   close  — the owner closed (or re-closed) the round; changed invoices re-send
 *   manual — the owner's button; any closed round, changed invoices re-send
 */
export type InvoiceSendMode = "sweep" | "close" | "manual";

/** One customer's invoice, in its own transaction (the round-trip budget). */
async function postInvoice(tenantId: string, gbId: string, c: CustomerInvoice, resend: boolean): Promise<Posted> {
  const clientId = invoiceClientId(c.firstOrderId, gbId, c.invoice.text);
  return withTenant(tenantId, async (db): Promise<Posted> => {
    const prior = await db.communityMessage.findFirst({
      where: { senderKey: STORE_KEY, clientId: { startsWith: invoiceClientPrefix(c.firstOrderId, gbId) } },
      orderBy: { createdAt: "desc" },
      select: { clientId: true },
    });
    if (prior && !resend) return "already";
    if (prior?.clientId === clientId) return "unchanged";

    const pair = dmPair(STORE_KEY, customerKey(c.customerId))!;
    const conversation = await db.communityConversation.upsert({
      where: { tenantId_lowKey_highKey: { tenantId, ...pair } },
      create: { tenantId, ...pair },
      update: {},
      select: { id: true },
    });
    // A millisecond apart, so the thread (ordered by createdAt) keeps the
    // invoice above its payment images.
    const now = Date.now();
    const at = (i: number) => new Date(now + i);
    const base = { tenantId, conversationId: conversation.id, senderKey: STORE_KEY, authorKey: ORDER_BOT_AUTHOR };
    await db.communityMessage.createMany({
      data: [
        { ...base, kind: ORDER_MESSAGE_KIND, body: c.invoice.text, clientId, createdAt: at(0) },
        ...c.invoice.images.map((imageUrl, i) => ({
          ...base,
          kind: "image",
          imageUrl,
          clientId: invoiceImageClientId(clientId, i),
          createdAt: at(i + 1),
        })),
      ],
    });
    const count = 1 + c.invoice.images.length;
    await db.communityConversation.updateMany({
      where: { id: conversation.id },
      data: { lastMessageAt: at(count - 1), messageCount: { increment: count } },
    });
    return { conversationId: conversation.id };
  });
}

async function postWithRetry(tenantId: string, gbId: string, c: CustomerInvoice, resend: boolean): Promise<Posted> {
  try {
    return await postInvoice(tenantId, gbId, c, resend);
  } catch (e) {
    // A race on the conversation pair or the clientId (two doors at once): the
    // retry re-reads the winner's rows and reports "already"/"unchanged".
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    return postInvoice(tenantId, gbId, c, resend);
  }
}

async function withoutSentInvoices(tenantId: string, gbId: string, invoices: CustomerInvoice[]): Promise<CustomerInvoice[]> {
  if (invoices.length === 0) return invoices;
  const sent = await withTenant(tenantId, (db) =>
    db.communityMessage.findMany({
      where: { senderKey: STORE_KEY, clientId: { contains: `:inv:${fnv32(gbId)}:` } },
      select: { clientId: true },
    }),
  );
  const ids = sent.map((m) => m.clientId ?? "");
  return invoices.filter((c) => !ids.some((id) => id.startsWith(invoiceClientPrefix(c.firstOrderId, gbId))));
}

/**
 * Send (or re-send) a closed round's invoices — see InvoiceSendMode. The
 * automatic modes only touch rounds that closed after the switch went on.
 */
export async function sendGroupBuyInvoices(
  tenantId: string,
  groupBuyId: string,
  mode: InvoiceSendMode,
): Promise<InvoiceSendResult | { error: string }> {
  const resend = mode !== "sweep";
  try {
    if (!(await hasFeature(tenantId, FEATURES.MOBILE_COMMUNITY))) {
      return { error: "Invoices are sent in the app chat, which isn't on for this store." };
    }
    const ctx = await getTenantContext(tenantId);
    const config = (ctx.branding?.config ?? {}) as Record<string, unknown>;
    const settings = normalizeGroupBuyInvoice(config.groupBuyInvoice);
    if (!settings.enabled) return { error: "Turn on “Invoice after close” first." };

    const caps = await resolveGroupBuyCaps(tenantId);
    const gb = (await loadGroupBuys(tenantId, ctx.tenant.slug)).find((x) => x.id === groupBuyId);
    if (!gb) return { error: "Group buy not found." };
    if (effectiveGroupBuyStatus(gb, caps.scheduled) !== "closed" && gb.status !== "archived") {
      return { error: "Invoices go out once the group buy is closed." };
    }
    if (mode !== "manual" && !shouldAutoInvoice(settings, roundClosedAt(gb))) return { sent: 0, unchanged: 0, guests: 0, skipped: 0 };

    const built = await buildRoundInvoices(tenantId, gb, settings, config.currency);
    const { guests, skipped } = built;
    // The automatic doors run often (the sweep, every 5 minutes for a week):
    // one query finds who already has this round's invoice, so a finished
    // round costs a single read instead of a transaction per customer.
    const invoices = resend ? built.invoices : await withoutSentInvoices(tenantId, gb.id, built.invoices);
    const already = built.invoices.length - invoices.length;
    const storeName = storeDisplayName(ctx);
    const result: InvoiceSendResult = { sent: 0, unchanged: already, guests, skipped };
    for (let i = 0; i < invoices.length; i += SENDERS_AT_ONCE) {
      const batch = invoices.slice(i, i + SENDERS_AT_ONCE);
      const posted = await Promise.all(batch.map((c) => postWithRetry(tenantId, gb.id, c, resend)));
      await Promise.all(
        posted.map(async (p, j) => {
          if (p === "already" || p === "unchanged") {
            result.unchanged++;
            return;
          }
          result.sent++;
          // The invoice is already in the chat: a push hiccup must not stop
          // the remaining customers' sends.
          try {
            await notifyOrderUpdate({
              tenantId,
              customerId: batch[j].customerId,
              conversationId: p.conversationId,
              orderNumber: batch[j].invoice.orderNumber,
              body: `Your ${gb.name} invoice (${batch[j].invoice.orderNumber}) is ready. Tap to view and pay.`,
              storeName,
            });
          } catch {
            /* notifyOrderUpdate logs its own failures */
          }
        }),
      );
    }
    return result;
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
    console.error(`[gb-invoice] send failed: ${e instanceof Error ? e.name : "Error"}${code}`);
    return { error: "Couldn't send the invoices. Please try again." };
  }
}

// ── The lapsed-round door ────────────────────────────────────────────────────

const SWEEP_EVERY_MS = 5 * 60_000;
/** Older closes are the button's job — the sweep never digs up history. */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60_000;
const lastSweep = new Map<string, number>();
/**
 * Rounds this instance already finished, keyed by round + end date + status:
 * a closed round takes no new orders, so once a sweep finds nothing to send it
 * is not re-read every 5 minutes for the rest of the week. Moving the end date
 * or reopening changes the key, so a re-lapsed round is looked at again.
 */
const sweptRounds = new Set<string>();
const sweepKey = (gb: GroupBuy) => `${gb.id}:${gb.endsAt ?? ""}:${gb.status}`;

/**
 * A round whose end date passed closes on read — no write, no event. This
 * catches those: at most once per tenant per 5 minutes per server instance,
 * it sends the invoices of rounds that closed in the last week (and after the
 * switch went on). Cheap when there is nothing to do; never throws.
 */
export async function sweepClosedRoundInvoices(tenantId: string, config: unknown): Promise<void> {
  const settings = normalizeGroupBuyInvoice((config as Record<string, unknown> | null)?.groupBuyInvoice);
  if (!settings.enabled) return;
  const now = Date.now();
  if (now - (lastSweep.get(tenantId) ?? 0) < SWEEP_EVERY_MS) return;
  lastSweep.set(tenantId, now);
  try {
    const caps = await resolveGroupBuyCaps(tenantId);
    if (!caps.enabled) return;
    const ctx = await getTenantContext(tenantId);
    const rounds = (await loadGroupBuys(tenantId, ctx.tenant.slug)).filter((gb) => {
      if (effectiveGroupBuyStatus(gb, caps.scheduled) !== "closed") return false;
      const closedAt = roundClosedAt(gb);
      return !!closedAt && now - Date.parse(closedAt) < SWEEP_WINDOW_MS && shouldAutoInvoice(settings, closedAt);
    });
    for (const gb of rounds) {
      if (sweptRounds.has(sweepKey(gb))) continue;
      const res = await sendGroupBuyInvoices(tenantId, gb.id, "sweep");
      if (!("error" in res) && res.sent === 0) sweptRounds.add(sweepKey(gb));
    }
  } catch (e) {
    console.error(`[gb-invoice] sweep failed: ${e instanceof Error ? e.name : "Error"}`);
  }
}
