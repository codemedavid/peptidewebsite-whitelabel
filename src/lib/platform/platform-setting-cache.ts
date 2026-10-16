// Cached read of one platform-global `platform_settings` row.
//
// These rows (plan pricing, plan features, package payment) change only when an
// operator saves, and each save action busts `platformSettingTag(key)`. Uncached
// they were re-read on every request (~168k reads since May) — one cache entry
// per key now serves every storefront and marketing page.
//
// The helper THROWS on a DB error (unstable_cache never stores a throw), so each
// reader keeps its own catch → default, and a hiccup is never cached for an hour.

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";

/** Long window: only an operator save changes these rows, and it busts the tag. */
const REVALIDATE_SECONDS = 3600;

export function platformSettingTag(key: string): string {
  return `platform:setting:${key}`;
}

/** The row's JSON value, or null when nothing has been saved yet. */
export function loadPlatformSettingValue(key: string): Promise<unknown> {
  return unstable_cache(
    async () => {
      const row = await prisma.platformSetting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    ["platform-setting", key],
    { tags: [platformSettingTag(key)], revalidate: REVALIDATE_SECONDS },
  )();
}
