"use server";

// Super Admin actions for the operator's own calendar entries — the hand-added
// half of /admin/calendar. Tenant due dates are derived live from the tenant
// window and are NOT editable here; these actions only touch the operator's
// schedule (meetings, follow-ups, reminders), whether filed against a platform
// tenant or against a client who isn't on the whitelabel at all.
//
// Operator-gated. Validation lives in the pure core (normalizeCalendarEventInput,
// npm run test:calendar) so the boundary rules are testable without a DB.

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { normalizeCalendarEventInput, type CalendarEventInput } from "@/lib/admin/calendar-core";

export type CalendarActionResult = { ok: true } | { error: string };

/** Shown when the table hasn't been created yet — same idiom as admin-upgrades. */
const NOT_PUSHED =
  "Could not save — has the platform_calendar_events table been pushed? (npm run db:push)";

const DEMO_BLOCKED = "Calendar entries aren't supported in demo mode.";

function bust() {
  revalidatePath("/admin/calendar");
  revalidateTag("admin:data");
}

export async function createCalendarEventAction(
  input: CalendarEventInput,
): Promise<CalendarActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: DEMO_BLOCKED };

  const parsed = normalizeCalendarEventInput(input);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await prisma.platformCalendarEvent.create({ data: parsed.value });
  } catch {
    return { error: NOT_PUSHED };
  }

  bust();
  return { ok: true };
}

export async function updateCalendarEventAction(
  id: string,
  input: CalendarEventInput,
): Promise<CalendarActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: DEMO_BLOCKED };

  const entryId = id.trim();
  if (!entryId) return { error: "Missing the entry to update." };

  const parsed = normalizeCalendarEventInput(input);
  if (!parsed.ok) return { error: parsed.error };

  try {
    // updateMany, not update: a vanished row becomes count 0 rather than a
    // thrown P2025 we'd have to tell apart from a missing table.
    const { count } = await prisma.platformCalendarEvent.updateMany({
      where: { id: entryId },
      data: parsed.value,
    });
    if (count === 0) return { error: "That entry no longer exists." };
  } catch {
    return { error: NOT_PUSHED };
  }

  bust();
  return { ok: true };
}

export async function deleteCalendarEventAction(id: string): Promise<CalendarActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: DEMO_BLOCKED };

  const entryId = id.trim();
  if (!entryId) return { error: "Missing the entry to delete." };

  try {
    await prisma.platformCalendarEvent.deleteMany({ where: { id: entryId } });
  } catch {
    return { error: NOT_PUSHED };
  }

  bust();
  return { ok: true };
}

/** Tick an entry off (or un-tick it). `done` is the state being moved TO. */
export async function toggleCalendarEventDoneAction(
  id: string,
  done: boolean,
): Promise<CalendarActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: DEMO_BLOCKED };

  const entryId = id.trim();
  if (!entryId) return { error: "Missing the entry to update." };

  try {
    const { count } = await prisma.platformCalendarEvent.updateMany({
      where: { id: entryId },
      data: { doneAt: done ? new Date() : null },
    });
    if (count === 0) return { error: "That entry no longer exists." };
  } catch {
    return { error: NOT_PUSHED };
  }

  bust();
  return { ok: true };
}
