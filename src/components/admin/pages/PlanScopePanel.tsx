"use client";

// Read-only "Functional scope" panel for a plan card on the Plans & Billing page.
// Shows what the package ACTUALLY grants — derived live from the feature catalog
// (src/lib/features/catalog.ts via getPlanScope) — so the operator can read off
// each package's true functionality, distinct from the editable marketing bullets.

import { Ic } from "@/components/admin/shell/primitives";
import { FEATURE_META } from "@/lib/features/catalog";
import type { PlanScope, ScopeFeature } from "@/lib/features/plan-scope";

const STATE_ICON = {
  included: Ic.Check,
  "included-needs-addon": Ic.Lock,
  addon: Ic.Sparkles,
} as const;

function FeatureRow({ feature }: { feature: ScopeFeature }) {
  const Icon = STATE_ICON[feature.state];
  const dim = feature.state !== "included";
  return (
    <li
      className="row"
      title={feature.description}
      style={{ gap: 8, alignItems: "center", padding: "3px 0", opacity: dim ? 0.82 : 1 }}
    >
      <Icon
        style={{
          width: 13,
          height: 13,
          flex: "0 0 auto",
          color: feature.state === "included" ? "var(--accent)" : "var(--muted, #888)",
        }}
      />
      <span style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{feature.label}</span>
      {feature.state === "included-needs-addon" && feature.dependsOn && (
        <span className="badge badge-warn" style={{ fontSize: 10.5 }}>
          needs {FEATURE_META[feature.dependsOn].label}
        </span>
      )}
      {feature.state === "addon" && (
        <span className="badge" style={{ fontSize: 10.5 }}>
          Add-on
        </span>
      )}
    </li>
  );
}

export function PlanScopePanel({ scope }: { scope: PlanScope }) {
  return (
    <details className="scope-panel" style={{ marginTop: 12 }}>
      <summary
        className="row"
        style={{ justifyContent: "space-between", cursor: "pointer", gap: 8, listStyle: "none" }}
      >
        <span className="field-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Ic.ChevronDown style={{ width: 13, height: 13 }} /> Functional scope
        </span>
        <span className="tnum muted" style={{ fontSize: 11.5 }}>
          {scope.includedCount} included · {scope.addonCount} add-ons
        </span>
      </summary>

      <div style={{ marginTop: 8 }}>
        {scope.groups.map((g) => (
          <div key={g.group} style={{ marginBottom: 10 }}>
            <div
              className="muted"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}
            >
              {g.group}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {g.features.map((f) => (
                <FeatureRow key={f.key} feature={f} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
