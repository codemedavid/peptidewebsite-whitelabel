"use client";

// The Orders screen for a group-buy store: orders FILED per round. It opens on
// the folder list — the live round up top, then upcoming and recent rounds —
// and a click opens that round's orders (the full Orders table, scoped) with
// its reports one tap away. Stores without group buys never see any of this:
// the hub renders the flat AdminOrders exactly as before.
//
// Which folder is open lives in AdminPage, so opening an order and coming back
// returns to the same round instead of the top of the list.

import { useCallback, useEffect, useMemo, useState } from "react";

import { getGroupBuyDashboardAction, listOrderFoldersAction, type OrderFoldersResult } from "@/actions/group-buys";
import { filedOrderIds, type OrderFolder } from "@/lib/storefront/order-folders";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import type { ReportPrep } from "@/lib/storefront/group-buy-report";
import { formatMoney } from "@/lib/storefront/currency";
import { AdminOrders, type OrdersScope } from "./AdminOrders";
import { downloadCustomerWorkbook, downloadSupplierWorkbook } from "./supplier-workbook";
import type { Brand, Order } from "../types";
import "./order-folders.css";

/** null = the folder list; a round; or one of the two catch-all folders. */
export type OrdersFolderKey = null | "all" | "outside" | `round:${string}`;

type Loaded = Extract<OrderFoldersResult, { ok: true }>;
type Money = (n: number) => string;

const STATUS_LABEL: Record<OrderFolder["status"], string> = {
  active: "Live",
  scheduled: "Scheduled",
  draft: "Draft",
  closed: "Closed",
  cancelled: "Cancelled",
  archived: "Archived",
};

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dateRange(f: OrderFolder): string {
  const from = fmtDay(f.startsAt);
  const to = fmtDay(f.closedAt ?? f.endsAt);
  if (from && to) return `${from} – ${to}`;
  return from || to || `Created ${fmtDay(f.createdAt)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Closes in 2d 4h" — the live card's one piece of urgency. */
function closesIn(endsAt: string | null, now: number): string | null {
  if (!endsAt) return null;
  const left = new Date(endsAt).getTime() - now;
  if (Number.isNaN(left) || left <= 0) return null;
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / HOUR);
  if (d > 0) return `Closes in ${d}d ${h}h`;
  const m = Math.max(1, Math.floor((left % HOUR) / MINUTE));
  return h > 0 ? `Closes in ${h}h ${m}m` : `Closes in ${m}m`;
}

/** "8 products · Batch TR30-B2 · Oct 27 – Nov 4". The batch label falls back to
 *  the round name when unset, so it is left out rather than said twice. */
function roundMeta(f: OrderFolder): string {
  const batch = f.batchNumber && f.batchNumber !== f.name ? `Batch ${f.batchNumber}` : "";
  return [f.productName, batch, dateRange(f)].filter(Boolean).join(" · ");
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function TodoChips({ f }: { f: OrderFolder }) {
  if (!f.newOrders && !f.unpaidOrders) return <span className="ogb-chip ogb-chip--calm">All caught up</span>;
  return (
    <>
      {f.newOrders > 0 && <span className="ogb-chip ogb-chip--new">{f.newOrders} new</span>}
      {f.unpaidOrders > 0 && <span className="ogb-chip ogb-chip--unpaid">{f.unpaidOrders} unpaid</span>}
    </>
  );
}

function Chevron() {
  return (
    <svg className="ogb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Stats({ items }: { items: { label: string; value: string; tone?: "good" | "warn" }[] }) {
  return (
    <dl className="ogb-stats">
      {items.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd className={s.tone ? `is-${s.tone}` : undefined}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveCard({ f, money, onOpen }: { f: OrderFolder; money: Money; onOpen: () => void }) {
  const left = closesIn(f.endsAt, Date.now());
  const pct = f.maxVials ? Math.min(100, Math.round((f.vials / f.maxVials) * 100)) : null;
  return (
    <button type="button" className="ogb-live" onClick={onOpen}>
      <span className="ogb-live__top">
        <span className="ogb-live__badge">
          <span className="ogb-live__dot" aria-hidden /> Live now
        </span>
        {left && <span className="ogb-live__left">{left}</span>}
      </span>
      <span className="ogb-live__name">{f.name}</span>
      <span className="ogb-live__meta">
        {roundMeta(f)}
      </span>
      {pct !== null && (
        <span className="ogb-live__bar" role="img" aria-label={`${f.vials} of ${f.maxVials} vials`}>
          <span style={{ transform: `scaleX(${pct / 100})` }} />
          <em>
            {f.vials}/{f.maxVials} vials
          </em>
        </span>
      )}
      <Stats
        items={[
          { label: "Orders", value: f.totalOrders.toLocaleString() },
          { label: "Members", value: f.participants.toLocaleString() },
          { label: "Gross", value: money(f.grossIncome) },
          { label: "Collected", value: money(f.collected), tone: "good" },
        ]}
      />
      <span className="ogb-live__foot">
        <span className="ogb-chips"><TodoChips f={f} /></span>
        <span className="ogb-live__cta">Open orders →</span>
      </span>
    </button>
  );
}

function FolderRow({ f, money, onOpen }: { f: OrderFolder; money: Money; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="ogb-row" onClick={onOpen}>
        <span className="ogb-row__main">
          <span className="ogb-row__name">
            {f.name}
            <span className={`ogb-status ogb-status--${f.status}`}>{STATUS_LABEL[f.status]}</span>
          </span>
          <span className="ogb-row__meta">
            {dateRange(f)} · {plural(f.totalOrders, "order")} · {plural(f.participants, "member")}
          </span>
        </span>
        <span className="ogb-row__side">
          <span className="ogb-row__money">{money(f.grossIncome)}</span>
          <span className="ogb-chips"><TodoChips f={f} /></span>
        </span>
        <Chevron />
      </button>
    </li>
  );
}

function PlainRow({ title, meta, onOpen }: { title: string; meta: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="ogb-row" onClick={onOpen}>
        <span className="ogb-row__main">
          <span className="ogb-row__name">{title}</span>
          <span className="ogb-row__meta">{meta}</span>
        </span>
        <Chevron />
      </button>
    </li>
  );
}

function FolderSection({ title, folders, money, onOpen }: {
  title: string;
  folders: OrderFolder[];
  money: Money;
  onOpen: (f: OrderFolder) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <section className="ogb-section" aria-label={title}>
      <h2 className="ogb-section__title">{title}</h2>
      <ul className="ogb-list">
        {folders.map((f) => <FolderRow key={f.id} f={f} money={money} onOpen={() => onOpen(f)} />)}
      </ul>
    </section>
  );
}

/** The round's header above its scoped orders table: numbers + reports. */
function RoundHeader({ f, gb, canReport, money, onOpenDashboard }: {
  f: OrderFolder;
  gb: GroupBuy | undefined;
  canReport: boolean;
  money: Money;
  onOpenDashboard: (gb: GroupBuy) => void;
}) {
  const [prep, setPrep] = useState<ReportPrep | null>(null);
  const [busy, setBusy] = useState<"supplier" | "customer" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The workbook prep is built on demand: opening a round to tick off orders
  // shouldn't pay for a report nobody asked for.
  const download = async (kind: "supplier" | "customer") => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      let ready = prep;
      if (!ready) {
        const res = await getGroupBuyDashboardAction(f.id);
        if ("error" in res) throw new Error(res.error);
        ready = res.prep;
        setPrep(ready);
      }
      await (kind === "supplier" ? downloadSupplierWorkbook(ready) : downloadCustomerWorkbook(ready));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the report.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ogb-round">
      <p className="ogb-round__meta">
        <span className={`ogb-status ogb-status--${f.status}`}>{STATUS_LABEL[f.status]}</span>
        {roundMeta(f)}
      </p>
      <Stats
        items={[
          { label: "Orders", value: f.totalOrders.toLocaleString() },
          { label: "Members", value: f.participants.toLocaleString() },
          { label: "Gross", value: money(f.grossIncome) },
          { label: "Collected", value: money(f.collected), tone: "good" },
          { label: "Outstanding", value: money(f.outstanding), tone: f.outstanding > 0 ? "warn" : undefined },
        ]}
      />
      <div className="ogb-reports" role="group" aria-label="Reports for this group buy">
        <span className="ogb-reports__label">Reports</span>
        {canReport ? (
          <>
            <button type="button" className="ogb-report" onClick={() => void download("supplier")} disabled={!!busy}>
              <strong>{busy === "supplier" ? "Preparing…" : "Supplier order sheet"}</strong>
              <small>Products &amp; vials to order · no customer info</small>
            </button>
            <button type="button" className="ogb-report" onClick={() => void download("customer")} disabled={!!busy}>
              <strong>{busy === "customer" ? "Preparing…" : "Customer & payments list"}</strong>
              <small>Every buyer, order and balance · your copy</small>
            </button>
          </>
        ) : (
          <span className="ogb-reports__off">Excel reports aren&apos;t enabled for your account.</span>
        )}
        {gb && (
          <button type="button" className="ogb-report ogb-report--ghost" onClick={() => onOpenDashboard(gb)}>
            <strong>Full dashboard →</strong>
            <small>Analytics, per-customer totals, vials</small>
          </button>
        )}
      </div>
      {error && <p className="ogb-round__error" role="alert">{error}</p>}
    </div>
  );
}

function BackTitle({ onBack }: { onBack: () => void }) {
  return (
    <h1 className="admin-table__title">
      <a className="admin-table__title-back" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Dashboard
      </a>
      <span>Orders Management</span>
    </h1>
  );
}

function allFolders(data: Loaded): OrderFolder[] {
  const { live, upcoming, recent, archived } = data.folders;
  return [...live, ...upcoming, ...recent, ...archived];
}

export function AdminOrdersHub({
  brand,
  folder,
  onFolder,
  onBack,
  onView,
  onOpenDashboard,
}: {
  brand: Brand;
  folder: OrdersFolderKey;
  onFolder: (next: OrdersFolderKey) => void;
  onBack: () => void;
  onView: (o: Order) => void;
  onOpenDashboard: (gb: GroupBuy) => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const money = useCallback((n: number) => formatMoney(n, brand.currency), [brand.currency]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listOrderFoldersAction();
    if ("error" in res) setFailed(true);
    else {
      setFailed(false);
      setData(res);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scope = useMemo<OrdersScope | undefined>(() => {
    if (!data || !folder) return undefined;
    const toList = () => onFolder(null);
    const base = { backLabel: "Group buys", onBack: toList };
    if (folder === "all") return { ...base, title: "All orders", includes: () => true, showTrash: true };
    if (folder === "outside") {
      const filed = filedOrderIds(data.folders);
      return { ...base, title: "Outside a group buy", includes: (id: string) => !filed.has(id) };
    }
    const f = allFolders(data).find((x) => `round:${x.id}` === folder);
    if (!f) return undefined;
    const ids = new Set(f.orderIds);
    return {
      ...base,
      title: f.name,
      includes: (id: string) => ids.has(id),
      header: (
        <RoundHeader
          key={f.id}
          f={f}
          gb={data.groupBuys.find((g) => g.id === f.id)}
          canReport={data.canReport}
          money={money}
          onOpenDashboard={onOpenDashboard}
        />
      ),
    };
  }, [data, folder, money, onFolder, onOpenDashboard]);

  // A store with no rounds (or a load that failed) keeps the plain list —
  // orders must always be reachable; folders are only an organising layer.
  if (!loading && (failed || !data?.enabled)) {
    return <AdminOrders brand={brand} onBack={onBack} onView={onView} />;
  }
  if (folder && scope) return <AdminOrders brand={brand} onBack={onBack} onView={onView} scope={scope} />;

  const open = (f: OrderFolder) => onFolder(`round:${f.id}`);

  return (
    <div className="admin">
      <main className="admin__inner ogb">
        <div className="admin-table__head">
          <BackTitle onBack={onBack} />
          <button className="admin-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <p className="ogb-lede">Orders are filed by group buy. Pick one to see its orders and download its reports.</p>

        {!data ? (
          <div className="ogb-skeleton" aria-busy="true" aria-label="Loading group buys">
            <span /><span /><span />
          </div>
        ) : (
          <>
            {data.folders.live.length > 0 ? (
              <section className="ogb-section" aria-label="Live now">
                {data.folders.live.map((f) => <LiveCard key={f.id} f={f} money={money} onOpen={() => open(f)} />)}
              </section>
            ) : (
              <div className="ogb-nolive">No group buy is open right now — past rounds are below.</div>
            )}
            <FolderSection title="Upcoming" folders={data.folders.upcoming} money={money} onOpen={open} />
            <FolderSection title="Recent group buys" folders={data.folders.recent} money={money} onOpen={open} />
            {data.folders.archived.length > 0 && (
              <div className="ogb-archived">
                <button type="button" className="ogb-linkbtn" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? "Hide" : "Show"} archived ({data.folders.archived.length})
                </button>
                {showArchived && <FolderSection title="Archived" folders={data.folders.archived} money={money} onOpen={open} />}
              </div>
            )}
            <section className="ogb-section" aria-label="Other orders">
              <h2 className="ogb-section__title">Other orders</h2>
              <ul className="ogb-list">
                <PlainRow title="Outside a group buy" meta="On-hand orders and anything placed between rounds" onOpen={() => onFolder("outside")} />
                <PlainRow title="All orders" meta="Every order in one list, plus the trash" onOpen={() => onFolder("all")} />
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
