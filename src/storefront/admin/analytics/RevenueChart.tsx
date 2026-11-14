"use client";

import { useState, type KeyboardEvent } from "react";
import type { SeriesPoint } from "@/lib/analytics/sales-period";
import { DeltaBadge } from "./DeltaBadge";

// Revenue bars (plain divs — no chart dependency). The comparison period sits
// behind each bar as a ghost so a glance shows "ahead or behind"; hovering,
// tapping or arrow-keying a column opens a tooltip with both figures.

type Props = {
  points: SeriesPoint[];
  comparing: boolean;
  unit: string;
  money: (n: number) => string;
  compact: (n: number) => string;
};

/** Every Nth x label, so 30 daily buckets don't collide. */
const MAX_X_LABELS = 8;

export function RevenueChart({ points, comparing, unit, money, compact }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => Math.max(p.revenue, comparing ? (p.prevRevenue ?? 0) : 0)), 0);
  const labelEvery = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const a = active !== null ? points[active] : null;

  if (!(max > 0)) return <div className="admin-analytics__empty">No sales in this period.</div>;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? (step > 0 ? -1 : points.length)) + step)));
  };
  const height = (v: number) => `${Math.max((v / max) * 100, v > 0 ? 2 : 0)}%`;
  // Keep the tooltip inside the plot: anchor left/right near the edges.
  const tipPos = active === null ? 0 : (active + 0.5) / points.length;
  const tipStyle = tipPos < 0.2 ? { left: 0 } : tipPos > 0.8 ? { right: 0 } : { left: `${tipPos * 100}%`, transform: "translateX(-50%)" };

  return (
    <div className="ana-chart">
      {comparing && (
        <div className="ana-legend" aria-hidden="true">
          <span className="ana-legend__item"><i className="ana-legend__swatch" /> This period</span>
          <span className="ana-legend__item"><i className="ana-legend__swatch ana-legend__swatch--prev" /> Compared period</span>
        </div>
      )}
      <div className="admin-chart">
        <div className="admin-chart__ylabels" aria-hidden="true">
          <span>{compact(max)}</span>
          <span>{compact(max / 2)}</span>
          <span>{compact(0)}</span>
        </div>
        <div
          className="admin-chart__plot ana-chart__plot"
          tabIndex={0}
          role="group"
          aria-label={`Revenue per ${unit}. Use the left and right arrow keys to read each ${unit}.`}
          onKeyDown={onKey}
          onMouseLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <div className="admin-chart__gridline" style={{ top: 0 }} />
          <div className="admin-chart__gridline" style={{ top: "50%" }} />
          <div className="admin-chart__bars">
            {points.map((p, i) => (
              <div
                key={p.key}
                className={`admin-chart__col ana-col ${active === i ? "is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}
              >
                {comparing && p.prevRevenue !== null && p.prevRevenue > 0 && (
                  <div className="ana-col__prev" style={{ height: height(p.prevRevenue) }} />
                )}
                {p.revenue > 0 && <div className="admin-chart__bar ana-col__bar" style={{ height: height(p.revenue) }} />}
              </div>
            ))}
          </div>
          {a && (
            <div className="ana-tip" style={tipStyle} role="status" aria-live="polite">
              <div className="ana-tip__label">{a.longLabel}</div>
              <div className="ana-tip__value">{money(a.revenue)}</div>
              <div className="ana-tip__meta">
                {a.orders.toLocaleString()} order{a.orders === 1 ? "" : "s"}
                {a.change !== null && (
                  <>
                    {" · "}
                    <DeltaBadge value={a.change} /> vs previous {unit}
                  </>
                )}
              </div>
              {comparing && a.prevRevenue !== null && (
                <div className="ana-tip__compare">
                  <span>{a.prevLongLabel}</span>
                  <span>
                    {money(a.prevRevenue)} <DeltaBadge value={a.compareChange} />
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="admin-chart__xrow" aria-hidden="true">
        {points.map((p, i) => (
          <div key={p.key} className="admin-chart__xlabel">
            {i % labelEvery === 0 ? p.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
