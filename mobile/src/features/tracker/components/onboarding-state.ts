/**
 * The "onboarding seen" mark rides on the synced settings record (the server
 * schema is .passthrough(), and the phone store spreads unknown keys through),
 * so finishing onboarding once covers every phone on the account. It is a
 * UI-only field, typed here rather than in lib/types.
 */
import { updateSettings } from "../hooks";
import type { TrackerSettings } from "../lib/types";

type WithOnboarding = TrackerSettings & {
  /** ISO time the user accepted the disclaimer in onboarding. */
  onboardedAt?: string | null;
};

export function isOnboarded(settings: TrackerSettings): boolean {
  const at = (settings as WithOnboarding).onboardedAt;
  return typeof at === "string" && at.length > 0;
}

export function markOnboarded(now: Date = new Date()): void {
  const patch: Partial<WithOnboarding> = { onboardedAt: now.toISOString() };
  updateSettings(patch);
}
