"use client";

// The cart's "how close am I" panel — the free-shipping bar and the voucher
// ladder (lib/storefront/free-shipping, lib/storefront/voucher-ladder). Purely
// presentational: CartCheckout derives every number from the same rules the
// server re-applies at placement, so nothing here can promise a saving the
// order won't honor. Renders nothing when neither piece is running.

import type { FreeShippingProgress } from "@/lib/storefront/free-shipping";
import { nextVoucherTarget, type VoucherRung } from "@/lib/storefront/voucher-ladder";

type Props = {
  currency: string;
  rungs: VoucherRung[];
  freeShipping: FreeShippingProgress | null;
};

const money = (currency: string, n: number) => `${currency}${n.toLocaleString()}`;

function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div
      className="sf-meter__bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="sf-meter__fill" style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

function FreeShippingRow({ currency, p }: { currency: string; p: FreeShippingProgress }) {
  return (
    <div className={`sf-meter__row${p.reached ? " is-reached" : ""}`}>
      <p className="sf-meter__line">
        {p.reached ? (
          <strong>You&apos;ve got free shipping.</strong>
        ) : (
          <>
            Add <strong>{money(currency, p.remaining)}</strong> more for <strong>free shipping</strong>
          </>
        )}
      </p>
      <ProgressBar fraction={p.fraction} label={`Free shipping at ${money(currency, p.threshold)}`} />
    </div>
  );
}

function rungCaption(r: VoucherRung, currency: string): string {
  if (r.state === "applied") return "Applied";
  if (r.state === "unlocked") return "Unlocked";
  return `${money(currency, r.remaining)} to go`;
}

function VoucherLadder({ currency, rungs }: { currency: string; rungs: VoucherRung[] }) {
  const next = nextVoucherTarget(rungs);
  const applied = rungs.find((r) => r.state === "applied");
  return (
    <div className="sf-meter__row">
      <p className="sf-meter__line">
        {next ? (
          <>
            Spend <strong>{money(currency, next.remaining)}</strong> more to get{" "}
            <strong>{next.offLabel}</strong>
          </>
        ) : applied ? (
          <>
            Best voucher applied: <strong>{applied.offLabel}</strong>
          </>
        ) : (
          <>Every voucher unlocked</>
        )}
      </p>
      {next && next.minPurchase > 0 && (
        <ProgressBar
          fraction={(next.minPurchase - next.remaining) / next.minPurchase}
          label={`Progress to ${next.offLabel}`}
        />
      )}
      <ul className="sf-meter__rungs" aria-label="Vouchers">
        {rungs.map((r) => (
          <li key={r.code} className={`sf-meter__rung is-${r.state}`}>
            <span className="sf-meter__rung-off">{r.offLabel}</span>
            <span className="sf-meter__rung-min">
              {r.minPurchase > 0 ? `min ${money(currency, r.minPurchase)}` : "no minimum"}
            </span>
            <span className="sf-meter__rung-state">{rungCaption(r, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PromoMeter({ currency, rungs, freeShipping }: Props) {
  if (!freeShipping && rungs.length === 0) return null;
  return (
    <section className="sf-meter" aria-label="Savings">
      {freeShipping && <FreeShippingRow currency={currency} p={freeShipping} />}
      {rungs.length > 0 && <VoucherLadder currency={currency} rungs={rungs} />}
    </section>
  );
}
