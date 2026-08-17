"use client";

/**
 * The Super Admin calendar. One month grid carrying two kinds of thing:
 *
 *   - tenant due dates, derived live from each tenant's subscription window
 *     (read-only here — the window is edited on the tenant detail page)
 *   - the operator's own entries, which can be filed against a platform tenant,
 *     against an off-platform client by name, or against nobody at all
 *
 * Month nav goes through the URL (?y=&m=) so a month is linkable and the back
 * button works. Writes go through the admin-calendar actions and then
 * router.refresh(), matching TenantDetailView's useTransition + toast idiom.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import {
  CALENDAR_ENTRY_KINDS,
  CALENDAR_ENTRY_KIND_LABELS,
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

function peso(cents?: number): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return `₱${Math.round(cents / 100).toLocaleString("en-PH")}`;
}

/** Urgency -> the .sa badge tone, so chips read like the rest of the console. */
const TONE: Record<CalendarEvent["urgency"], string> = {
  overdue: "badge-danger",
  due_soon: "badge-warn",
  scheduled: "badge-neutral",
};

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

export function CalendarView({ data }: { data: CalendarMonthData }) {
  const router = useRouter();
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();

  const [selectedDay, setSelectedDay] = useState<string>(data.todayIso);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const { grid, eventsByDay, tenantOptions, entriesAvailable } = data;

  const prev = shiftMonth(grid.year, grid.month, -1);
  const next = shiftMonth(grid.year, grid.month, 1);
  const monthHref = (m: { year: number; month: number }) => `/calendar?y=${m.year}&m=${m.month + 1}`;

  const selectedEvents = eventsByDay[selectedDay] ?? [];

  const monthTotals = useMemo(() => {
    const all = Object.values(eventsByDay).flat();
    return {
      due: all.filter((e) => e.kind === "renewal" && !e.projected).length,
      overdue: all.filter((e) => e.urgency === "overdue").length,
      entries: all.filter((e) => e.kind === "manual").length,
    };
  }, [eventsByDay]);

  function run(action: () => Promise<{ ok: true } | { error: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        showToast(result.error);
        return;
      }
      showToast(success);
      setDraft(null);
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
      () =>
        draft.id ? updateCalendarEventAction(draft.id, input) : createCalendarEventAction(input),
      draft.id ? "Entry updated" : "Entry added",
    );
  }

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">
            Every tenant&rsquo;s subscription due date, plus your own schedule — in one month view
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

      {!entriesAvailable && (
        <div className="card mb-4">
          <div className="card-body" style={{ padding: 12, color: "var(--ink-500)" }}>
            Tenant due dates below are live. Your own entries need the
            <span className="mono"> platform_calendar_events </span> table — run
            <span className="mono"> npm run db:push </span> to switch them on.
          </div>
        </div>
      )}

      <div className="cal-layout">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">{grid.label}</h3>
              <div className="card-sub">
                {monthTotals.due} due · {monthTotals.overdue} overdue · {monthTotals.entries} entries
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
            <div className="cal-grid" role="grid" aria-label={`${grid.label} calendar`}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="cal-weekday" role="columnheader">
                  {label}
                </div>
              ))}

              {grid.cells.map((cell) => {
                const dayEvents = eventsByDay[cell.day] ?? [];
                const classes = [
                  "cal-day",
                  cell.inMonth ? "" : "cal-day-muted",
                  cell.isToday ? "cal-day-today" : "",
                  cell.day === selectedDay ? "cal-day-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <button
                    type="button"
                    key={cell.day}
                    className={classes}
                    role="gridcell"
                    aria-label={`${cell.day}, ${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}`}
                    aria-selected={cell.day === selectedDay}
                    onClick={() => setSelectedDay(cell.day)}
                    onDoubleClick={() => entriesAvailable && setDraft(emptyDraft(cell.day))}
                  >
                    <span className="cal-daynum">{cell.dayOfMonth}</span>
                    <span className="cal-chips">
                      {dayEvents.slice(0, 3).map((event) => (
                        <span
                          key={event.id}
                          className={`cal-chip ${TONE[event.urgency]}${event.projected ? " cal-chip-projected" : ""}${event.done ? " cal-chip-done" : ""}`}
                        >
                          {event.title}
                        </span>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="cal-more">+{dayEvents.length - 3} more</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">{selectedDay}</h3>
              <div className="card-sub">
                {selectedEvents.length === 0
                  ? "Nothing scheduled"
                  : `${selectedEvents.length} item${selectedEvents.length === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>

          <div className="card-body" style={{ padding: 12 }}>
            {selectedEvents.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Pick another day, or add an entry for this one.
              </p>
            )}

            {selectedEvents.map((event) => (
              <div key={event.id} className="cal-item">
                <div className="cal-item-main">
                  <div className="cal-item-title">
                    <span className={`badge ${TONE[event.urgency]}`}>
                      {event.kind === "renewal"
                        ? event.projected
                          ? "Projected"
                          : "Due"
                        : event.kind === "trial_end"
                          ? "Trial"
                          : CALENDAR_ENTRY_KIND_LABELS[
                              (event.entryKind ?? "note") as CalendarEntryKind
                            ]}
                    </span>
                    <strong className={event.done ? "cal-strike" : undefined}>{event.title}</strong>
                  </div>
                  {event.subtitle && <div className="cal-item-sub">{event.subtitle}</div>}
                  {event.notes && <div className="cal-item-sub">{event.notes}</div>}
                  {event.amountCents != null && event.kind === "renewal" && (
                    <div className="cal-item-sub mono">{peso(event.amountCents)}</div>
                  )}
                </div>

                <div className="cal-item-actions">
                  {event.kind === "renewal" && event.tenantSlug && (
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
