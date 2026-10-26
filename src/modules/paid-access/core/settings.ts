/**
 * Paid Access settings — the one schema every write goes through (admin panel,
 * app, ChatGPT connector, scripts). zod for the shape, then the rules that
 * span fields: a step order that makes sense, a price when there's a payment
 * step, a waitlist only with a slot limit, and so on. Every refusal carries a
 * `path` (for the field it belongs to) and a message a store owner can act on.
 *
 * Client-safe: the admin panel runs it live as the owner types.
 */

import { z } from "zod";
import { COPY_LIMITS } from "./copy";
import { PAID_ACCESS_STEPS, type PaidAccessSettings, type PaidAccessStep } from "./types";

export type SettingsError = { path: string; message: string };
export type SettingsResult = { ok: true; settings: PaidAccessSettings } | { ok: false; errors: SettingsError[] };
export type SettingsContext = {
  /** True only once the store has a verified online payment provider. */
  onlinePaymentsAvailable: boolean;
};

const MAX_AMOUNT_CENTS = 100_000_000; // ₱1,000,000
const MAX_SLOTS = 100_000;
const MIN_WINDOW_MINUTES = 5;
const MAX_WINDOW_MINUTES = 7 * 24 * 60;
const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 20;

/**
 * Null = a sensible order. Otherwise the reason, in words. The form may only
 * come first: an application filed after paying or being approved decides
 * nothing.
 */
export function validateStepOrder(steps: readonly string[]): string | null {
  const known = PAID_ACCESS_STEPS as readonly string[];
  const unknown = steps.find((s) => !known.includes(s));
  if (unknown !== undefined) return `Unknown step "${unknown}". Use form, payment or approval.`;
  if (new Set(steps).size !== steps.length) return "You can use each step only once.";
  if (steps.length > PAID_ACCESS_STEPS.length) return "A flow can have at most three steps: form, payment and approval.";
  const formAt = steps.indexOf("form");
  if (formAt > 0) return "The application form has to be the first step — people apply before they pay or are approved.";
  return null;
}

/** Optional join-page wording: blank = the built-in words. */
const copyText = (max: number, what: string) =>
  z
    .string({ message: "Text only, please." })
    .trim()
    .max(max, { message: `Keep ${what} under ${max} characters.` })
    .default("");

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Enter a valid date." })
  .nullable();

const questionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, { message: "Question ids may only use letters, numbers, - and _." }),
  label: z
    .string()
    .trim()
    .min(1, { message: "Every question needs a label." })
    .max(200, { message: "Keep questions under 200 characters." }),
  kind: z.enum(["short", "long", "choice"], { message: "Pick a question type." }),
  required: z.boolean(),
  options: z
    .array(z.string().trim().min(1, { message: "Options can't be blank." }).max(80, { message: "Keep options under 80 characters." }))
    .max(MAX_OPTIONS, { message: `A question can have at most ${MAX_OPTIONS} options.` }),
});

const baseSchema = z.object({
  steps: z.array(z.string(), { message: "Pick the steps for this group buy." }),
  form: z.object({
    questions: z.array(questionSchema).max(MAX_QUESTIONS, { message: `The form can have at most ${MAX_QUESTIONS} questions.` }),
  }),
  payment: z.object({
    amountMode: z.enum(["full", "deposit"], { message: "Choose full payment or a deposit." }),
    amountCents: z
      .number({ message: "Enter the amount members pay to join." })
      .int({ message: "Enter the amount in centavos." })
      .min(0, { message: "The amount can't be negative." })
      .max(MAX_AMOUNT_CENTS, { message: "That amount is too high." }),
    method: z.enum(["online", "manual", "either"], { message: "Choose how members pay." }),
    windowMinutes: z
      .number({ message: "Enter the payment window in minutes." })
      .int({ message: "Use whole minutes for the payment window." })
      .min(MIN_WINDOW_MINUTES, { message: `The payment window must be at least ${MIN_WINDOW_MINUTES} minutes.` })
      .max(MAX_WINDOW_MINUTES, { message: "The payment window can be at most 7 days." })
      .nullable(),
  }),
  capacity: z.object({
    maxSlots: z
      .number({ message: "Enter the number of slots." })
      .int({ message: "Slots must be a whole number." })
      .min(1, { message: "A slot limit must be at least 1." })
      .max(MAX_SLOTS, { message: "That slot limit is too high." })
      .nullable(),
    waitlist: z.boolean(),
  }),
  schedule: z.object({ opensAt: isoDate, closesAt: isoDate }),
  refundOnReject: z.enum(["auto", "manual", "none"], { message: "Choose what happens to payments when someone is rejected." }),
  pendingVisibility: z.enum(["nothing", "summary"], { message: "Choose what pending members can see." }),
  notify: z.object({ paid: z.boolean(), approved: z.boolean(), rejected: z.boolean(), newPending: z.boolean() }),
  copy: z
    .object({
      intro: copyText(COPY_LIMITS.intro, "the description"),
      button: copyText(COPY_LIMITS.button, "the button text"),
      note: copyText(COPY_LIMITS.note, "the note"),
      steps: z
        .object({
          form: copyText(COPY_LIMITS.step, "step names"),
          payment: copyText(COPY_LIMITS.step, "step names"),
          approval: copyText(COPY_LIMITS.step, "step names"),
          access: copyText(COPY_LIMITS.step, "step names"),
        })
        .default({}),
    })
    .default({}),
});

type Base = z.infer<typeof baseSchema>;

function crossFieldErrors(s: Base, ctx: SettingsContext): SettingsError[] {
  const errors: SettingsError[] = [];
  const order = validateStepOrder(s.steps);
  if (order) errors.push({ path: "steps", message: order });
  const steps = new Set(s.steps);

  if (steps.has("payment")) {
    if (s.payment.amountCents <= 0) {
      errors.push({ path: "payment.amountCents", message: "Enter the amount members pay to join." });
    }
    if (s.payment.method !== "manual" && !ctx.onlinePaymentsAvailable) {
      errors.push({
        path: "payment.method",
        message: "Online payments aren't connected for this store yet — use manual proof upload for now.",
      });
    }
    if (s.refundOnReject === "auto" && s.payment.method === "manual") {
      errors.push({
        path: "refundOnReject",
        message: "Automatic refunds need online payments. Choose manual refunds, or accept online payments.",
      });
    }
  }

  if (steps.has("form")) {
    if (s.form.questions.length === 0) {
      errors.push({ path: "form.questions", message: "Add at least one question to the application form, or remove the form step." });
    }
    const ids = new Set<string>();
    s.form.questions.forEach((q, i) => {
      if (ids.has(q.id)) errors.push({ path: `form.questions.${i}.id`, message: "Two questions share the same id." });
      ids.add(q.id);
      if (q.kind === "choice" && q.options.length < 2) {
        errors.push({ path: `form.questions.${i}.options`, message: "A choice question needs at least two options." });
      }
    });
  }

  if (s.capacity.waitlist && s.capacity.maxSlots === null) {
    errors.push({ path: "capacity.waitlist", message: "Turn on a slot limit to use a waitlist." });
  }

  const { opensAt, closesAt } = s.schedule;
  if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
    errors.push({ path: "schedule.closesAt", message: "The close date must be after the open date." });
  }
  return errors;
}

/** Validate untrusted settings. Never throws; unknown keys are dropped. */
export function validateSettings(input: unknown, ctx: SettingsContext): SettingsResult {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.code === "invalid_type" && issue.path.length === 0 ? "Settings are missing." : issue.message,
      })),
    };
  }
  const errors = crossFieldErrors(parsed.data, ctx);
  if (errors.length > 0) return { ok: false, errors };
  const data = parsed.data;
  const settings: PaidAccessSettings = {
    ...data,
    steps: data.steps as PaidAccessStep[],
    schedule: {
      opensAt: data.schedule.opensAt ? new Date(data.schedule.opensAt).toISOString() : null,
      closesAt: data.schedule.closesAt ? new Date(data.schedule.closesAt).toISOString() : null,
    },
  };
  return { ok: true, settings };
}

/** Does this GB need anyone to "join" at all? Open with no slot limit doesn't. */
export function requiresJoin(settings: Pick<PaidAccessSettings, "steps" | "capacity">): boolean {
  return settings.steps.length > 0 || settings.capacity.maxSlots !== null;
}
