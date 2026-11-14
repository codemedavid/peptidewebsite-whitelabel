"use client";

import { useState } from "react";
import { GRANULARITY_LABELS, type Granularity, type SeriesPoint } from "@/lib/analytics/sales-period";
import { DeltaBadge } from "./DeltaBadge";

// "Day by day / Week by week / Month by month": every bucket of the window,
// newest first, with its change vs the bucket before it (DoD / WoW / MoM) and,
// when a comparison is on, vs the same bucket of the compared period.

const PREVIEW_ROWS = 10;

type Props = {
  points: SeriesPoint[];
  granularity: Granularity;
  comparing: boolean;
  best: number | null;
  money: (n: number) => string;
  fileName: string;
};

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(points: SeriesPoint[], comparing: boolean, unit: string, fileName: string): void {
  const head = ["Period", "Revenue", "Orders", "Avg order", `Change vs previous ${unit} (%)`];
  if (comparing) head.push("Compared period", "Compared revenue", "Change vs compared (%)");
  const rows = points.map((p) => {
    const row: Array<string | number | null> = [
      p.longLabel,
      Math.round(p.revenue * 100) / 100,
      p.orders,
      p.orders ? Math.round((p.revenue / p.orders) * 100) / 100 : 0,
      p.change,
    ];
    if (comparing) row.push(p.prevLongLabel, p.prevRevenue, p.compareChange);
    return row.map(csvCell).join(",");
  });
  const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function PeriodTable({ points, granularity, comparing, best, money, fileName }: Props) {
  const [expanded, setExpanded] = useState(false);
  const unit = GRANULARITY_LABELS[granularity].unit;
  const newestFirst = points.map((p, i) => ({ p, i })).reverse();
  const rows = expanded ? newestFirst : newestFirst.slice(0, PREVIEW_ROWS);
  const max = Math.max(...points.map((p) => p.revenue), 0);
  const title = `${unit[0].toUpperCase()}${unit.slice(1)} by ${unit}`;

  return (
    <div className="admin-card admin-analytics__card">
      <div className="ana-card-head">
        <div>
          <h2 className="admin-card__title">{title}</h2>
          <div className="ana-card-head__caption">
            Each {unit} compared with the {unit} before it{comparing ? " and with the compared period" : ""}
          </div>
        </div>
        <button type="button" className="admin-btn admin-btn--ghost ana-btn-sm" onClick={() => downloadCsv(points, comparing, unit, fileName)}>
          Download CSV
        </button>
      </div>

      <div className="ana-table-wrap">
        <table className="ana-table">
          <thead>
            <tr>
              <th scope="col">{unit[0].toUpperCase() + unit.slice(1)}</th>
              <th scope="col" className="num">Revenue</th>
              <th scope="col" className="num">Orders</th>
              <th scope="col" className="num ana-hide-sm">Avg order</th>
              <th scope="col" className="num">vs prev. {unit}</th>
              {comparing && <th scope="col" className="num ana-hide-sm">vs compared</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, i }) => (
              <tr key={p.key} className={p.revenue === 0 ? "is-empty" : undefined}>
                <th scope="row">
                  <span className="ana-table__period">{p.longLabel}</span>
                  {best === i && <span className="ana-best">Best</span>}
                </th>
                <td className="num">
                  <span className="ana-table__money">{money(p.revenue)}</span>
                  <span className="ana-table__bar" aria-hidden="true">
                    <span style={{ width: `${max > 0 ? (p.revenue / max) * 100 : 0}%` }} />
                  </span>
                </td>
                <td className="num">{p.orders.toLocaleString()}</td>
                <td className="num ana-hide-sm">{p.orders ? money(p.revenue / p.orders) : "—"}</td>
                <td className="num">
                  <DeltaBadge value={p.change} />
                </td>
                {comparing && (
                  <td className="num ana-hide-sm" title={p.prevLongLabel ? `${p.prevLongLabel}: ${money(p.prevRevenue ?? 0)}` : undefined}>
                    {p.prevRevenue === null ? "—" : <DeltaBadge value={p.compareChange} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {newestFirst.length > PREVIEW_ROWS && (
        <button type="button" className="ana-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Show fewer" : `Show all ${newestFirst.length} ${unit}s`}
        </button>
      )}
    </div>
  );
}
