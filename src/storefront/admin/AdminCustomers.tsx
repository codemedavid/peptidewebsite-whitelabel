"use client";

// Store-admin "Customers": everyone who created an account on this storefront.
// With the Orders grant the page leads with analytics (CustomersInsights: KPIs
// per period, revenue from accounts, segments, Top spenders, concentration,
// needs-attention) and the table carries each account's orders and spend;
// without it, only the account list and its tools remain.
//
// Row tools: Order history (the customer profile), Edit (name / email /
// phone), and a ⋯ menu with Reset password (a one-time temp password the owner
// passes on; signs them out everywhere), Disable / Re-enable, and Delete
// (personal data purged, orders kept but unlinked — the app's own purge).
// Export CSV downloads the filtered table, formula-injection safe.
// Staff need the "customers" permission; the server re-checks every action.

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { formatMoney } from "@/lib/storefront/currency";
import {
  CUSTOMER_FILTERS,
  FILTER_ORDER,
  PERIODS,
  SEGMENT_LABELS,
  VIP_SPEND,
  buildAccountStats,
  countByFilter,
  customersCsv,
  filterCustomers,
  type AccountStats,
  type CustomerFilter,
  type CustomerPeriod,
  type LedgerEntry,
} from "@/lib/storefront/customer-analytics";
import {
  deleteStoreCustomerAction,
  listStoreCustomersAction,
  resetStoreCustomerPasswordAction,
  setStoreCustomerStatusAction,
  updateStoreCustomerAction,
  type StoreCustomerRow,
} from "@/actions/customer-accounts";
import { customerInitials } from "./AdminCustomerProfile";
import { CustomersInsights, avatarTint, shortDate } from "./CustomersInsights";
import { AdminMemberSignIn } from "./AdminMemberSignIn";
import "./customer-profile.css";
import "./customers.css";

const TABLE_COLUMNS = 8;
const THOUSAND = 1000;

type CustomerDraft = Pick<StoreCustomerRow, "name" | "email" | "phone">;

interface CustomerEditFormProps {
  customer: StoreCustomerRow;
  busy: boolean;
  onSave: (draft: CustomerDraft) => void;
  onCancel: () => void;
}

/** Inline editor that opens under a customer's row. */
function CustomerEditForm({ customer, busy, onSave, onCancel }: CustomerEditFormProps) {
  const [draft, setDraft] = useState<CustomerDraft>({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  });
  const set = (key: keyof CustomerDraft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <form
      className="cust-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`cust-name-${customer.id}`}>Name</label>
        <input id={`cust-name-${customer.id}`} className="admin-input" value={draft.name} onChange={set("name")} autoFocus />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`cust-email-${customer.id}`}>Email</label>
        <input id={`cust-email-${customer.id}`} className="admin-input" type="email" value={draft.email} onChange={set("email")} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`cust-phone-${customer.id}`}>Phone</label>
        <input id={`cust-phone-${customer.id}`} className="admin-input" type="tel" value={draft.phone} onChange={set("phone")} />
      </div>
      <p className="admin-field__hint">
        Changing the email changes what they sign in with. Their password stays the same.
      </p>
      <div className="cust-edit__actions">
        <button type="button" className="admin-btn admin-btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="admin-btn" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

interface RowMenuProps {
  customer: StoreCustomerRow;
  busy: boolean;
  onReset: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

/** The ⋯ menu: the rarer, heavier account tools. */
function RowMenu({ customer: c, busy, onReset, onToggle, onDelete }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div
      className="cx-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="cx-icon-btn"
        aria-label={`More actions for ${c.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className="cx-menu__list" role="menu" aria-label={`Actions for ${c.name}`}>
          {/* An email-only entry has no password; setting one would silently make it an account. */}
          {c.status === "active" && !c.emailOnly && (
            <button type="button" role="menuitem" onClick={pick(onReset)}>
              Reset password
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(onToggle)}>
            {c.status === "active" ? "Disable account" : "Re-enable account"}
          </button>
          <button type="button" role="menuitem" data-danger="true" onClick={pick(onDelete)}>
            Delete account
          </button>
        </div>
      )}
    </div>
  );
}

function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface AdminCustomersProps {
  brand: Brand;
  onBack: () => void;
  /** Opens the account's order history; absent without the Orders grant. */
  onOpenProfile?: (id: string) => void;
  /** Promo Codes, when this store and actor have it. */
  onOpenPromo?: () => void;
}

export function AdminCustomers({ brand, onBack, onOpenProfile, onOpenPromo }: AdminCustomersProps) {
  const { toast } = useStore();
  const [rows, setRows] = useState<StoreCustomerRow[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [period, setPeriod] = useState<CustomerPeriod>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The temp password just issued — shown once, on that customer's row. */
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null);
  /** The customer whose inline edit form is open. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const tableRef = useRef<HTMLElement>(null);
  const [now] = useState(() => new Date());

  const money = useCallback(
    (n: number) => formatMoney(Math.round(n), brand.currency, { decimals: false }),
    [brand.currency],
  );
  const moneyShort = useCallback(
    (n: number) =>
      n >= THOUSAND
        ? `${formatMoney(0, brand.currency, { decimals: false }).replace(/[\d.,\s]/g, "")}${(n / THOUSAND).toFixed(1).replace(/\.0$/, "")}k`
        : money(n),
    [brand.currency, money],
  );

  useEffect(() => {
    let cancelled = false;
    listStoreCustomersAction()
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          toast(res.error);
          setRows([]);
        } else {
          setRows(res.customers);
          setLedger(res.ledger);
        }
      })
      .catch(() => {
        if (cancelled) return;
        toast("Couldn't load customers.");
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
    // Load once on open; `toast` is not a stable reference in the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accounts = useMemo(() => rows ?? [], [rows]);
  const stats = useMemo<Map<string, AccountStats>>(
    () => buildAccountStats(accounts, ledger ?? [], now),
    [accounts, ledger, now],
  );
  const hasLedger = ledger !== null;
  const counts = useMemo(() => countByFilter(accounts, stats), [accounts, stats]);
  const visible = useMemo(
    () => filterCustomers(accounts, stats, filter, query),
    [accounts, stats, filter, query],
  );
  // Empty tabs are noise: keep All and whatever is selected, hide the rest at 0.
  const filters = FILTER_ORDER.filter(
    (f) => (hasLedger || !CUSTOMER_FILTERS[f].needsLedger) && (f === "all" || f === filter || counts[f] > 0),
  );

  const showFilter = (f: CustomerFilter) => {
    setFilter(f);
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const exportCsv = () => {
    if (visible.length === 0) {
      toast("Nothing to export with this filter.");
      return;
    }
    const stamp = now.toISOString().slice(0, 10);
    downloadCsv(`customers-${filter}-${stamp}.csv`, customersCsv(visible, hasLedger ? stats : null));
    toast(`Exported ${visible.length} customer${visible.length === 1 ? "" : "s"}`);
  };

  const toggle = async (c: StoreCustomerRow) => {
    if (busyId) return;
    const next = c.status === "active" ? "disabled" : "active";
    if (
      next === "disabled" &&
      !window.confirm(`Disable ${c.name}'s account? They'll be signed out and can't sign in until you re-enable it.`)
    ) {
      return;
    }
    setBusyId(c.id);
    try {
      const res = await setStoreCustomerStatusAction(c.id, next);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setRows((prev) => (prev ?? []).map((r) => (r.id === c.id ? { ...r, status: next } : r)));
      toast(next === "disabled" ? "Account disabled" : "Account re-enabled");
    } catch {
      toast("Couldn't update the customer.");
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (c: StoreCustomerRow) => {
    if (busyId) return;
    if (
      !window.confirm(
        `Reset ${c.name}'s password? You'll get a temporary password to send them, and they'll be signed out on every device.`,
      )
    ) {
      return;
    }
    setBusyId(c.id);
    try {
      const res = await resetStoreCustomerPasswordAction(c.id);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setIssued({ id: c.id, password: res.tempPassword });
    } catch {
      toast("Couldn't reset the password.");
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (c: StoreCustomerRow, draft: CustomerDraft) => {
    if (busyId) return;
    setBusyId(c.id);
    try {
      const res = await updateStoreCustomerAction(c.id, draft);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setRows((prev) => (prev ?? []).map((r) => (r.id === c.id ? { ...r, ...res.customer } : r)));
      setEditingId(null);
      toast("Customer updated");
    } catch {
      toast("Couldn't save the customer.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: StoreCustomerRow) => {
    if (busyId) return;
    const orders =
      c.orderCount > 0
        ? ` Their ${c.orderCount} order${c.orderCount === 1 ? "" : "s"} stay in your Orders, no longer linked to an account.`
        : "";
    if (
      !window.confirm(
        `Permanently delete ${c.name}'s account? Their name, email, phone and community profile are removed and they're signed out everywhere.${orders} This can't be undone.`,
      )
    ) {
      return;
    }
    setBusyId(c.id);
    try {
      const res = await deleteStoreCustomerAction(c.id);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setRows((prev) => (prev ?? []).filter((r) => r.id !== c.id));
      setLedger((prev) => prev?.filter((e) => e.accountId !== c.id) ?? null);
      if (editingId === c.id) setEditingId(null);
      if (issued?.id === c.id) setIssued(null);
      toast("Customer deleted");
    } catch {
      toast("Couldn't delete the customer.");
    } finally {
      setBusyId(null);
    }
  };

  const copyIssued = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      toast("Password copied");
    } catch {
      toast("Couldn't copy. Select the password and copy it.");
    }
  };

  const header = (
    <header className="cx-head">
      <div className="cx-head__text">
        <button type="button" className="cx-crumb" onClick={onBack}>
          ← Dashboard
        </button>
        <h1 className="cx-head__title">Customers</h1>
        <p className="cx-head__sub">
          {hasLedger
            ? "Who buys, how much, and how often, from shoppers with an account on your store."
            : "Shoppers with an account on your store. Guest checkout still works for everyone else."}
        </p>
      </div>
      <div className="cx-head__tools">
        {hasLedger && accounts.length > 0 && (
          <div className="cx-toggle cx-toggle--solid" role="group" aria-label="Date range">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
        {accounts.length > 0 && (
          <button type="button" className="cx-btn" onClick={exportCsv}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            Export CSV
          </button>
        )}
      </div>
    </header>
  );
  // The members-only switch rides with the header so it shows in every state —
  // a brand-new store with no accounts yet is exactly who turns it on.
  const top = (
    <>
      {header}
      <AdminMemberSignIn />
    </>
  );

  if (rows === null) {
    return (
      <div className="cx">
        {top}
        <div className="cpf-skeleton" aria-busy="true" aria-label="Loading customers">
          <div className="cpf-skeleton__hero" />
          <div className="cpf-skeleton__row" />
          <div className="cpf-skeleton__row" />
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="cx">
        {top}
        <section className="cx-card cx-card--empty">
          <h2 className="cx-card__title">No customer accounts yet</h2>
          <p className="cx-empty">
            Shoppers can sign up from the account icon in your store&apos;s header. They&apos;ll show up here.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="cx">
      {top}

      {hasLedger && ledger && (
        <CustomersInsights
          accounts={accounts}
          ledger={ledger}
          stats={stats}
          period={period}
          now={now}
          money={money}
          moneyShort={moneyShort}
          vipRule={`${money(VIP_SPEND)}+ total spent`}
          onOpenProfile={onOpenProfile}
          onFilter={showFilter}
          onOpenPromo={onOpenPromo}
        />
      )}

      <section className="cx-card cx-table-card" ref={tableRef} aria-labelledby="cx-all-title">
        <div className="cx-table-card__head">
          <h2 id="cx-all-title" className="cx-card__title cx-card__title--lg">All customers</h2>
          <label className="cx-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
            </svg>
            <span className="cx-sr">Search customers</span>
            <input
              type="search"
              value={query}
              placeholder="Search name, email or phone"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <div className="cx-filters" role="group" aria-label="Filter customers">
          {filters.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {CUSTOMER_FILTERS[f].label}
              <span className="cx-filters__count">{counts[f]}</span>
            </button>
          ))}
        </div>

        <div className="cx-table-wrap">
          <table className="cx-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                {hasLedger && <th scope="col">Segment</th>}
                <th scope="col" className="cx-num">Orders</th>
                {hasLedger && <th scope="col" className="cx-num">Total spent</th>}
                {hasLedger && <th scope="col" className="cx-num">Avg order</th>}
                {hasLedger && <th scope="col">Last order</th>}
                <th scope="col">Joined</th>
                <th scope="col" className="cx-num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const s = stats.get(c.id);
                const busy = busyId === c.id;
                return (
                  <CustomerRows
                    key={c.id}
                    c={c}
                    s={s}
                    hasLedger={hasLedger}
                    money={money}
                    busy={busy}
                    editing={editingId === c.id}
                    issued={issued?.id === c.id ? issued.password : null}
                    onOpenProfile={onOpenProfile}
                    onEdit={() => setEditingId(editingId === c.id ? null : c.id)}
                    onSave={(draft) => void saveEdit(c, draft)}
                    onCancelEdit={() => setEditingId(null)}
                    onReset={() => void resetPassword(c)}
                    onToggle={() => void toggle(c)}
                    onDelete={() => void remove(c)}
                    onCopyIssued={() => void copyIssued()}
                    onDoneIssued={() => setIssued(null)}
                  />
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="cx-empty cx-empty--table">
              {query.trim() ? `No customers match “${query.trim()}”.` : "No customers match this filter."}
            </p>
          )}
        </div>
        <span className="cx-foot">
          Showing {visible.length} of {accounts.length} customer{accounts.length === 1 ? "" : "s"}
        </span>
      </section>
    </div>
  );
}

interface CustomerRowsProps {
  c: StoreCustomerRow;
  s: AccountStats | undefined;
  hasLedger: boolean;
  money: (n: number) => string;
  busy: boolean;
  editing: boolean;
  issued: string | null;
  onOpenProfile?: (id: string) => void;
  onEdit: () => void;
  onSave: (draft: CustomerDraft) => void;
  onCancelEdit: () => void;
  onReset: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onCopyIssued: () => void;
  onDoneIssued: () => void;
}

/** One customer's table row, plus the inline editor / temp-password row under it. */
function CustomerRows(p: CustomerRowsProps) {
  const { c, s, hasLedger, money, busy } = p;
  const span = hasLedger ? TABLE_COLUMNS : TABLE_COLUMNS - 4;
  const segment = s?.segment ?? "none";
  return (
    <>
      <tr className={c.status === "disabled" ? "is-disabled" : undefined}>
        <td>
          <div className="cx-who">
            <span className="cx-avatar cx-avatar--sm" data-tint={avatarTint(c.id)} aria-hidden="true">
              {customerInitials(c.name)}
            </span>
            <span className="cx-who__text">
              <span className="cx-who__top">
                {p.onOpenProfile ? (
                  <button type="button" className="cx-name" onClick={() => p.onOpenProfile?.(c.id)}>
                    {c.name}
                  </button>
                ) : (
                  <span className="cx-name">{c.name}</span>
                )}
                {c.status === "disabled" && <span className="cx-flag">DISABLED</span>}
                {c.emailOnly && (
                  <span
                    className="cx-flag cx-flag--info"
                    title="Joined a group buy with just an email. No password yet. Creating an account with this email turns it into a full account."
                  >
                    EMAIL ONLY
                  </span>
                )}
              </span>
              <span className="cx-who__email">{c.email}</span>
              {c.unlinkedOrders > 0 && p.onOpenProfile && (
                <button type="button" className="cx-tolink" onClick={() => p.onOpenProfile?.(c.id)}>
                  {c.unlinkedOrders} earlier order{c.unlinkedOrders === 1 ? "" : "s"} to link →
                </button>
              )}
            </span>
          </div>
        </td>
        {hasLedger && (
          <td>
            <span className="cx-pill" data-seg={segment}>{SEGMENT_LABELS[segment]}</span>
          </td>
        )}
        <td className="cx-num cx-strong">{hasLedger ? (s?.orders ?? 0) : c.orderCount}</td>
        {hasLedger && <td className="cx-num cx-bold">{money(s?.spent ?? 0)}</td>}
        {hasLedger && <td className="cx-num cx-soft">{s && s.orders > 0 ? money(s.avg) : "—"}</td>}
        {hasLedger && <td className="cx-soft cx-nowrap">{shortDate(s?.lastAt ?? null)}</td>}
        <td className="cx-soft cx-nowrap">{shortDate(c.joinedAt)}</td>
        <td>
          <div className="cx-actions">
            {p.onOpenProfile && (
              <button type="button" className="cx-btn cx-btn--sm" onClick={() => p.onOpenProfile?.(c.id)}>
                Order history
              </button>
            )}
            <button
              type="button"
              className="cx-icon-btn"
              aria-label={`Edit ${c.name}`}
              aria-expanded={p.editing}
              title="Edit"
              disabled={busy}
              onClick={p.onEdit}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
              </svg>
            </button>
            <RowMenu customer={c} busy={busy} onReset={p.onReset} onToggle={p.onToggle} onDelete={p.onDelete} />
          </div>
        </td>
      </tr>
      {p.editing && (
        <tr className="cx-subrow">
          <td colSpan={span}>
            <CustomerEditForm customer={c} busy={busy} onSave={p.onSave} onCancel={p.onCancelEdit} />
          </td>
        </tr>
      )}
      {p.issued && (
        <tr className="cx-subrow">
          <td colSpan={span}>
            <div className="cust-temp" role="status">
              <div className="cust-temp__label">Temporary password</div>
              <code className="cust-temp__value">{p.issued}</code>
              <div className="cust-temp__actions">
                <button type="button" className="admin-btn admin-btn--ghost" onClick={p.onCopyIssued}>
                  Copy
                </button>
                <button type="button" className="admin-btn admin-btn--ghost" onClick={p.onDoneIssued}>
                  Done
                </button>
              </div>
              <p className="admin-field__hint">
                Send this to {c.name}. It&apos;s shown only once. They can sign in with it, then change it under My
                Account → Change password.
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
