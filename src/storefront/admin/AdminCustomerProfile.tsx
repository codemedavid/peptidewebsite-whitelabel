"use client";

// One customer's order history for the store admin — opened from Customers
// (an account) or the dashboard's Top customers (the email they buy with).
// Every order opens the normal order detail. An account whose earlier guest
// orders share its email gets a "Link N orders" prompt: emails at checkout
// aren't verified, so linking is always the admin's call, never automatic.
// Needs the Orders permission; the server re-checks it.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";
import {
  getStoreCustomerProfileAction,
  linkStoreCustomerOrdersAction,
  type StoreCustomerProfile,
} from "@/actions/customer-accounts";
import type { CustomerLookup } from "@/lib/storefront/customer-profile";
import { formatMoney } from "@/lib/storefront/currency";
import "./customer-profile.css";

type OrderFilter = "all" | "open" | "done" | "cancelled";

const OPEN_STATUSES: ReadonlySet<Order["status"]> = new Set(["new", "confirmed", "processing", "ready"]);
const DONE_STATUSES: ReadonlySet<Order["status"]> = new Set(["shipped", "delivered"]);
const ITEMS_PREVIEW_MAX = 3;

const FILTERS: ReadonlyArray<{ key: OrderFilter; label: string; match: (o: Order) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "open", label: "Open", match: (o) => OPEN_STATUSES.has(o.status) },
  { key: "done", label: "Shipped", match: (o) => DONE_STATUSES.has(o.status) },
  { key: "cancelled", label: "Cancelled", match: (o) => o.status === "cancelled" },
];

export function customerInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function itemsPreview(o: Order): string {
  const items = o.items ?? [];
  const head = items.slice(0, ITEMS_PREVIEW_MAX).map((i) => `${i.name} ×${i.qty || 1}`);
  const more = items.length - ITEMS_PREVIEW_MAX;
  return more > 0 ? `${head.join(", ")} +${more} more` : head.join(", ") || "No items";
}

function AccountBadge({ profile }: { profile: StoreCustomerProfile }) {
  const a = profile.account;
  if (!a) return <span className="cpf-badge" data-tone="muted">Guest buyer</span>;
  if (a.emailOnly) return <span className="cpf-badge" data-tone="info">Group-buy email</span>;
  return a.status === "active" ? (
    <span className="cpf-badge" data-tone="good">Account · Active</span>
  ) : (
    <span className="cpf-badge" data-tone="bad">Account · Disabled</span>
  );
}

interface LinkPromptProps {
  count: number;
  busy: boolean;
  onLink: () => void;
}

function LinkPrompt({ count, busy, onLink }: LinkPromptProps) {
  const noun = count === 1 ? "order" : "orders";
  return (
    <section className="cpf-link" aria-labelledby="cpf-link-title">
      <div className="cpf-link__body">
        <h2 id="cpf-link-title" className="cpf-link__title">
          {count} earlier {noun} use this email
        </h2>
        <p className="cpf-link__text">
          Placed as a guest, before they signed up or while signed out. Link {count === 1 ? "it" : "them"} to
          see the full history here. They&apos;ll also appear in the customer&apos;s My Account.
        </p>
      </div>
      <button type="button" className="admin-btn" onClick={onLink} disabled={busy}>
        {busy ? "Linking…" : `Link ${count} ${noun}`}
      </button>
    </section>
  );
}

interface AdminCustomerProfileProps {
  brand: Brand;
  lookup: CustomerLookup;
  backLabel: string;
  onBack: () => void;
  onOpenOrder: (order: Order) => void;
}

export function AdminCustomerProfile({ brand, lookup, backLabel, onBack, onOpenOrder }: AdminCustomerProfileProps) {
  const { toast } = useStore();
  const [profile, setProfile] = useState<StoreCustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [linking, setLinking] = useState(false);
  const money = useCallback((n: number) => formatMoney(n, brand.currency), [brand.currency]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getStoreCustomerProfileAction(lookup);
      if ("error" in res) setError(res.error);
      else setProfile(res.profile);
    } catch {
      setError("Couldn't load this customer.");
    }
  }, [lookup]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const orders = profile?.orders ?? [];
    return Object.fromEntries(FILTERS.map((f) => [f.key, orders.filter(f.match).length])) as Record<OrderFilter, number>;
  }, [profile]);

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter)?.match ?? (() => true);
    return (profile?.orders ?? []).filter(match);
  }, [profile, filter]);

  const link = async () => {
    const account = profile?.account;
    if (!profile || !account || linking) return;
    const n = profile.unlinkedCount;
    if (
      !window.confirm(
        `Link ${n} earlier order${n === 1 ? "" : "s"} placed with ${profile.email} to ${profile.name}'s account? ` +
          "Only do this if you're sure this email belongs to them.",
      )
    ) {
      return;
    }
    setLinking(true);
    try {
      const res = await linkStoreCustomerOrdersAction(account.id);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      toast(res.linked === 1 ? "1 order linked" : `${res.linked} orders linked`);
      await load();
    } catch {
      toast("Couldn't link the orders.");
    } finally {
      setLinking(false);
    }
  };

  const phone = profile?.phone.replace(/[^\d+]/g, "") ?? "";

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          {backLabel}
        </button>
        <h1 className="admin-form__title">Customer</h1>
        <div className="admin-form__bar-spacer" />
      </header>

      <div className="admin-form__body cpf">
        {error ? (
          <div className="admin-form__card cpf-state" role="alert">
            <p>{error}</p>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : !profile ? (
          <div className="cpf-skeleton" aria-busy="true" aria-label="Loading customer">
            <div className="cpf-skeleton__hero" />
            <div className="cpf-skeleton__row" />
            <div className="cpf-skeleton__row" />
          </div>
        ) : (
          <>
            <section className="cpf-hero" aria-labelledby="cpf-name">
              <div className="cpf-hero__avatar" aria-hidden="true">
                {customerInitials(profile.name)}
              </div>
              <div className="cpf-hero__main">
                <div className="cpf-hero__top">
                  <h2 id="cpf-name" className="cpf-hero__name">
                    {profile.name}
                  </h2>
                  <AccountBadge profile={profile} />
                </div>
                <div className="cpf-hero__contact">
                  {profile.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>}
                  {phone && <a href={`tel:${phone}`}>{profile.phone}</a>}
                </div>
                <p className="cpf-hero__meta">
                  {profile.account
                    ? `Joined ${shortDate(profile.account.joinedAt)}${
                        profile.account.emailOnly ? "" : ` · Last sign-in ${shortDate(profile.account.lastLoginAt)}`
                      }`
                    : `First order ${shortDate(profile.stats.firstAt)}`}
                </p>
              </div>
            </section>

            <dl className="cpf-stats">
              <div className="cpf-stat">
                <dt>Orders</dt>
                <dd>{profile.stats.orders}</dd>
              </div>
              <div className="cpf-stat cpf-stat--lead">
                <dt>Total spent</dt>
                <dd>{money(profile.stats.spent)}</dd>
              </div>
              <div className="cpf-stat">
                <dt>Avg. order</dt>
                <dd>{profile.stats.orders > 0 ? money(profile.stats.avg) : "—"}</dd>
              </div>
              <div className="cpf-stat">
                <dt>Last order</dt>
                <dd>{shortDate(profile.stats.lastAt)}</dd>
              </div>
            </dl>

            {profile.account && profile.unlinkedCount > 0 && (
              <LinkPrompt count={profile.unlinkedCount} busy={linking} onLink={() => void link()} />
            )}

            <section className="cpf-history" aria-labelledby="cpf-history-title">
              <header className="cpf-history__head">
                <h2 id="cpf-history-title" className="cpf-history__title">
                  Order history
                </h2>
                {profile.orders.length > 0 && (
                  <div className="cpf-filters" role="group" aria-label="Filter orders">
                    {FILTERS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={filter === f.key}
                        className="cpf-filter"
                        onClick={() => setFilter(f.key)}
                        disabled={f.key !== "all" && counts[f.key] === 0}
                      >
                        {f.label}
                        <span className="cpf-filter__count">{counts[f.key]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </header>

              {profile.orders.length === 0 ? (
                <div className="cpf-empty">
                  <p className="cpf-empty__title">No orders on this account yet</p>
                  <p className="admin-field__hint">
                    Orders they place while signed in show up here.
                    {profile.unlinkedCount > 0 ? " Link their earlier guest orders above to bring those in." : ""}
                  </p>
                </div>
              ) : (
                <ul className="cpf-orders">
                  {visible.map((o) => (
                    <li key={o.id}>
                      <button type="button" className="cpf-order" onClick={() => onOpenOrder(o)}>
                        <span className="cpf-order__main">
                          <span className="cpf-order__top">
                            <span className="cpf-order__code">{o.orderNumber || `#${o.id.slice(0, 8)}`}</span>
                            <span className="adm-status" data-status={o.status}>
                              {o.status}
                            </span>
                            {o.paymentStatus !== "paid" && o.status !== "cancelled" && (
                              <span className="cpf-badge" data-tone="warn">Unpaid</span>
                            )}
                          </span>
                          <span className="cpf-order__items">{itemsPreview(o)}</span>
                          <span className="cpf-order__meta">
                            {shortDate(o.date)}
                            {o.groupBuyName ? ` · ${o.groupBuyName}` : ""}
                          </span>
                        </span>
                        <span className="cpf-order__total">{money(o.total)}</span>
                        <span className="cpf-order__chev" aria-hidden="true">
                          →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {profile.truncated && (
                <p className="admin-field__hint">
                  Showing the latest {profile.orders.length} orders. Open Orders to search older ones.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
