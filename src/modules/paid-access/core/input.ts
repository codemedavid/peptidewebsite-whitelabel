/**
 * Customer and admin input at the boundary: money, proof of payment, form
 * answers. Each returns a value or a message the person can act on.
 */

import type { PaidAccessQuestion, Parsed } from "./types";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── Money ────────────────────────────────────────────────────────────────────

const PESOS_RE = /^(\d+)(?:\.(\d{1,2}))?$/;
const MAX_PESOS = 1_000_000;

/** "1,499.50" / 1499.5 / "₱ 99.9" → integer centavos, digit by digit (no float
 *  ever touches the stored amount). Zero is refused. */
export function parseAmountCents(input: unknown): Parsed<number> {
  const raw = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : typeof input === "string" ? input : "";
  const m = PESOS_RE.exec(raw.replace(/[₱,\s]/g, "").replace(/^PHP/i, ""));
  if (!m) return { ok: false, error: "Enter the amount in pesos, e.g. 500 or 499.50." };
  const whole = Number(m[1]);
  const cents = whole * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents <= 0) return { ok: false, error: "The amount must be more than ₱0." };
  if (whole > MAX_PESOS || (whole === MAX_PESOS && cents % 100 > 0)) return { ok: false, error: "That amount is too high." };
  return { ok: true, value: cents };
}

// ── Proof of payment ─────────────────────────────────────────────────────────

export type ProofSubmission = { reference: string; method: string; paidAt: Date | null };

const REFERENCE_MIN = 4;
const REFERENCE_MAX = 64;
const REFERENCE_RE = /^[A-Za-z0-9 .#/_-]+$/;
const METHOD_MAX = 60;
/** Phone clocks drift; a receipt "a few minutes in the future" is not fraud. */
const PAID_AT_SKEW_MS = 60 * 60 * 1000;

/** The member's half of a manual payment. Deliberately has no amount: the
 *  price is the server's, copied from the settings snapshot. */
export function parseProofSubmission(input: unknown, now: Date = new Date()): Parsed<ProofSubmission> {
  if (!input || typeof input !== "object") return { ok: false, error: "Missing payment details." };
  const o = input as Record<string, unknown>;
  const reference = text(o.reference, REFERENCE_MAX + 1);
  if (reference.length < REFERENCE_MIN) return { ok: false, error: "Enter the reference number from your receipt." };
  if (reference.length > REFERENCE_MAX) return { ok: false, error: "That reference number is too long." };
  if (!REFERENCE_RE.test(reference)) {
    return { ok: false, error: "The reference number can only use letters, numbers, spaces and - . # / _" };
  }
  let paidAt: Date | null = null;
  if (typeof o.paidAt === "string" && o.paidAt.trim()) {
    const d = new Date(o.paidAt);
    if (!Number.isNaN(d.getTime())) {
      if (d.getTime() > now.getTime() + PAID_AT_SKEW_MS) return { ok: false, error: "The payment date can't be in the future." };
      paidAt = d;
    }
  }
  return { ok: true, value: { reference, method: text(o.method, METHOD_MAX), paidAt } };
}

// ── Application form ─────────────────────────────────────────────────────────

const ANSWER_MAX = { short: 200, long: 2000, choice: 80 } as const;

/** Answers keyed by question id. Unknown keys are dropped; blanks of optional
 *  questions are left out. */
export function parseFormAnswers(questions: readonly PaidAccessQuestion[], input: unknown): Parsed<Record<string, string>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Please fill in the form." };
  const o = input as Record<string, unknown>;
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const raw = typeof o[q.id] === "string" ? (o[q.id] as string).trim() : "";
    if (!raw) {
      if (q.required) return { ok: false, error: `Please answer "${q.label}".` };
      continue;
    }
    if (raw.length > ANSWER_MAX[q.kind]) return { ok: false, error: `Your answer to "${q.label}" is too long.` };
    if (q.kind === "choice" && !q.options.includes(raw)) return { ok: false, error: `Pick one of the options for "${q.label}".` };
    answers[q.id] = raw;
  }
  return { ok: true, value: answers };
}
