"use client";

// Dashboard → Group Buy panel. Replaces "Stock levels" on a group-buy store,
// where every pre-order item reads "Out of stock" and the panel says nothing.
// useGroupBuyPanel() loads the round in one server call
// (getDashboardGroupBuyAction); GroupBuyPanel only renders what
// lib/storefront/admin-dashboard-gb decided. Clicking the join-request strip
// jumps straight to the approval queue.

import { useEffect, useMemo, useState } from "react";

import type { Product } from "../types";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import { getDashboardGroupBuyAction, type DashboardGroupBuyResult } from "@/actions/group-buys";
import {
  buildGroupBuyPanel,
  type FocusRound,
  type GbCatalogEntry,
  type GbKitRow,
  type GbPanel,
} from "@/lib/storefront/admin-dashboard-gb";
import { formatDashboardMoney } from "@/lib/storefront/admin-dashboard";

// ── Data ─────────────────────────────────────────────────────────────────────

type Loaded = Extract<DashboardGroupBuyResult, { ok: true }>;

export type GroupBuyPanelState =
  | { status: "off" | "loading" }
  | { status: "empty"; next: GroupBuy | null }
  | { status: "error"; message: string }
  | { status: "ready"; panel: GbPanel; focus: FocusRound; next: GroupBuy | null };

async function loadRound(): Promise<Loaded> {
  const res = await getDashboardGroupBuyAction();
  if ("error" in res) throw new Error(res.error);
  return res;
}

export function useGroupBuyPanel(input: {
  enabled: boolean;
  products: Product[];
  showMoney: boolean;
}): GroupBuyPanelState {
  const { enabled, products, showMoney } = input;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadRound()
      .then((res) => {
        if (!cancelled) setLoaded(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the group buy.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Kit sizes come from the live catalog, so editing "vials per kit" on a
  // product reflects here without refetching the round.
  const catalog = useMemo(
    () =>
      new Map<string, GbCatalogEntry>(
        products.map((p) => [p.id, { name: p.name, vialsPerKit: p.vialsPerKit }]),
      ),
    [products],
  );

  return useMemo((): GroupBuyPanelState => {
    if (!enabled) return { status: "off" };
    if (error) return { status: "error", message: error };
    if (!loaded) return { status: "loading" };
    if (!loaded.focus || !loaded.analytics) return { status: "empty", next: loaded.next };
    const panel = buildGroupBuyPanel({
      focus: loaded.focus,
      analytics: loaded.analytics,
      orderRows: loaded.orderRows,
      catalog,
      joinsWaiting: loaded.joinsWaiting,
      showMoney,
    });
    return { status: "ready", panel, focus: loaded.focus, next: loaded.next };
  }, [enabled, error, loaded, catalog, showMoney]);
}

// ── Markup ───────────────────────────────────────────────────────────────────

function kitNote(k: GbKitRow): string {
  if (k.remaining === 0) return `${k.fullKits} ${k.fullKits === 1 ? "kit" : "kits"} full ✓`;
  const base = `${k.inKit}/${k.perKit} · ${k.remaining} more closes kit ${k.fullKits + 1}`;
  return k.tone === "risk" ? `${base} · at risk` : base;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function unpaidSub(panel: GbPanel, currency?: string): string {
  if (panel.unpaidOrders === 0) return "all paid ✓";
  return panel.unpaidAmount !== null ? formatDashboardMoney(panel.unpaidAmount, currency) : "tap to chase";
}

type PanelProps = {
  state: GroupBuyPanelState;
  currency?: string;
  onOpenJoins: () => void;
  onOpenRound: (gb: GroupBuy) => void;
  onManage: () => void;
};

export function GroupBuyPanel({ state, currency, onOpenJoins, onOpenRound, onManage }: PanelProps) {
  if (state.status === "off") return null;

  // No live or finished round yet: say what's next instead of falling back to a
  // stock list that reads "Out of stock" for every pre-order product.
  if (state.status === "empty") {
    const { next } = state;
    return (
      <section className="adm-panel adm-gb" data-mode="empty" aria-labelledby="adm-gb-title">
        <header className="adm-panel__head">
          <div className="adm-gb__heading">
            <span className="adm-gb__eyebrow">Group buy</span>
            <h2 className="adm-panel__title" id="adm-gb-title">
              {next ? next.name : "No round open yet"}
            </h2>
            <span className="adm-gb__timing" data-tone="neutral">
              {next
                ? next.startsAt
                  ? `Opens ${shortDate(next.startsAt)}`
                  : "Scheduled · no start date yet"
                : "Start a round to begin taking group-buy orders"}
            </span>
          </div>
        </header>
        <p className="adm-panel__sub">
          Once a round is open, this card tracks orders and buyers, who still needs to pay, join requests waiting for
          your approval, and how close each kit is to full.
        </p>
        <footer className="adm-gb__next">
          <span />
          <button type="button" className="adm-btn adm-btn--primary" onClick={onManage}>
            {next ? "Open Group Buys" : "Start a round"}
          </button>
        </footer>
      </section>
    );
  }

  if (state.status !== "ready") {
    return (
      <section className="adm-panel adm-gb" aria-busy={state.status === "loading"}>
        <header className="adm-panel__head">
          <h2 className="adm-panel__title">Group buy</h2>
          <button type="button" className="adm-link" onClick={onManage}>
            Group Buys →
          </button>
        </header>
        <p className="adm-panel__sub">{state.status === "error" ? state.message : "Loading your round…"}</p>
      </section>
    );
  }

  const { panel, focus, next } = state;
  const live = panel.mode === "live";
  const openRound = () => onOpenRound(focus.round);
  const joins = panel.joinsWaiting;

  return (
    <section className="adm-panel adm-gb" data-mode={panel.mode} aria-labelledby="adm-gb-title">
      <header className="adm-panel__head">
        <div className="adm-gb__heading">
          <span className="adm-gb__eyebrow">{live ? "Live group buy" : "Last round"}</span>
          <h2 className="adm-panel__title" id="adm-gb-title">
            {panel.roundName}
          </h2>
          <span className="adm-gb__timing" data-tone={panel.timing.tone}>
            {panel.timing.label}
          </span>
        </div>
        <button type="button" className="adm-link" onClick={openRound}>
          {live ? "Manage round →" : "View report →"}
        </button>
      </header>

      {live && joins !== null && joins > 0 && (
        <button type="button" className="adm-gb__joins" onClick={onOpenJoins}>
          <span className="adm-gb__joins-count" aria-hidden="true">
            {joins}
          </span>
          <span className="adm-gb__joins-body">
            <span className="adm-gb__joins-title">
              {joins} {joins === 1 ? "join request is" : "join requests are"} waiting for approval
            </span>
            <span className="adm-gb__joins-sub">Check the receipts and approve them</span>
          </span>
          <span className="adm-gb__joins-cta">Review →</span>
        </button>
      )}

      <ul className="adm-gb__stats">
        <li className="adm-gb__stat">
          <span className="adm-gb__stat-label">Orders</span>
          <span className="adm-gb__stat-value">{panel.orders}</span>
          <span className="adm-gb__stat-sub">
            {panel.buyers} {panel.buyers === 1 ? "buyer" : "buyers"}
          </span>
        </li>
        <li className="adm-gb__stat">
          <span className="adm-gb__stat-label">Vials ordered</span>
          <span className="adm-gb__stat-value">{panel.vials}</span>
          <span className="adm-gb__stat-sub">cancelled excluded</span>
        </li>
        <li>
          <button
            type="button"
            className="adm-gb__stat adm-gb__stat--action"
            data-tone={panel.unpaidOrders > 0 ? "warn" : "good"}
            onClick={openRound}
          >
            <span className="adm-gb__stat-label">Awaiting payment</span>
            <span className="adm-gb__stat-value">{panel.unpaidOrders}</span>
            <span className="adm-gb__stat-sub">{unpaidSub(panel, currency)}</span>
          </button>
        </li>
        {joins !== null && (
          <li>
            <button
              type="button"
              className="adm-gb__stat adm-gb__stat--action"
              data-tone={joins > 0 ? "bad" : "good"}
              onClick={onOpenJoins}
            >
              <span className="adm-gb__stat-label">Join requests</span>
              <span className="adm-gb__stat-value">{joins}</span>
              <span className="adm-gb__stat-sub">{joins > 0 ? "waiting for you" : "none waiting"}</span>
            </button>
          </li>
        )}
      </ul>

      {panel.kits.length > 0 && (
        <div className="adm-gb__kits">
          <h3 className="adm-gb__kits-title">{live ? "Kits to fill before close" : "Kit fill at close"}</h3>
          <ul className="adm-stock">
            {panel.kits.map((k) => (
              <li key={k.id} className="adm-stock__row">
                <div className="adm-stock__top">
                  <span className="adm-stock__name">{k.name}</span>
                  <span className="adm-gb__kit-note" data-tone={k.tone}>
                    {kitNote(k)}
                  </span>
                </div>
                <div className="adm-bar">
                  <div className="adm-bar__fill" data-tone={`kit-${k.tone}`} style={{ width: `${k.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel.untrackedProducts > 0 && (
        <p className="adm-panel__sub">
          {panel.untrackedProducts} {panel.untrackedProducts === 1 ? "product has" : "products have"} no kit
          size. Set &ldquo;Vials per kit&rdquo; on the product to track it here.
        </p>
      )}

      {panel.supplier && (
        <p className="adm-gb__supplier">
          {live ? "Supplier order so far: " : "Supplier order at close: "}
          <strong>
            {panel.supplier.fullKits} full {panel.supplier.fullKits === 1 ? "kit" : "kits"}
          </strong>
          {panel.supplier.partialKits > 0 &&
            ` + ${panel.supplier.partialKits} partial (${panel.supplier.shortBy} ${
              panel.supplier.shortBy === 1 ? "vial" : "vials"
            } short)`}
        </p>
      )}

      {!live && (
        <footer className="adm-gb__next">
          {next ? (
            <span>
              Next: <strong>{next.name}</strong>
              {next.startsAt ? ` opens ${shortDate(next.startsAt)}` : " is scheduled"}
            </span>
          ) : (
            <span>No round open right now.</span>
          )}
          <button type="button" className="adm-btn adm-btn--primary" onClick={onManage}>
            {next ? "Open Group Buys" : "Start next round"}
          </button>
        </footer>
      )}
    </section>
  );
}
