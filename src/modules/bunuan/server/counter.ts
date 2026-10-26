import "server-only";

// The admin's live Bunuan counter (admin only, polled ~5s by the dashboard and
// the app). A decision surface, so it is always read live — never cached.

import { withTenant } from "@/lib/db/tenant-client";
import type { GbBunuanCounterResult } from "@/lib/mobile/shop-contract";
import { bunuanCounter, effectiveStage } from "../core";
import { loadRoundState } from "./round-state";
import { ID_RE, NO_STAGES, NOT_FOUND, stagesOn, type GbCtx } from "./stage";

export async function getBunuanCounter(ctx: GbCtx, roundId: unknown): Promise<GbBunuanCounterResult> {
  if (!stagesOn(ctx.caps)) return NO_STAGES;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return NOT_FOUND;
  const state = await withTenant(ctx.tenantId, (db) => loadRoundState(db, roundId));
  if (!state) return NOT_FOUND;
  const c = bunuanCounter(state.kitOrders, state.products, state.mode);
  return {
    ok: true,
    counter: {
      roundId,
      stage: effectiveStage(state.round),
      kits: c.kits.map((k) => ({
        key: k.key,
        productId: k.productId,
        variation: k.variation,
        name: k.name,
        kitSize: k.kitSize,
        vials: k.vials,
        fullKits: k.fullKits,
        leftover: k.leftover,
        vialsNeeded: k.vialsNeeded,
        pendingVials: k.pendingVials,
      })),
      openCount: c.openCount,
      allFilled: c.allFilled,
      countedAt: new Date().toISOString(),
    },
  };
}
