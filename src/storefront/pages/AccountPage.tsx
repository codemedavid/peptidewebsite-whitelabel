"use client";

// #account — the shopper's own account on THIS store. Signed out it is a sign
// in / create account card; signed in it is My Account: order history (each
// order opens the same journey + summary the Track page shows), profile and
// password. Only routed while the operator has granted customer accounts
// (visibility.ts PAGE_TOGGLE.account); every action re-checks server-side.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Brand } from "../types";
import { BackLink } from "../components/BackLink";
import { PAID_ACCESS_JOIN_RETURN_KEY as GB_JOIN_RETURN_KEY } from "@/modules/paid-access/ui";
import { TrackedOrderDetail, STATUS_LABELS, STATUS_DOT, formatDate } from "../components/TrackedOrderDetail";
import {
  getCustomerAccountAction,
  signInCustomerAction,
  signUpCustomerAction,
  signOutCustomerAction,
  listMyOrdersAction,
  updateCustomerProfileAction,
  changeCustomerPasswordAction,
  type CustomerAccount,
  type AccountOrder,
} from "@/actions/customer-accounts";
import { CUSTOMER_PASSWORD_MIN } from "@/lib/storefront/customer-account";
import { notifyCustomerAccountChanged } from "../customer-account-client";

type Mode = "signin" | "signup";

export function AccountPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const [account, setAccount] = useState<CustomerAccount | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getCustomerAccountAction()
      .then((a) => !cancelled && setAccount(a))
      .catch(() => !cancelled && setAccount(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const onAccount = (a: CustomerAccount | null) => {
    setAccount(a);
    notifyCustomerAccountChanged(a);
    // Came here from a paid group buy's "Sign in to join": go straight back.
    if (!a) return;
    try {
      if (sessionStorage.getItem(GB_JOIN_RETURN_KEY)) {
        sessionStorage.removeItem(GB_JOIN_RETURN_KEY);
        window.location.hash = "#groupbuy";
      }
    } catch {
      /* storage blocked — stay on the account page */
    }
  };

  return (
    <section className="page acct" id="account">
      <div className="page__container">
        <BackLink onClick={onBack} label="Back to Shop" />
        {account === undefined ? (
          <p className="acct__loading" aria-live="polite">Loading your account…</p>
        ) : account ? (
          <MyAccount brand={brand} account={account} onAccount={onAccount} />
        ) : (
          <AuthCard brand={brand} onAccount={onAccount} />
        )}
      </div>
    </section>
  );
}

// ── Signed out ────────────────────────────────────────────────────────────────

function AuthCard({ brand, onAccount }: { brand: Brand; onAccount: (a: CustomerAccount) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = mode === "signin" ? await signInCustomerAction(form) : await signUpCustomerAction(form);
      if ("error" in res) setError(res.error);
      else onAccount(res.account);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setError("");
  };

  return (
    <div className="acct-auth">
      <div className="acct-auth__intro">
        <p className="acct__eyebrow">{brand.name}</p>
        <h1 className="page__title">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="page__sub">
          {mode === "signin"
            ? "Sign in to see your orders and check out faster."
            : "Keep every order in one place, with live status and tracking."}
        </p>
      </div>

      <form className="acct-card" onSubmit={submit} noValidate>
        <div className="acct-tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={mode === "signin"} className="acct-tabs__tab" onClick={() => switchTo("signin")}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className="acct-tabs__tab" onClick={() => switchTo("signup")}>
            Create account
          </button>
        </div>

        {mode === "signup" && (
          <label className="acct-field">
            <span>Full name</span>
            <input value={form.name} onChange={set("name")} autoComplete="name" required />
          </label>
        )}
        <label className="acct-field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
        </label>
        {mode === "signup" && (
          <label className="acct-field">
            <span>
              Phone <em>(optional)</em>
            </span>
            <input type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
          </label>
        )}
        <label className="acct-field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={set("password")}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? CUSTOMER_PASSWORD_MIN : undefined}
            required
          />
          {mode === "signup" && <small>At least {CUSTOMER_PASSWORD_MIN} characters.</small>}
        </label>

        {error && (
          <p className="acct-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary acct-card__submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <p className="acct-card__switch">
          {mode === "signin" ? "New here? " : "Already have an account? "}
          <button type="button" onClick={() => switchTo(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}

// ── Signed in ─────────────────────────────────────────────────────────────────

function MyAccount({
  brand,
  account,
  onAccount,
}: {
  brand: Brand;
  account: CustomerAccount;
  onAccount: (a: CustomerAccount | null) => void;
}) {
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState("");
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const currency = brand.currency || "";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;

  const loadOrders = useCallback(async () => {
    setOrdersError("");
    try {
      const res = await listMyOrdersAction();
      if ("error" in res) {
        setOrdersError(res.error);
        setOrders([]);
      } else {
        setOrders(res.orders);
      }
    } catch {
      setOrdersError("Couldn't load your orders. Please try again.");
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const signOut = async () => {
    await signOutCustomerAction().catch(() => {});
    onAccount(null);
  };

  const firstName = account.name.split(/\s+/)[0] || account.name;

  return (
    <div className="acct-home">
      <header className="acct-home__head">
        <div>
          <p className="acct__eyebrow">My account</p>
          <h1 className="page__title">Hi, {firstName}</h1>
          <p className="acct-home__meta">
            {account.email} · Member since {formatDate(account.memberSince)}
          </p>
        </div>
        <button type="button" className="btn btn-secondary acct-home__signout" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div className="acct-home__grid">
        <section className="acct-orders" aria-labelledby="acct-orders-h">
          <h2 id="acct-orders-h" className="acct-section__title">
            Your orders
            {orders && orders.length > 0 && <span className="acct-section__count">{orders.length}</span>}
          </h2>

          {orders === null && <p className="acct__loading">Loading orders…</p>}
          {ordersError && (
            <p className="acct-error" role="alert">
              {ordersError}{" "}
              <button type="button" className="acct-link" onClick={() => void loadOrders()}>
                Retry
              </button>
            </p>
          )}
          {orders && orders.length === 0 && !ordersError && (
            <div className="acct-empty">
              <p className="acct-empty__title">No orders yet</p>
              <p>Orders you place while signed in will show up here with their live status.</p>
              <a href="#catalog" className="btn btn-primary">
                Start shopping
              </a>
            </div>
          )}

          {orders && orders.length > 0 && (
            <ul className="acct-orders__list">
              {orders.map((o) => {
                const open = openOrder === o.orderNumber;
                const units = o.items.reduce((n, it) => n + (it.qty || 0), 0);
                return (
                  <li key={o.orderNumber} className={`acct-order ${open ? "is-open" : ""}`}>
                    <button
                      type="button"
                      className="acct-order__row"
                      aria-expanded={open}
                      onClick={() => setOpenOrder(open ? null : o.orderNumber)}
                    >
                      <span className="acct-order__num">{o.orderNumber}</span>
                      <span className="acct-order__date">{formatDate(o.date)}</span>
                      <span className="acct-order__status">
                        <span className="acct-order__dot" style={{ background: STATUS_DOT[o.status] }} aria-hidden />
                        {STATUS_LABELS[o.status]}
                      </span>
                      <span className="acct-order__items">
                        {units} item{units === 1 ? "" : "s"}
                        {o.paymentStatus === "paid" ? " · Paid" : ""}
                      </span>
                      <span className="acct-order__total">{money(o.total)}</span>
                      <svg className="acct-order__chev" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {open && (
                      <div className="acct-order__detail">
                        <TrackedOrderDetail order={o} currency={currency} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="acct-orders__note">
            Ordered as a guest before you had an account? Look it up on{" "}
            <a href="#track" className="acct-link">
              Track Order
            </a>
            .
          </p>
        </section>

        <aside className="acct-side">
          <ProfileCard account={account} onAccount={onAccount} />
          <PasswordCard />
        </aside>
      </div>
    </div>
  );
}

function ProfileCard({ account, onAccount }: { account: CustomerAccount; onAccount: (a: CustomerAccount) => void }) {
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = name !== account.name || phone !== account.phone;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await updateCustomerProfileAction({ name, phone });
      if ("error" in res) setMsg({ kind: "error", text: res.error });
      else {
        onAccount(res.account);
        setMsg({ kind: "ok", text: "Saved." });
      }
    } catch {
      setMsg({ kind: "error", text: "Couldn't save. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="acct-card acct-card--compact" onSubmit={save}>
      <h2 className="acct-section__title">Your details</h2>
      <label className="acct-field">
        <span>Full name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label className="acct-field">
        <span>Email</span>
        <input value={account.email} readOnly aria-readonly />
      </label>
      <label className="acct-field">
        <span>Phone</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      </label>
      {msg && (
        <p className={msg.kind === "ok" ? "acct-ok" : "acct-error"} role="status">
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
        {busy ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await changeCustomerPasswordAction({ current, next });
      if ("error" in res) setMsg({ kind: "error", text: res.error });
      else {
        setCurrent("");
        setNext("");
        setMsg({ kind: "ok", text: "Password changed. Other devices have been signed out." });
      }
    } catch {
      setMsg({ kind: "error", text: "Couldn't change your password. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="acct-card acct-card--compact" onSubmit={save}>
      <h2 className="acct-section__title">Change password</h2>
      <label className="acct-field">
        <span>Current password</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="acct-field">
        <span>New password</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <small>At least {CUSTOMER_PASSWORD_MIN} characters.</small>
      </label>
      {msg && (
        <p className={msg.kind === "ok" ? "acct-ok" : "acct-error"} role="status">
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn btn-secondary" disabled={busy || !current || !next}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
