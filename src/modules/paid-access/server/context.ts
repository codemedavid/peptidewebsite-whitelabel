import "server-only";

// Shared server context for one Paid Access call: who's acting, the round being
// joined, whether the store has Paid Access at all, and the join window. Results
// use one envelope everywhere: { ok: true, … } or a Fail with a code the UI
// can branch on and a message a person can act on.

import { after } from "next/server";
import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getTenantContext } from "@/lib/tenant/context";
import { joinFeeLabel } from "@/lib/mobile/group-buy-share";
import { readPaymentMethods } from "@/lib/mobile/shop-checkout";
import {
  dbGroupBuyToStorefront,
  effectiveGroupBuyStatus,
  type DbGroupBuyRow,
  type GroupBuy,
  type GroupBuyCapabilities,
} from "@/lib/storefront/group-buy";
import { resolveGroupBuyCaps } from "@/lib/storefront/group-buy-server";
import type { SettingsError } from "../core/settings";
import type { PaidAccessSettings } from "../core/types";

export type Customer = { id: string; name: string; email: string };
/** A store admin: id "owner" or "staff:<id>"; email is used to refuse self-review. */
export type Admin = { kind: "admin"; id: string; email: string };

export type FailCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "conflict" | "closed" | "full" | "unavailable" | "server_error";
export type Fail = { ok: false; code: FailCode; message: string; errors?: SettingsError[] };

export const fail = (code: FailCode, message: string, errors?: SettingsError[]): Fail => ({
  ok: false,
  code,
  message,
  ...(errors ? { errors } : {}),
});

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A gated round whose settings aren't saved (or no longer validate). */
export const NOT_READY_MESSAGE = "The store is still setting up how to join this group buy. Check back soon.";

/** A real admin actor, or a refusal. Guards against a customer (or junk) being
 *  passed where an admin is required. */
export function asAdmin(actor: unknown): Admin | null {
  if (!actor || typeof actor !== "object") return null;
  const a = actor as Record<string, unknown>;
  if (a.kind !== "admin" || typeof a.id !== "string" || !a.id) return null;
  return { kind: "admin", id: a.id, email: typeof a.email === "string" ? a.email : "" };
}

export const sameEmail = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export type RoundContext = {
  round: GroupBuy;
  caps: GroupBuyCapabilities;
  /** Paid Access applies to this store (groupbuy.module + groupbuy.paid_access). */
  enabled: boolean;
  currency: string;
  config: Record<string, unknown>;
};

export async function storeConfig(tenantId: string): Promise<Record<string, unknown>> {
  return ((await getTenantContext(tenantId)).branding?.config ?? {}) as Record<string, unknown>;
}

export function currencyOf(config: Record<string, unknown>): string {
  return typeof config.currency === "string" && config.currency ? config.currency : "₱";
}

export const money = (currency: string, cents: number) => joinFeeLabel(currency, cents);

export const paymentAccountsOf = (config: Record<string, unknown>) => readPaymentMethods(config, false);

/** Paid Access's switch for a store. Off → every round is Open. */
export async function paidAccessEnabled(tenantId: string): Promise<{ enabled: boolean; caps: GroupBuyCapabilities }> {
  const caps = await resolveGroupBuyCaps(tenantId);
  return { enabled: caps.enabled && caps.paidAccess && !isDemoMode(), caps };
}

/** The round, scoped to the store. Foreign and unknown ids are both not_found. */
export async function loadRound(tenantId: string, groupBuyId: unknown): Promise<RoundContext | Fail> {
  if (typeof groupBuyId !== "string" || !ID_RE.test(groupBuyId)) return fail("invalid_input", "Unknown group buy.");
  const { enabled, caps } = await paidAccessEnabled(tenantId);
  if (isDemoMode()) return fail("unavailable", "Joining isn't available in the demo store.");
  const row = await withTenant(tenantId, (db) => db.groupBuy.findFirst({ where: { id: groupBuyId } }));
  if (!row) return fail("not_found", "We couldn't find that group buy.");
  const config = await storeConfig(tenantId);
  return { round: dbGroupBuyToStorefront(row as DbGroupBuyRow), caps, enabled, currency: currencyOf(config), config };
}

export type JoinWindow = { open: boolean; opensAt: string | null; closesAt: string | null; message: string };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

/**
 * When joining (and paying) is allowed: the round must be live or upcoming,
 * and `now` inside the settings' window — whose blank ends follow the round's
 * own dates. Admin decisions are NOT bound by it (they may approve after close).
 */
export function joinWindow(round: GroupBuy, settings: Pick<PaidAccessSettings, "schedule">, caps: GroupBuyCapabilities, now: Date): JoinWindow {
  const opensAt = settings.schedule.opensAt;
  const closesAt = settings.schedule.closesAt ?? round.endsAt;
  const base = { opensAt, closesAt };
  const status = effectiveGroupBuyStatus(round, caps.scheduled, now);
  if (status === "closed") return { ...base, open: false, message: "This group buy has closed." };
  if (status !== "active" && status !== "scheduled") return { ...base, open: false, message: "This group buy isn't open." };
  if (opensAt && now.getTime() < Date.parse(opensAt)) return { ...base, open: false, message: `Joining opens ${fmtDate(opensAt)}.` };
  if (closesAt && now.getTime() >= Date.parse(closesAt)) return { ...base, open: false, message: "Joining has closed for this group buy." };
  return { ...base, open: true, message: "" };
}

/** Run after the response (notifications). Outside a request — scripts, cron
 *  edge cases — it just runs; it never throws into the caller. */
export function later(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    void fn().catch(() => undefined);
  }
}
