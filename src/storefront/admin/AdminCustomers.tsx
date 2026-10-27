"use client";

// Store-admin "Customers": everyone who created an account on this storefront
// (customer accounts). Search, see how many orders each has placed while signed
// in, and disable an account — which signs it out everywhere on its next
// request. A shopper who forgot their password messages the store; "Reset
// password" issues a temp one to pass on (also signs them out everywhere).
// Staff need the "customers" permission; the server re-checks it.

import { useEffect, useMemo, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import {
  listStoreCustomersAction,
  resetStoreCustomerPasswordAction,
  setStoreCustomerStatusAction,
  type StoreCustomerRow,
} from "@/actions/customer-accounts";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export function AdminCustomers({ onBack }: { brand: Brand; onBack: () => void }) {
  const { toast } = useStore();
  const [rows, setRows] = useState<StoreCustomerRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The temp password just issued — shown once, on that customer's row. */
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStoreCustomersAction()
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          toast(res.error);
          setRows([]);
        } else setRows(res.customers);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows || !q) return rows ?? [];
    return rows.filter((r) => [r.name, r.email, r.phone].some((v) => v.toLowerCase().includes(q)));
  }, [rows, query]);

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

  const copyIssued = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      toast("Password copied");
    } catch {
      toast("Couldn't copy. Select the password and copy it.");
    }
  };

  const total = rows?.length ?? 0;
  const withOrders = rows?.filter((r) => r.orderCount > 0).length ?? 0;

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          Back
        </button>
        <h1 className="admin-form__title">Customers</h1>
        <div className="admin-form__bar-spacer" />
      </header>

      <div className="admin-form__body">
        <div className="admin__tip" style={{ marginTop: 0, textAlign: "left" }}>
          Shoppers who created an account on your store. Orders they place while signed in appear on their
          <strong> My Account</strong> page with live status and tracking. Guest checkout still works for everyone else.
        </div>

        <div className="admin-form__card">
          {rows === null ? (
            <div className="admin-field__hint">Loading customers…</div>
          ) : total === 0 ? (
            <div className="staff-empty">
              <p className="staff-empty__title">No customer accounts yet</p>
              <p className="admin-field__hint">
                Shoppers can sign up from the account icon in your store&apos;s header. They&apos;ll show up here.
              </p>
            </div>
          ) : (
            <>
              <div className="cust-summary">
                <span>
                  <strong>{total}</strong> account{total === 1 ? "" : "s"}
                </span>
                <span>
                  <strong>{withOrders}</strong> with orders
                </span>
              </div>
              <label className="input-wrap cust-search" aria-label="Search customers">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input value={query} placeholder="Search name, email or phone" onChange={(e) => setQuery(e.target.value)} />
              </label>

              {filtered.length === 0 ? (
                <div className="admin-field__hint">No customers match &ldquo;{query}&rdquo;.</div>
              ) : (
                <div className="staff-list">
                  {filtered.map((c) => (
                    <div key={c.id} className={`staff-row ${c.status === "disabled" ? "is-suspended" : ""}`}>
                      <div className="staff-row__main">
                        <div className="staff-row__name">{c.name}</div>
                        <div className="staff-row__meta">
                          {c.email}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </div>
                        <div className="staff-row__perms">
                          {c.orderCount} order{c.orderCount === 1 ? "" : "s"} · Joined {shortDate(c.joinedAt)} · Last
                          sign-in {shortDate(c.lastLoginAt)}
                        </div>
                      </div>
                      <div className="staff-row__side">
                        <span className={`staff-badge staff-badge--${c.status === "active" ? "active" : "suspended"}`}>
                          {c.status === "active" ? "Active" : "Disabled"}
                        </span>
                        <div className="staff-row__actions">
                          {c.status === "active" && (
                            <button
                              className="admin-btn admin-btn--ghost"
                              onClick={() => void resetPassword(c)}
                              disabled={busyId === c.id}
                            >
                              Reset password
                            </button>
                          )}
                          <button
                            className={`admin-btn ${c.status === "active" ? "admin-btn--danger" : "admin-btn--ghost"}`}
                            onClick={() => void toggle(c)}
                            disabled={busyId === c.id}
                          >
                            {c.status === "active" ? "Disable" : "Re-enable"}
                          </button>
                        </div>
                      </div>
                      {issued?.id === c.id && (
                        <div className="cust-temp" role="status">
                          <div className="cust-temp__label">Temporary password</div>
                          <code className="cust-temp__value">{issued.password}</code>
                          <div className="cust-temp__actions">
                            <button className="admin-btn admin-btn--ghost" onClick={() => void copyIssued()}>
                              Copy
                            </button>
                            <button className="admin-btn admin-btn--ghost" onClick={() => setIssued(null)}>
                              Done
                            </button>
                          </div>
                          <p className="admin-field__hint">
                            Send this to {c.name}. It&apos;s shown only once. They can sign in with it, then change it
                            under My Account → Change password.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
