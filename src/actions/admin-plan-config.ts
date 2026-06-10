"use server";

// Super Admin action for plan pricing + feature lists — what each package costs
// and the bullets shown on the pricing cards (admin Plans & Billing, the
// create-tenant drawer, the marketing pricing section, and the get-started
// wizard). Operator-gated; demo mode persists to
// .demo-data/platform-settings.json, DB mode to the platform_settings row.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode, saveDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  PLAN_CONFIG_KEY,
  normalizePlanConfig,
  type PlanConfig,
} from "@/lib/platform/plan-config";

export type PlanConfigResult = { ok: true } | { error: string };

function bust() {
  revalidatePath("/admin/plans");
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath("/marketing");
  revalidatePath("/marketing/get-started");
}

export async function savePlanConfigAction(input: PlanConfig): Promise<PlanConfigResult> {
  await requirePlatformUser();

  // Reject obviously-broken inputs before normalize silently "fixes" them —
  // the operator should know their edit didn't take.
  const rawPlans = Array.isArray(input?.plans) ? input.plans : [];
  for (const p of rawPlans) {
    const cents = Math.round(Number(p?.priceCents));
    if (!Number.isFinite(cents) || cents <= 0) {
      return { error: `${p?.name || "Every plan"} needs a monthly price above ₱0.` };
    }
    const feats = Array.isArray(p?.feats) ? p.feats.filter((f) => String(f ?? "").trim()) : [];
    if (feats.length === 0) {
      return { error: `${p?.name || "Every plan"} needs at least one feature bullet.` };
    }
  }

  const config = normalizePlanConfig(input);

  if (isDemoMode()) {
    saveDemoPlatformSetting(PLAN_CONFIG_KEY, config);
    bust();
    return { ok: true };
  }

  try {
    await prisma.platformSetting.upsert({
      where: { key: PLAN_CONFIG_KEY },
      update: { value: config as Prisma.InputJsonValue },
      create: { key: PLAN_CONFIG_KEY, value: config as Prisma.InputJsonValue },
    });
  } catch {
    return { error: "Could not save — has the platform_settings table been pushed? (npm run db:push)" };
  }

  bust();
  return { ok: true };
}
