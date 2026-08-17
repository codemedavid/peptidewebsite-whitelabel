"use client";

/**
 * The Super Admin calendar. One month grid carrying three kinds of thing:
 *
 *   - tenant due dates, derived live from each tenant's subscription window;
 *   - settled terms — a due date the operator has ticked off as paid, which
 *     rolls that tenant's window forward and lands in My Income;
 *   - the operator's own entries, filed against a platform tenant, against an
 *     off-platform client by name, or against nobody at all.
 *
 * The page leads with the money question it exists to answer — expected this
 * month vs actually received — because that is what the operator opens it for.
 * The year strip below it makes every month of the year one click away.
 *
 * Month/year nav goes through the URL (?y=&m=) so a month is linkable and the
 * back button works. Writes go through the admin-calendar actions and then
 * router.refresh(), matching TenantDetailView's useTransition + toast idiom.
 */

import { useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import {
  CALENDAR_ENTRY_KINDS,
  CALENDAR_ENTRY_KIND_LABELS,
  MONTH_SHORT_LABELS,
  WEEKDAY_LABELS,
  shiftMonth,
  type CalendarEntryKind,
  type CalendarEvent,
} from "@/lib/admin/calendar-core";
import type { CalendarMonthData } from "@/lib/admin/calendar-data";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  toggleCalendarEventDoneAction,
  updateCalendarEventAction,
} from "@/actions/admin-calendar";
import {
  markSubscriptionPaidAction,
  undoSubscriptionPaidAction,
} from "@/actions/admin-calendar-payments";
import {
  CalendarMarkPaidDrawer,
  type MarkPaidTarget,
  type MarkPaidValues,
} from "./CalendarMarkPaidDrawer";

/** Whole pesos — the calendar never needs centavo precision. */
function peso(cents?: number): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `₱${Math.round(cents / 100).toLocaleString("en-PH")}`;
}

/** Compact money for a day chip, where horizontal room is scarce. */
function pesoShort(cents?: number): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  const pesos = Math.round(cents / 100);
  return pesos >= 10_000 ? `₱${(pesos / 1000).toFixed(1)}k` : `₱${pesos.toLocaleString("en-PH")}`;
}

/** Urgency -> the .sa badge tone, so chips read like the rest of the console. */
const TONE: Record<CalendarEvent["urgency"], string> = {
  overdue: "badge-danger",
  due_soon: "badge-warn",
  scheduled: "badge-neutral",
};

/** The chip's colour band. Paid outranks urgency — it's a settled fact. */
function chipTone(event: CalendarEvent): string {
  if (event.paid) return "cal-chip-paid";
  if (event.kind === "manual") return "cal-chip-entry";
  if (event.urgency === "overdue") return "cal-chip-overdue";
  if (event.urgency === "due_soon") return "cal-chip-soon";
  return "cal-chip-sched";
}

/** The short label on a day-panel row. */
function eventLabel(event: CalendarEvent): string {
  if (event.paid) return "Paid";
  if (event.kind === "renewal") return event.projected ? "Projected" : "Due";
  if (event.kind === "trial_end") return "Trial";
  return CALENDAR_ENTRY_KIND_LABELS[(event.entryKind ?? "note") as CalendarEntryKind];
}

/** "2026-08-21" -> "Fri, 21 Aug". UTC, matching how the grid buckets days. */
function readableDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

type DraftState = {
  id: string | null;
  day: string;
  title: string;
  notes: string;
  kind: CalendarEntryKind;
  tenantId: string;
  clientLabel: string;
};

function emptyDraft(day: string): DraftState {
  return { id: null, day, title: "", notes: "", kind: "note", tenantId: "", clientLabel: "" };
}

/** How many chips fit in a day square before we collapse to "+N more". */
const CHIPS_PER_DAY = 3;

export function CalendarView({ data }: { data: CalendarMonthData }) {
  const router = useRouter();
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();

  const [selectedDay, setSelectedDay] = useState<string>(data.todayIso);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [payTarget, setPayTarget] = useState<MarkPaidTarget | null>(null);

  const { grid, eventsByDay, tenantOptions, entriesAvailable, paidAvailable } = data;

  const prev = shiftMonth(grid.year, grid.month, -1);
  const next = shiftMonth(grid.year, grid.month, 1);
  const monthHref = (m: { year: number; month: number }) => `/calendar?y=${m.year}&m=${m.month + 1}`;

  const selectedEvents = eventsByDay[selectedDay] ?? [];

  const totals = useMemo(() => {
    const all = Object.values(eventsByDay).flat();
    return {
      due: all.filter((e) => e.kind === "renewal" && !e.projected).length,
      overdue: all.filter((e) => e.urgency === "overdue").length,
      paid: all.filter((e) => e.paid).length,
      entries: all.filter((e) => e.kind === "manual").length,
    };
  }, [eventsByDay]);

  const collectedPct =
    data.expectedCents > 0
      ? Math.min(100, Math.round((data.collectedCents / data.expectedCents) * 100))
      : 0;
  const outstandingCents = Math.max(0, data.expectedCents - data.collectedCents);

  function run(action: () => Promise<{ ok: true } | { error: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        showToast(result.error);
        return;
      }
      showToast(success);
      setDraft(null);
      setPayTarget(null);
      router.refresh();
    });
  }

  function save() {
    if (!draft) return;
    const input = {
      title: draft.title,
      notes: draft.notes,
      day: draft.day,
      kind: draft.kind,
      tenantId: draft.tenantId || null,
      clientLabel: draft.clientLabel || null,
    };
    run(
      () => (draft.id ? updateCalendarEventAction(draft.id, input) : createCalendarEventAction(input)),
      draft.id ? "Entry updated" : "Entry added",
    );
  }

  function markPaid(values: MarkPaidValues) {
    if (!payTarget) return;
    const target = payTarget;
    run(
      () =>
        markSubscriptionPaidAction({
          tenantId: target.tenantId,
          dueDay: target.dueDay,
          ...values,
        }),
      `${target.tenantName} marked paid`,
    );
  }

  /** Arrow keys walk the grid a day/week at a time, like a native date picker. */
  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : 0;
    if (step === 0) return;
    const index = grid.cells.findIndex((cell) => cell.day === selectedDay);
    const target = grid.cells[index + step];
    if (index < 0 || !target) return;
    event.preventDefault();
    setSelectedDay(target.day);
  }

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">
            Every tenant&rsquo;s subscription due date, what you&rsquo;ve collected, and your own
            schedule — in one month view
          </p>
        </div>
        <div className="page-actions">
          <a className="btn btn-ghost btn-sm" href="/calendar">
            Today
          </a>
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={() => setDraft(emptyDraft(selectedDay))}
            disabled={!entriesAvailable}
            title={entriesAvailable ? undefined : "Run npm run db:push to enable entries"}
          >
            <Ic.Plus /> Add entry
          </button>
        </div>
      </div>

      {/* The money question first — expected vs actually received this month. */}
      <section className="cal-money" aria-label={`Subscription income for ${grid.label}`}>
        <div className="cal-money-main">
          <div className="cal-money-label">Received in {grid.label}</div>
          <div className="cal-money-value">{peso(data.collectedCents)}</div>
          <div className="cal-meter" role="img" aria-label={`${collectedPct}% of expected collected`}>
            <span className="cal-meter-fill" style={{ width: `${collectedPct}%` }} />
          </div>
          <div className="cal-money-foot">
            <span className="cal-dot cal-dot-paid" /> {collectedPct}% of {peso(data.expectedCents)}{" "}
            expected
          </div>
        </div>

        <div className="cal-money-side">
          <div className="cal-stat">
            <div className="cal-stat-label">Expected</div>
            <div className="cal-stat-value">{peso(data.expectedCents)}</div>
            <div className="cal-stat-foot">{totals.due + totals.paid} due dates this month</div>
          </div>
          <div className="cal-stat">
            <div className="cal-stat-label">Still to collect</div>
            <div className={`cal-stat-value${outstandingCents > 0 ? " cal-stat-open" : ""}`}>
              {peso(outstandingCents)}
            </div>
            <div className="cal-stat-foot">{totals.due} still unpaid</div>
          </div>
          <div className="cal-stat">
            <div className="cal-stat-label">Overdue</div>
            <div className={`cal-stat-value${totals.overdue > 0 ? " cal-stat-bad" : ""}`}>
              {totals.overdue}
            </div>
            <div className="cal-stat-foot">
              {totals.paid} settled · {totals.entries} entries
            </div>
          </div>
        </div>
      </section>

      {!entriesAvailable && (
        <div className="cal-note">
          Tenant due dates below are live. Your own entries need the
          <span className="mono"> platform_calendar_events </span> table — run
          <span className="mono"> npm run db:push </span> to switch them on.
        </div>
      )}

      {/* The whole year, one click per month. */}
      <nav className="cal-year" aria-label="Jump to a month">
        <a
          className="cal-year-nav"
          href={monthHref({ year: grid.year - 1, month: grid.month })}
          aria-label={`Go to ${grid.year - 1}`}
        >
          <Ic.ChevronLeft />
        </a>
        <span className="cal-year-num">{grid.year}</span>
        <div className="cal-year-months">
          {MONTH_SHORT_LABELS.map((label, index) => (
            <a
              key={label}
              className={`cal-month-pill${index === grid.month ? " is-active" : ""}`}
              href={monthHref({ year: grid.year, month: index })}
              aria-current={index === grid.month ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </div>
        <a
          className="cal-year-nav"
          href={monthHref({ year: grid.year + 1, month: grid.month })}
          aria-label={`Go to ${grid.year + 1}`}
        >
          <Ic.ChevronRight />
        </a>
      </nav>

      <div className="cal-layout">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">{grid.label}</h3>
              <div className="card-sub">
                {totals.due} due · {totals.overdue} overdue · {totals.paid} paid · {totals.entries}{" "}
                entries
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <a className="btn btn-ghost btn-sm" href={monthHref(prev)} aria-label="Previous month">
                <Ic.ChevronLeft />
              </a>
              <a className="btn btn-ghost btn-sm" href={monthHref(next)} aria-label="Next month">
                <Ic.ChevronRight />
              </a>
            </div>
          </div>

          <div className="card-body" style={{ padding: 12 }}>
            <div
              className="cal-grid"
              role="grid"
              aria-label={`${grid.label} calendar`}
              onKeyDown={onGridKeyDown}
            >
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="cal-weekday" role="columnheader">
                  {label}
                </div>
              ))}

              {grid.cells.map((cell, index) => {
                const dayEvents = eventsByDay[cell.day] ?? [];
                const isSelected = cell.day === selectedDay;
                const isWeekend = index % 7 === 0 || index % 7 === 6;
                const classes = [
                  "cal-day",
                  cell.inMonth ? "" : "cal-day-muted",
                  isWeekend ? "cal-day-weekend" : "",
                  cell.isToday ? "cal-day-today" : "",
                  isSelected ? "cal-day-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <button
                    type="button"
                    key={cell.day}
                    className={classes}
                    role="gridcell"
                    // Roving tabindex: one tab stop for the grid, arrows move within it.
                    tabIndex={isSelected ? 0 : -1}
                    aria-label={`${cell.day}, ${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}`}
                    aria-selected={isSelected}
                    onClick={() => setSelectedDay(cell.day)}
                    onDoubleClick={() => entriesAvailable && setDraft(emptyDraft(cell.day))}
                  >
                    <span className="cal-daynum">{cell.dayOfMonth}</span>
                    <span className="cal-chips">
                      {dayEvents.slice(0, CHIPS_PER_DAY).map((event) => (
                        <span
                          key={event.id}
                          className={`cal-chip ${chipTone(event)}${event.projected ? " cal-chip-projected" : ""}${event.done ? " cal-chip-done" : ""}`}
                        >
                          <span className="cal-chip-name">{event.title}</span>
                          {event.amountCents != null && event.kind !== "manual" && (
                            <span className="cal-chip-amt">{pesoShort(event.amountCents)}</span>
                          )}
                        </span>
                      ))}
                      {dayEvents.length > CHIPS_PER_DAY && (
                        <span className="cal-more">+{dayEvents.length - CHIPS_PER_DAY} more</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="cal-legend">
              <span>
                <span className="cal-dot cal-dot-overdue" /> Overdue
              </span>
              <span>
                <span className="cal-dot cal-dot-soon" /> Due soon
              </span>
              <span>
                <span className="cal-dot cal-dot-sched" /> Scheduled
              </span>
              <span>
                <span className="cal-dot cal-dot-paid" /> Paid
              </span>
              <span>
                <span className="cal-dot cal-dot-entry" /> Your entry
              </span>
            </div>
          </div>
        </div>

        <div className="card cal-side">
          <div className="card-head">
            <div>
              <h3 className="card-title">{readableDay(selectedDay)}</h3>
              <div className="card-sub">
                {selectedEvents.length === 0
                  ? "Nothing scheduled"
                  : `${selectedEvents.length} item${selectedEvents.length === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>

          <div className="card-body" style={{ padding: 12 }}>
            {selectedEvents.length === 0 && (
              <div className="cal-empty">
                <Ic.Calendar />
                <p>Nothing on this day.</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!entriesAvailable}
                  onClick={() => setDraft(emptyDraft(selectedDay))}
                >
                  Add an entry
                </button>
              </div>
            )}

            {selectedEvents.map((event) => (
              <div key={event.id} className={`cal-item${event.paid ? " cal-item-paid" : ""}`}>
                <div className="cal-item-main">
                  <div className="cal-item-title">
                    <span className={`badge ${event.paid ? "badge-success" : TONE[event.urgency]}`}>
                      {eventLabel(event)}
                    </span>
                    <strong className={event.done ? "cal-strike" : undefined}>{event.title}</strong>
                  </div>
                  {event.subtitle && <div className="cal-item-sub">{event.subtitle}</div>}
                  {event.notes && <div className="cal-item-sub">{event.notes}</div>}
                  {event.paid && event.paidDay && event.paidDay !== event.day && (
                    <div className="cal-item-sub">Received {readableDay(event.paidDay)}</div>
                  )}
                  {event.amountCents != null && event.kind !== "manual" && (
                    <div className="cal-item-amt">{peso(event.amountCents)}</div>
                  )}
                </div>

                <div className="cal-item-actions">
                  {event.kind === "renewal" && event.tenantId && paidAvailable && (
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      disabled={pending}
                      onClick={() =>
                        setPayTarget({
                          tenantId: event.tenantId as string,
                          tenantName: event.title,
                          dueDay: event.day,
                          amountCents: event.amountCents,
                          cycle: event.cycle,
                        })
                      }
                    >
                      Mark paid
                    </button>
                  )}
                  {event.paid && event.settlementId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => undoSubscriptionPaidAction(event.settlementId as string),
                          "Payment undone",
                        )
                      }
                    >
                      Undo
                    </button>
                  )}
                  {event.tenantSlug && (
                    <a className="btn btn-ghost btn-sm" href={`/tenants/${event.tenantSlug}`}>
                      Open
                    </a>
                  )}
                  {event.kind === "manual" && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => toggleCalendarEventDoneAction(event.id, !event.done),
                            event.done ? "Reopened" : "Marked done",
                          )
                        }
                      >
                        {event.done ? "Reopen" : "Done"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() =>
                          setDraft({
                            id: event.id,
                            day: event.day,
                            title: event.title,
                            notes: event.notes ?? "",
                            kind: (event.entryKind ?? "note") as CalendarEntryKind,
                            tenantId: event.tenantId ?? "",
                            clientLabel: event.tenantId ? "" : (event.subtitle ?? ""),
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() => run(() => deleteCalendarEventAction(event.id), "Entry deleted")}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {payTarget && (
        <CalendarMarkPaidDrawer
          target={payTarget}
          todayIso={data.todayIso}
          pending={pending}
          onCancel={() => setPayTarget(null)}
          onSave={markPaid}
        />
      )}

      {draft && (
        <>
          <div className="sa-drawer-backdrop" onClick={() => setDraft(null)} />
          <div className="sa-drawer" role="dialog" aria-modal="true" aria-label="Calendar entry">
            <div className="drawer-head">
              <div>
                <div className="drawer-title">{draft.id ? "Edit entry" : "New entry"}</div>
                <div className="drawer-sub">Your own schedule — not visible to tenants</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setDraft(null)}>
                <Ic.X />
              </button>
            </div>

            <div className="drawer-body">
              <label className="field-label" htmlFor="cal-title">
                Title
              </label>
              <input
                id="cal-title"
                className="input mb-3"
                value={draft.title}
                autoFocus
                placeholder="Follow up on payment"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />

              <label className="field-label" htmlFor="cal-day">
                Date
              </label>
              <input
                id="cal-day"
                type="date"
                className="input mb-3"
                value={draft.day}
                onChange={(e) => setDraft({ ...draft, day: e.target.value })}
              />

              <label className="field-label" htmlFor="cal-kind">
                Kind
              </label>
              <select
                id="cal-kind"
                className="input mb-3"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as CalendarEntryKind })}
              >
                {CALENDAR_ENTRY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CALENDAR_ENTRY_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>

              <label className="field-label" htmlFor="cal-tenant">
                Tenant
              </label>
              <select
                id="cal-tenant"
                className="input"
                value={draft.tenantId}
                onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })}
              >
                <option value="">Not a platform tenant</option>
                {tenantOptions.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <div className="field-hint mb-3">
                Leave this unset for someone who isn&rsquo;t on the whitelabel, then name them below.
              </div>

              {!draft.tenantId && (
                <>
                  <label className="field-label" htmlFor="cal-client">
                    Client name
                  </label>
                  <input
                    id="cal-client"
                    className="input mb-3"
                    value={draft.clientLabel}
                    placeholder="Walk-in client — Cebu"
                    onChange={(e) => setDraft({ ...draft, clientLabel: e.target.value })}
                  />
                </>
              )}

              <label className="field-label" htmlFor="cal-notes">
                Notes
              </label>
              <textarea
                id="cal-notes"
                className="input"
                rows={4}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>

            <div className="drawer-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-accent" disabled={pending} onClick={save}>
                {pending ? "Saving…" : draft.id ? "Save changes" : "Add entry"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
