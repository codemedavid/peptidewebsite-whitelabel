// Server-side read for the get-started checkout payment details. Demo mode →
// .demo-data/platform-settings.json; DB mode → platform_settings row. Falls back
// to the hardcoded marketing-config default when nothing has been saved yet (or
// the table hasn't been pushed), so /get-started never breaks.

import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  PACKAGE_PAYMENT_KEY,
  defaultPackagePayment,
  normalizePackagePayment,
  type PackagePaymentConfig,
} from "./package-payment";

export async function getPackagePayment(): Promise<PackagePaymentConfig> {
  if (isDemoMode()) {
    const saved = getDemoPlatformSetting(PACKAGE_PAYMENT_KEY);
    return saved ? normalizePackagePayment(saved) : defaultPackagePayment();
  }
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: PACKAGE_PAYMENT_KEY } });
    return row ? normalizePackagePayment(row.value) : defaultPackagePayment();
  } catch {
    // Table missing (db push not run yet) or DB hiccup — keep checkout working.
    return defaultPackagePayment();
  }
}
