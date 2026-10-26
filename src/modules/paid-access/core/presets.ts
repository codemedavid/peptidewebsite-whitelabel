/**
 * The five one-click presets. A preset only picks the STEPS (and the refund
 * default that goes with them); everything the admin fine-tuned — price,
 * payment window, slots, dates, questions — survives switching presets.
 */

import { EMPTY_COPY } from "./copy";
import type { PaidAccessQuestion, PaidAccessSettings, PaidAccessStep } from "./types";

export const PAID_ACCESS_PRESET_IDS = ["open", "pay_to_join", "pay_then_approve", "approve_then_pay", "apply_then_approve"] as const;
export type PaidAccessPresetId = (typeof PAID_ACCESS_PRESET_IDS)[number];

export type PaidAccessPreset = { id: PaidAccessPresetId; label: string; description: string; steps: readonly PaidAccessStep[] };

export const PAID_ACCESS_PRESETS: readonly PaidAccessPreset[] = [
  { id: "open", label: "Open", description: "Anyone can join instantly — no payment, no approval.", steps: [] },
  { id: "pay_to_join", label: "Pay to join", description: "Members get in as soon as their payment is confirmed.", steps: ["payment"] },
  {
    id: "pay_then_approve",
    label: "Pay then approve",
    description: "Members pay, then you approve each one before they get in.",
    steps: ["payment", "approval"],
  },
  {
    id: "approve_then_pay",
    label: "Approve then pay",
    description: "You approve first; approved members then pay to get in.",
    steps: ["approval", "payment"],
  },
  {
    id: "apply_then_approve",
    label: "Apply then approve",
    description: "Members fill a short application and you approve it. Free.",
    steps: ["form", "approval"],
  },
];

/** The default preset a GB starts on when an admin first opens the panel. */
export const DEFAULT_PRESET_ID: PaidAccessPresetId = "pay_then_approve";

const DEFAULT_QUESTION: PaidAccessQuestion = {
  id: "about",
  label: "Tell us a bit about yourself and why you'd like to join.",
  kind: "long",
  required: true,
  options: [],
};

/** Open: no steps, no limits — only ever by the admin's explicit choice. */
export const OPEN_SETTINGS: PaidAccessSettings = Object.freeze({
  steps: [],
  form: { questions: [] },
  payment: { amountMode: "full", amountCents: 0, method: "manual", windowMinutes: null },
  capacity: { maxSlots: null, waitlist: false },
  schedule: { opensAt: null, closesAt: null },
  refundOnReject: "none",
  pendingVisibility: "summary",
  notify: { paid: true, approved: true, rejected: true, newPending: true },
  copy: EMPTY_COPY,
}) as PaidAccessSettings;

function clone(s: PaidAccessSettings): PaidAccessSettings {
  return {
    steps: [...s.steps],
    form: { questions: s.form.questions.map((q) => ({ ...q, options: [...q.options] })) },
    payment: { ...s.payment },
    capacity: { ...s.capacity },
    schedule: { ...s.schedule },
    refundOnReject: s.refundOnReject,
    pendingVisibility: s.pendingVisibility,
    notify: { ...s.notify },
    copy: { ...s.copy, steps: { ...s.copy.steps } },
  };
}

export function presetById(id: PaidAccessPresetId): PaidAccessPreset {
  const preset = PAID_ACCESS_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown Paid Access preset: ${id}`);
  return preset;
}

/** Switch `current` to a preset's steps, keeping every fine-tuned value. Pure. */
export function applyPreset(id: PaidAccessPresetId, current: PaidAccessSettings): PaidAccessSettings {
  const preset = presetById(id);
  const next = clone(current);
  const paid = preset.steps.includes("payment");
  const refundOnReject = !paid ? "none" : current.refundOnReject === "none" ? "manual" : current.refundOnReject;
  const questions =
    preset.steps.includes("form") && next.form.questions.length === 0 ? [{ ...DEFAULT_QUESTION }] : next.form.questions;
  return { ...next, steps: [...preset.steps], refundOnReject, form: { questions } };
}

/** A fresh preset with defaults (the price still has to be set for paid ones). */
export function presetSettings(id: PaidAccessPresetId): PaidAccessSettings {
  return applyPreset(id, OPEN_SETTINGS);
}

/** Which preset these settings are, or "custom" for any other step order. */
export function detectPreset(settings: Pick<PaidAccessSettings, "steps">): PaidAccessPresetId | "custom" {
  const key = settings.steps.join(">");
  return PAID_ACCESS_PRESETS.find((p) => p.steps.join(">") === key)?.id ?? "custom";
}

/**
 * What a round nobody has set up yet counts as: the default preset, members
 * only (fail closed). It has no price, so it never validates — joining stays
 * paused until an admin saves real settings (or explicitly picks Open).
 */
export const UNCONFIGURED_SETTINGS: PaidAccessSettings = presetSettings(DEFAULT_PRESET_ID);
