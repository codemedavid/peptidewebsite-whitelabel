"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  Handshake,
  Layers,
  Lock,
  Package,
  Plug,
  ShoppingCart,
  Users,
  Zap,
} from "lucide-react";
import {
  FEATURE_GROUPS,
  type FeatureGroup,
  type FeatureKey,
} from "@/lib/features/catalog";
import {
  groupBodyId,
  isGroupOpen,
  toggleGroupOpen,
  type OpenGroups,
} from "@/components/admin/feature-disclosure";
import { saveFeaturesAction } from "@/actions/onboarding";

// `*.lvh.me` resolves in every browser (incl. Safari); `*.localhost` doesn't.
// ROOT carries its own dev port, e.g. "lvh.me:3100".
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

const GROUP_ICONS: Record<FeatureGroup, React.ReactNode> = {
  Site: <Globe size={16} aria-hidden />,
  Catalog: <Package size={16} aria-hidden />,
  Ecommerce: <ShoppingCart size={16} aria-hidden />,
  Reseller: <Handshake size={16} aria-hidden />,
  "Sales Analytics": <BarChart3 size={16} aria-hidden />,
  "Group Buy": <Users size={16} aria-hidden />,
  Notifications: <Bell size={16} aria-hidden />,
  "Growth & Automation": <Zap size={16} aria-hidden />,
  Integrations: <Plug size={16} aria-hidden />,
};

export type FeatureItem = {
  key: FeatureKey;
  label: string;
  description: string;
  group: FeatureGroup;
  lockedByPlan: boolean; // not in the tenant's plan ceiling
  requiredPlanLabel: string | null; // lowest plan that unlocks a locked feature
  enabled: boolean; // currently resolved on/off
};

type Props = {
  slug: string;
  name: string;
  planLabel: string;
  items: FeatureItem[];
  /** Extra cards rendered below the feature groups (e.g. Group Buy Settings). */
  children?: React.ReactNode;
};

type SaveStatus = "saved" | "saving" | "error";
type Filter = "all" | "on" | "off";

function Toggle({
  on,
  small,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  small?: boolean;
  disabled?: boolean;
  label: string;
  onChange?: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`ftr-tgl${small ? " sm" : ""}${on ? " on" : ""}`}
    />
  );
}

export function FeaturesEditor({ slug, name, planLabel, items, children }: Props) {
  // Toggle state for plan-permitted features only; locked ones are never on.
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.key, i.enabled])),
  );
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [filter, setFilter] = useState<Filter>("all");
  // Modules collapse by default; the All/On/Off filter force-opens them so a
  // collapsed group never hides a matching row (see feature-disclosure.ts).
  const [openGroups, setOpenGroups] = useState<OpenGroups>({});

  // Autosave: every toggle schedules a debounced full-map save; the generation
  // counter keeps a slow stale response from overwriting a newer one's status.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function persist() {
    const gen = ++generation.current;
    setStatus("saving");
    try {
      // Persist explicit booleans only for plan-permitted features.
      const map: Record<string, boolean> = {};
      for (const i of items) if (!i.lockedByPlan) map[i.key] = stateRef.current[i.key];
      const res = await saveFeaturesAction(slug, map);
      if (gen !== generation.current) return; // a newer save is in flight
      setStatus("ok" in res ? "saved" : "error");
    } catch {
      if (gen === generation.current) setStatus("error");
    }
  }

  function scheduleSave() {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 700);
  }

  function toggle(key: string) {
    setState((s) => ({ ...s, [key]: !s[key] }));
    scheduleSave();
  }

  function toggleOpen(group: FeatureGroup) {
    setOpenGroups((g) => toggleGroupOpen(g, group));
  }

  function setGroup(list: FeatureItem[], value: boolean) {
    setState((s) => {
      const next = { ...s };
      for (const i of list) if (!i.lockedByPlan) next[i.key] = value;
      return next;
    });
    scheduleSave();
  }

  const grouped = useMemo(() => {
    const by = new Map<FeatureGroup, FeatureItem[]>();
    for (const g of FEATURE_GROUPS) by.set(g, []);
    for (const i of items) by.get(i.group)!.push(i);
    return FEATURE_GROUPS.map((g) => [g, by.get(g)!] as const).filter(([, list]) => list.length > 0);
  }, [items]);

  const unlocked = items.filter((i) => !i.lockedByPlan);
  const onCount = unlocked.filter((i) => state[i.key]).length;
  const lockedCount = items.length - unlocked.length;
  const pct = unlocked.length ? Math.round((onCount / unlocked.length) * 100) : 0;

  const matches = (i: FeatureItem) => {
    if (filter === "all") return true;
    const on = !i.lockedByPlan && state[i.key];
    return filter === "on" ? on : !on;
  };

  return (
    <div className="page-inner ftr">
      <Link href={`/tenants/${slug}`} className="ftr-back">
        <ArrowLeft size={15} aria-hidden /> Back to tenant
      </Link>

      <div className="ftr-phead">
        <div>
          <h1 className="ftr-title">
            <span>Features · {name}</span>
            <span className="ftr-plan-chip">
              <Layers size={12} aria-hidden />
              {planLabel} plan
            </span>
          </h1>
          <p className="ftr-sub">
            Defines which storefront features are available to this tenant. Toggle within the plan&rsquo;s
            ceiling — locked features need a plan upgrade.
          </p>
        </div>
        <div className="ftr-phead-right">
          {status === "saving" && (
            <span className="ftr-save-pill saving" role="status">
              <span className="ftr-dot" aria-hidden /> Saving…
            </span>
          )}
          {status === "saved" && (
            <span className="ftr-save-pill" role="status">
              <Check size={14} aria-hidden /> All changes saved
            </span>
          )}
          {status === "error" && (
            <button type="button" className="ftr-save-pill error" role="alert" onClick={persist}>
              Save failed — retry
            </button>
          )}
          <a href={`http://${slug}.${ROOT}`} target="_blank" rel="noreferrer" className="ftr-vstore">
            View storefront <ExternalLink size={14} aria-label="opens in a new tab" />
          </a>
        </div>
      </div>

      <div className="ftr-summary">
        <div className="ftr-sum-stat">
          <span className="ftr-sum-num">
            {onCount}
            <small> / {unlocked.length}</small>
          </span>
          <span className="ftr-sum-lbl">Features on</span>
        </div>
        <div className="ftr-sum-div" />
        <div className="ftr-sum-stat">
          <span className="ftr-sum-num">{lockedCount}</span>
          <span className="ftr-sum-lbl">Plan-locked</span>
        </div>
        <div className="ftr-sum-div" />
        <div className="ftr-sum-bar-wrap">
          <div className="ftr-sum-bar-top">
            <span>Across {grouped.length} groups</span>
            <span>{pct}% enabled</span>
          </div>
          <div className="ftr-sum-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="ftr-seg" role="group" aria-label="Filter features">
          {(["all", "on", "off"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "on" : undefined}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "on" ? "On" : "Off"}
            </button>
          ))}
        </div>
      </div>

      {grouped.map(([group, list]) => {
        const groupUnlocked = list.filter((i) => !i.lockedByPlan);
        const groupOn = groupUnlocked.filter((i) => state[i.key]).length;
        const allOn = groupUnlocked.length > 0 && groupOn === groupUnlocked.length;
        const visible = list.filter(matches);
        if (visible.length === 0) return null;
        const open = isGroupOpen({ group, openGroups, filter });
        const bodyId = groupBodyId(group);
        return (
          <section key={group} className="ftr-gcard">
            <header className="ftr-ghead">
              <button
                type="button"
                className="ftr-gtoggle"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => toggleOpen(group)}
              >
                <span className="ftr-gicon">{GROUP_ICONS[group]}</span>
                <h2 className="ftr-gtitle">{group}</h2>
                <span className="ftr-count-pill">
                  <span className="ftr-mini" aria-hidden>
                    <i style={{ width: groupUnlocked.length ? `${(groupOn / groupUnlocked.length) * 100}%` : 0 }} />
                  </span>
                  {groupOn} of {groupUnlocked.length} on
                </span>
                <ChevronDown className="ftr-gchevron" data-open={open} size={18} aria-hidden />
              </button>
              {groupUnlocked.length > 0 && (
                <span className="ftr-enable-all">
                  Enable all
                  <Toggle
                    small
                    on={allOn}
                    label={`Enable all in ${group}`}
                    onChange={() => setGroup(list, !allOn)}
                  />
                </span>
              )}
            </header>
            <div id={bodyId} role="region" aria-label={group} hidden={!open} className="ftr-gbody">
            {visible.map((item) => {
              const on = !item.lockedByPlan && state[item.key];
              return (
                <div key={item.key} className={`ftr-row${item.lockedByPlan ? " locked" : ""}`}>
                  <div className="ftr-fmain">
                    <div className="ftr-fname">{item.label}</div>
                    <div className="ftr-fdesc">{item.description}</div>
                  </div>
                  {item.lockedByPlan ? (
                    <>
                      <span className="ftr-lock-chip">
                        <Lock size={12} aria-hidden />
                        {item.requiredPlanLabel ?? "Upgrade"}
                      </span>
                      <Link href={`/tenants/${slug}`} className="ftr-upg">
                        Upgrade
                      </Link>
                    </>
                  ) : (
                    <Toggle on={on} label={`Toggle ${item.label}`} onChange={() => toggle(item.key)} />
                  )}
                </div>
              );
            })}
            </div>
          </section>
        );
      })}

      {children}
    </div>
  );
}
