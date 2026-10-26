"use client";

// Shopper-facing kit progress for a group-buy product: how full the kit that is
// currently filling is ("7 of 10 vials — 3 more to complete the kit"). Shown on
// the group-buy page and catalog cards while a round is live and the owner set
// the product's vials per kit (lib/storefront/gb-moq-kits → roundKitProgress).

import type { KitProgress } from "@/lib/storefront/gb-moq-kits";

function kitLabel(kit: KitProgress): string {
  if (kit.remaining === 0) {
    return kit.fullKits > 1
      ? `${kit.fullKits} kits complete`
      : `Kit complete — ${kit.perKit} of ${kit.perKit} vials`;
  }
  const which = kit.fullKits > 0 ? `kit ${kit.fullKits + 1}` : "the kit";
  return `${kit.inKit} of ${kit.perKit} vials — ${kit.remaining} more to complete ${which}`;
}

export function KitProgressBar({ kit }: { kit: KitProgress }) {
  const label = kitLabel(kit);
  return (
    <div
      className="kit-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={kit.perKit}
      aria-valuenow={kit.inKit}
      data-complete={kit.remaining === 0 ? "1" : undefined}
    >
      <div className="kit-progress__track" aria-hidden>
        <span
          className="kit-progress__fill"
          style={{ transform: `scaleX(${kit.inKit / kit.perKit})` }}
        />
      </div>
      <div className="kit-progress__label">{label}</div>
    </div>
  );
}
