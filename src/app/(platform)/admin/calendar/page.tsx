import { requirePlatformUser } from "@/lib/auth/session";
import { getCalendarMonth } from "@/lib/admin/calendar-data";
import { CalendarView } from "@/components/admin/pages/CalendarView";

export const dynamic = "force-dynamic";

/** ?y=2026&m=8 (1-based month, as it reads in the URL) drives month nav. */
function resolveMonth(
  params: { y?: string; m?: string },
  now: Date,
): { year: number; month: number } {
  const year = Number.parseInt(params.y ?? "", 10);
  const month = Number.parseInt(params.m ?? "", 10);
  const valid =
    Number.isInteger(year) &&
    year >= 1970 &&
    year <= 9999 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12;
  return valid
    ? { year, month: month - 1 }
    : { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  await requirePlatformUser();

  const now = new Date();
  const { year, month } = resolveMonth(await searchParams, now);
  const data = await getCalendarMonth(year, month, now);

  return <CalendarView data={data} />;
}
