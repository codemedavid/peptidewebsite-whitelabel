"use server";

// Super Admin action for the get-started checkout payment details — the
// platform's OWN receiving accounts (GCash / Maya / bank …) a new client pays
// their package to. Operator-gated; demo mode persists to
// .demo-data/platform-settings.json, DB mode to the platform_settings row.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode, saveDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  PACKAGE_PAYMENT_KEY,
  normalizePackagePayment,
  type PackagePaymentConfig,
} from "@/lib/platform/package-payment";

export type PackagePaymentResult = { ok: true } | { error: string };

function bust() {
  revalidatePath("/admin/payments");
  revalidatePath("/marketing/get-started");
}

export async function savePackagePaymentAction(
  input: PackagePaymentConfig,
): Promise<PackagePaymentResult> {
  await requirePlatformUser();

  const config = normalizePackagePayment(input);
  if (!config.methods.some((m) => m.active && m.method.trim())) {
    return { error: "Keep at least one active payment method — clients need a way to pay." };
  }
  for (const m of config.methods) {
    if (!m.method.trim()) return { error: "Every payment method needs a name." };
  }

  if (isDemoMode()) {
    saveDemoPlatformSetting(PACKAGE_PAYMENT_KEY, config);
    bust();
    return { ok: true };
  }

  try {
    await prisma.platformSetting.upsert({
      where: { key: PACKAGE_PAYMENT_KEY },
      update: { value: config as Prisma.InputJsonValue },
      create: { key: PACKAGE_PAYMENT_KEY, value: config as Prisma.InputJsonValue },
    });
  } catch {
    return { error: "Could not save — has the platform_settings table been pushed? (npm run db:push)" };
  }

  bust();
  return { ok: true };
}
