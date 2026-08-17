"use client";

/**
 * The "mark this due date paid" drawer on /admin/calendar.
 *
 * Three things happen when the operator saves, and the form is laid out to make
 * all three legible before they commit:
 *
 *   RECEIVED  — how much landed and when. The date is what My Income keys the
 *               month on, so it defaults to today, not to the due date.
 *   NEXT TERM — what the tenant will be charged going forward ("singil") and on
 *               what cycle. Monthly by default. Blank amount = keep their price.
 *   NEXT DUE  — recomputed from the cycle as the operator switches it, and shown
 *               back as a sentence, because this is the field that actually
 *               stops the tenant's countdown from nagging them.
 *
 * All validation lives in planSettlement (npm run test:calendar-paid); this
 * component only collects strings and previews the derived next due date.
 */

import { useState } from "react";
import { Ic } from "@/components/admin/shell/primitives";
import { BILLING_CYCLES, BILLING_CYCLE_LABELS } from "@/lib/subscription/billing-cycle";
import { SUBSCRIPTION_PAYMENT_METHODS } from "@/lib/subscription/payments";
import { defaultNextDueDay } from "@/lib/admin/calendar-settlement";

/** The due date the operator clicked, plus what we know about the tenant. */
export type MarkPaidTarget = {
  tenantId: string;
  tenantName: string;
  /** "YYYY-MM-DD" of the due date being settled. */
  dueDay: string;
  /** The tenant's current fee, centavos — prefills "amount received". */
  amountCents?: number;
  cycle?: string | null;
};

export type MarkPaidValues = {
  amount: string;
  paidDay: string;
  method: string;
  billAmount: string;
  cycle: string;
  nextDueDay: string;
};

/** Centavos -> a plain peso string an operator can edit ("1499" / "1499.50"). */
function pesoInput(cents?: number): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** "2026-09-21" -> "21 Sep 2026". UTC, matching the grid's bucketing. */
function readableDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The tenant's cycle when it's one we know, else monthly — the stated default. */
function initialCycle(cycle: string | null | undefined): string {
  return (BILLING_CYCLES as readonly string[]).includes(cycle ?? "") ? (cycle as string) : "monthly";
}

type Props = {
  target: MarkPaidTarget;
  todayIso: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (values: MarkPaidValues) => void;
};

export function CalendarMarkPaidDrawer({ target, todayIso, pending, onCancel, onSave }: Props) {
  const startCycle = initialCycle(target.cycle);

  const [amount, setAmount] = useState(pesoInput(target.amountCents));
  const [paidDay, setPaidDay] = useState(todayIso);
  const [method, setMethod] = useState<string>(SUBSCRIPTION_PAYMENT_METHODS[0]);
  const [billAmount, setBillAmount] = useState("");
  const [cycle, setCycle] = useState(startCycle);
  const [nextDueDay, setNextDueDay] = useState(defaultNextDueDay(startCycle, target.dueDay));
  // Once the operator types their own next due date, switching cycle must not
  // silently overwrite it.
  const [nextEdited, setNextEdited] = useState(false);

  function pickCycle(next: string) {
    setCycle(next);
    if (!nextEdited) setNextDueDay(defaultNextDueDay(next, target.dueDay));
  }

  return (
    <>
      <div className="sa-drawer-backdrop" onClick={onCancel} />
      <div className="sa-drawer" role="dialog" aria-modal="true" aria-label="Record subscription payment">
        <div className="drawer-head">
          <div>
            <div className="drawer-title">Mark paid — {target.tenantName}</div>
            <div className="drawer-sub">Due {readableDay(target.dueDay)}</div>
          </div>
          <button type="button" className="drawer-close" onClick={onCancel} aria-label="Close">
            <Ic.X />
          </button>
        </div>

        <div className="drawer-body">
          <div className="cal-fieldset-label">Received</div>

          <label className="field-label" htmlFor="paid-amount">
            Amount received
          </label>
          <input
            id="paid-amount"
            className="input mb-3"
            inputMode="decimal"
            autoFocus
            value={amount}
            placeholder="1499"
            onChange={(e) => setAmount(e.target.value)}
          />

          <label className="field-label" htmlFor="paid-day">
            Date received
          </label>
          <input
            id="paid-day"
            type="date"
            className="input"
            value={paidDay}
            onChange={(e) => setPaidDay(e.target.value)}
          />
          <div className="field-hint mb-3">This is the month it counts in on My Income.</div>

          <label className="field-label" htmlFor="paid-method">
            Paid through
          </label>
          <select
            id="paid-method"
            className="input mb-4"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <div className="cal-fieldset-label">Next term</div>

          <label className="field-label" htmlFor="bill-amount">
            Amount to charge
          </label>
          <input
            id="bill-amount"
            className="input"
            inputMode="decimal"
            value={billAmount}
            placeholder={pesoInput(target.amountCents) || "1499"}
            onChange={(e) => setBillAmount(e.target.value)}
          />
          <div className="field-hint mb-3">
            Leave blank to keep their current price. For a yearly cycle, type the whole year&rsquo;s
            amount — it&rsquo;s split back to a monthly rate for MRR.
          </div>

          <label className="field-label" htmlFor="bill-cycle">
            Billing cycle
          </label>
          <select
            id="bill-cycle"
            className="input mb-3"
            value={cycle}
            onChange={(e) => pickCycle(e.target.value)}
          >
            {BILLING_CYCLES.map((c) => (
              <option key={c} value={c}>
                {BILLING_CYCLE_LABELS[c]}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="next-due">
            Next due date
          </label>
          <input
            id="next-due"
            type="date"
            className="input"
            value={nextDueDay}
            onChange={(e) => {
              setNextEdited(true);
              setNextDueDay(e.target.value);
            }}
          />

          <div className="cal-outcome">
            <Ic.CheckCircle />
            <span>
              <strong>{target.tenantName}</strong> stops showing as due and won&rsquo;t be chased
              again until <strong>{readableDay(nextDueDay)}</strong>.
            </span>
          </div>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={pending}
            onClick={() => onSave({ amount, paidDay, method, billAmount, cycle, nextDueDay })}
          >
            {pending ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </>
  );
}
