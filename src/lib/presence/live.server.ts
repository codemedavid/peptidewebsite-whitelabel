import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import type { LiveResponse, LiveSurface } from "@/lib/mobile/contract";
import { formatMoney } from "@/lib/storefront/currency";
import {
  buildLiveSnapshot,
  LIVE_WINDOW_MS,
  RETAIN_MS,
  type GeoPlace,
  type PresenceBeat,
} from "./live";

// Most live rows one snapshot reads. Far above any store's real concurrency;
// it only bounds a flood of fake visitor ids.
const MAX_LIVE_ROWS = 500;

/** Upsert (or, on leave, drop) one visitor's heartbeat. One short transaction. */
export async function recordPresence(
  tenantId: string,
  input: { visitorId: string; surface: LiveSurface; beat: PresenceBeat; customerId: string | null; geo: GeoPlace },
): Promise<void> {
  const { visitorId, surface, beat, customerId, geo } = input;
  await withTenant(tenantId, async (db) => {
    if (beat.leave) {
      await db.livePresence.deleteMany({ where: { visitorId } });
      return;
    }
    const fields = {
      surface,
      stage: beat.stage,
      productRef: beat.productRef,
      cartItems: beat.cartItems,
      cartValue: beat.cartValue,
      currency: beat.currency,
      customerId,
      lastSeenAt: new Date(),
    };
    await db.livePresence.upsert({
      where: { tenantId_visitorId: { tenantId, visitorId } },
      create: { tenantId, visitorId, ...fields, ...geo },
      // A beat without location headers (local dev, a proxy) keeps the old place.
      update: {
        ...fields,
        ...(geo.city ? { city: geo.city } : {}),
        ...(geo.region ? { region: geo.region } : {}),
        ...(geo.country ? { country: geo.country } : {}),
      },
    });
  });
}

/** The admin's live snapshot; prunes rows past the 24h retention on the way. */
export async function loadLive(tenantId: string, storeCurrency: unknown): Promise<LiveResponse> {
  const now = new Date();
  const liveSince = new Date(now.getTime() - LIVE_WINDOW_MS);
  const daySince = new Date(now.getTime() - RETAIN_MS);

  const { rows, last24h, products, customers } = await withTenant(tenantId, async (db) => {
    await db.livePresence.deleteMany({ where: { lastSeenAt: { lt: daySince } } });
    const rows = await db.livePresence.findMany({
      where: { lastSeenAt: { gte: liveSince } },
      orderBy: { lastSeenAt: "desc" },
      take: MAX_LIVE_ROWS,
    });
    const last24h = await db.livePresence.count({ where: { lastSeenAt: { gte: daySince } } });

    const refs = [...new Set(rows.map((r) => r.productRef).filter((r): r is string => !!r))];
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter((c): c is string => !!c))];
    const products = refs.length
      ? await db.product.findMany({
          where: { OR: [{ id: { in: refs } }, { slug: { in: refs } }] },
          select: { id: true, slug: true, name: true },
        })
      : [];
    const customers = customerIds.length
      ? await db.storefrontCustomer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : [];
    return { rows, last24h, products, customers };
  });

  const productNames = new Map<string, string>();
  for (const p of products) {
    productNames.set(p.id, p.name);
    if (p.slug) productNames.set(p.slug, p.name);
  }
  const customerNames = new Map(customers.map((c) => [c.id, c.name?.trim() || null]));

  return buildLiveSnapshot({
    rows,
    last24h,
    now,
    lookups: {
      productName: (ref) => productNames.get(ref) ?? null,
      customerName: (id) => customerNames.get(id) ?? "App customer",
      money: (value, currency) => formatMoney(value, currency ?? storeCurrency),
    },
  });
}
