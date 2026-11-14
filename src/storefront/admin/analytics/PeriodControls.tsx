"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  COMPARE_LABELS,
  COMPARE_MODES,
  GRANULARITY_LABELS,
  PRESET_LABELS,
  type CompareMode,
  type Granularity,
  type PeriodPreset,
  type PeriodQuery,
  type ResolvedPeriod,
} from "@/lib/analytics/sales-period";

// The Sales Analytics toolbar: one date button (presets + custom dates in a
// popover), quick pills for the everyday ranges, the comparison picker and
// the day/week/month switch. State lives in AdminAnalytics; this only emits
// query patches.

const QUICK: PeriodPreset[] = ["today", "7d", "30d", "this_month", "90d", "12m"];
const QUICK_SHORT: Partial<Record<PeriodPreset, string>> = {
  today: "Today",
  "7d": "7D",
  "30d": "30D",
  this_month: "Month",
  "90d": "90D",
  "12m": "12M",
};
const MENU: PeriodPreset[] = [
  "today",
  "yesterday",
  "this_week",
  "7d",
  "30d",
  "this_month",
  "last_month",
  "90d",
  "this_year",
  "12m",
  "all",
];

export type PeriodPatch = Partial<PeriodQuery>;

type Props = {
  period: ResolvedPeriod;
  /** Store "today" as YYYY-MM-DD, the latest selectable date. */
  today: string;
  onChange: (patch: PeriodPatch) => void;
};

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function DatePopover({ period, today, onChange, onClose }: Props & { onClose: () => void }) {
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const valid = Boolean(from && to);
  const pick = (preset: PeriodPreset) => {
    onChange({ preset, from: null, to: null });
    onClose();
  };
  const apply = () => {
    if (!valid) return;
    onChange({ preset: "custom", from, to });
    onClose();
  };
  return (
    <div className="ana-pop" role="dialog" aria-label="Choose a date range">
      <ul className="ana-pop__presets" role="listbox" aria-label="Preset ranges">
        {MENU.map((p) => (
          <li key={p}>
            <button
              type="button"
              role="option"
              aria-selected={period.preset === p}
              className={`ana-pop__preset ${period.preset === p ? "is-active" : ""}`}
              onClick={() => pick(p)}
            >
              {PRESET_LABELS[p]}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="ana-pop__custom"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="ana-pop__heading">Custom range</div>
        <label className="ana-pop__field">
          <span>Start date</span>
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="ana-pop__field">
          <span>End date</span>
          <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <p className="ana-pop__hint">Dates follow the store&apos;s clock (Philippine time). Up to 3 years.</p>
        <div className="ana-pop__actions">
          <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="admin-btn" disabled={!valid}>
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

export function PeriodControls({ period, today, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const compareId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const comparing = period.prev !== null;

  return (
    <section className="ana-toolbar" aria-label="Report period">
      <div className="ana-toolbar__row">
        <div className="ana-date-wrap" ref={wrap}>
          <button
            type="button"
            className={`ana-date ${open ? "is-open" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <CalendarIcon />
            <span className="ana-date__text">
              <span className="ana-date__title">{period.title}</span>
              <span className="ana-date__range">{period.label}</span>
            </span>
            <svg className="ana-date__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {open && <DatePopover period={period} today={today} onChange={onChange} onClose={() => setOpen(false)} />}
        </div>

        <div className="admin-seg ana-quick" role="group" aria-label="Quick ranges">
          {QUICK.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period.preset === p}
              title={PRESET_LABELS[p]}
              className={`admin-seg__btn ${period.preset === p ? "is-active" : ""}`}
              onClick={() => onChange({ preset: p, from: null, to: null })}
            >
              {QUICK_SHORT[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="ana-toolbar__row ana-toolbar__row--sub">
        <label className="ana-compare" htmlFor={compareId}>
          <span>Compare with</span>
          <select
            id={compareId}
            value={period.preset === "all" ? "none" : period.compare}
            disabled={period.preset === "all"}
            onChange={(e) => onChange({ compare: e.target.value as CompareMode })}
          >
            {COMPARE_MODES.map((m) => (
              <option key={m} value={m}>
                {COMPARE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        {period.granularities.length > 1 && (
          <div className="ana-view">
            <span className="ana-view__label">View by</span>
            <div className="admin-seg ana-seg--sm" role="group" aria-label="View by">
              {period.granularities.map((g: Granularity) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={period.granularity === g}
                  className={`admin-seg__btn ${period.granularity === g ? "is-active" : ""}`}
                  onClick={() => onChange({ granularity: g })}
                >
                  {GRANULARITY_LABELS[g].unit[0].toUpperCase() + GRANULARITY_LABELS[g].unit.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="ana-toolbar__caption">
        {comparing ? (
          <>
            Comparing <strong>{period.label}</strong> with <strong>{period.prev!.label}</strong>
            {period.prev!.soFar ? " · up to the same point in time" : ""}
          </>
        ) : (
          <>Showing <strong>{period.label}</strong></>
        )}
        {" · cancelled orders excluded"}
      </p>
    </section>
  );
}
