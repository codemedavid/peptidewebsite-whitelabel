/**
 * COPIED from src/storefront/admin/analytics/PeriodTable.tsx (downloadCsv /
 * csvCell) — the website's "Download CSV" of the period table, adapted to the
 * app's InsightsPoint (same fields, from the same sales-period engine). The app
 * can't import website code at runtime; keep the two in step.
 *
 * Cells are also formula-injection safe (=, +, -, @ get a leading quote), as
 * the website's customers CSV does.
 */
import type { InsightsGranularity, InsightsPoint } from "@contract";

const UNIT: Record<InsightsGranularity, string> = { hour: "hour", day: "day", week: "week", month: "month" };

export function csvCell(v: string | number | null | undefined): string {
  const raw = v === null || v === undefined ? "" : String(v);
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function periodTableCsv(points: readonly InsightsPoint[], granularity: InsightsGranularity, comparing: boolean): string {
  const unit = UNIT[granularity];
  const head = ["Period", "Revenue", "Orders", "Avg order", `Change vs previous ${unit} (%)`];
  if (comparing) head.push("Compared period", "Compared revenue", "Change vs compared (%)");
  const rows = points.map((p) => {
    const row: (string | number | null | undefined)[] = [
      p.longLabel,
      cents(p.revenue),
      p.orders,
      p.orders ? cents(p.revenue / p.orders) : 0,
      p.change,
    ];
    if (comparing) row.push(p.prevLongLabel, p.prevRevenue, p.compareChange);
    return row.map(csvCell).join(",");
  });
  return [head.map(csvCell).join(","), ...rows].join("\n");
}

/** `sales-<from>_to_<to>-by-<unit>.csv`, the website's file name. */
export function periodTableFileName(from: string, to: string, granularity: InsightsGranularity): string {
  return `sales-${from}_to_${to}-by-${UNIT[granularity]}.csv`;
}
