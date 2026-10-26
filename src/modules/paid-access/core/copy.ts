/**
 * The join page's wording — the store's own words where it typed some, the
 * built-in ones where it left a field blank. Pure; the website, the app's
 * editor (by copy) and the server all resolve labels through these helpers.
 */

import type { PaidAccessCopy, PaidAccessStep } from "./types";

/** Nothing typed: every surface shows its built-in wording. */
export const EMPTY_COPY: PaidAccessCopy = Object.freeze({
  intro: "",
  button: "",
  note: "",
  steps: Object.freeze({ form: "", payment: "", approval: "", access: "" }),
}) as PaidAccessCopy;

export const COPY_LIMITS = { intro: 300, button: 40, note: 200, step: 40 } as const;

/** Typed into a payment step name, it becomes the price ("Pay {amount} to join"). */
export const AMOUNT_TOKEN = "{amount}";

export const DEFAULT_ACCESS_LABEL = "Access";

const withAmount = (text: string, amountLabel: string) => text.split(AMOUNT_TOKEN).join(amountLabel);

/** A step's name: the store's, else `fallback` (the surface's built-in name). */
export function stepLabel(copy: PaidAccessCopy | undefined, step: PaidAccessStep, amountLabel: string, fallback: string): string {
  const custom = copy?.steps[step]?.trim();
  return custom ? withAmount(custom, amountLabel) : fallback;
}

export function accessLabel(copy: PaidAccessCopy | undefined): string {
  return copy?.steps.access?.trim() || DEFAULT_ACCESS_LABEL;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Stored JSON → copy. Defensive (rows written before copy existed have none). */
export function readCopy(raw: unknown): PaidAccessCopy {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (o.steps && typeof o.steps === "object" ? o.steps : {}) as Record<string, unknown>;
  return {
    intro: text(o.intro, COPY_LIMITS.intro),
    button: text(o.button, COPY_LIMITS.button),
    note: text(o.note, COPY_LIMITS.note),
    steps: {
      form: text(s.form, COPY_LIMITS.step),
      payment: text(s.payment, COPY_LIMITS.step),
      approval: text(s.approval, COPY_LIMITS.step),
      access: text(s.access, COPY_LIMITS.step),
    },
  };
}
