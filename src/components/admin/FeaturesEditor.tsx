"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, Lock } from "lucide-react";
import {
  FEATURE_GROUPS,
  type FeatureGroup,
  type FeatureKey,
} from "@/lib/features/catalog";
import { Button } from "@/components/ui/button";
import { saveFeaturesAction } from "@/actions/onboarding";

// `*.lvh.me` resolves in every browser (incl. Safari); `*.localhost` doesn't.
// ROOT carries its own dev port, e.g. "lvh.me:3100".
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

export type FeatureItem = {
  key: FeatureKey;
  label: string;
  description: string;
  group: FeatureGroup;
  lockedByPlan: boolean; // not in the tenant's plan ceiling
  enabled: boolean; // currently resolved on/off
};

type Props = {
  slug: string;
  name: string;
  planLabel: string;
  items: FeatureItem[];
};

export function FeaturesEditor({ slug, name, planLabel, items }: Props) {
  // Toggle state for plan-permitted features only; locked ones are never on.
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.key, i.enabled])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const grouped = useMemo(() => {
    const by = new Map<FeatureGroup, FeatureItem[]>();
    for (const g of FEATURE_GROUPS) by.set(g, []);
    for (const i of items) by.get(i.group)!.push(i);
    return FEATURE_GROUPS.map((g) => [g, by.get(g)!] as const).filter(([, list]) => list.length > 0);
  }, [items]);

  function toggle(key: string) {
    setState((s) => ({ ...s, [key]: !s[key] }));
    setSaved(false);
  }

  async function onSave() {
    setSaving(true);
    // Persist explicit booleans only for plan-permitted features.
    const map: Record<string, boolean> = {};
    for (const i of items) if (!i.lockedByPlan) map[i.key] = state[i.key];
    const res = await saveFeaturesAction(slug, map);
    setSaving(false);
    if ("ok" in res) setSaved(true);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/tenants/${slug}`}
            className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to tenant
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-bold">Features · {name}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Plan: <span className="font-medium text-foreground">{planLabel}</span> — defines which features are
            available. Toggle on/off within that ceiling; locked features need a plan upgrade.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`http://${slug}.${ROOT}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-sm text-accent underline underline-offset-2"
          >
            View storefront
            <ExternalLink className="h-3.5 w-3.5" aria-label="opens in a new tab" />
          </a>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : saved ? (<><Check className="h-4 w-4" aria-hidden /> Saved</>) : "Save features"}
          </Button>
        </div>
      </div>
      {saved && (
        <span role="status" className="sr-only">
          Feature settings saved.
        </span>
      )}

      <div className="mt-8 space-y-8">
        {grouped.map(([group, list]) => (
          <section key={group}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h2>
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border">
              {list.map((item) => {
                const on = !item.lockedByPlan && state[item.key];
                return (
                  <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {item.label}
                        {item.lockedByPlan && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-secondary-foreground">
                            <Lock className="h-3 w-3" aria-hidden /> Locked · upgrade plan
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`Toggle ${item.label}`}
                      disabled={item.lockedByPlan}
                      onClick={() => toggle(item.key)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        on ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
                          on ? "translate-x-[22px]" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
