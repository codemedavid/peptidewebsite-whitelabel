"use client";

// Store-shape picker for the Create Tenant flow. Sits alongside ThemePresetPicker:
// the theme picks how the store LOOKS, this picks how it WORKS — which storefront
// layout and which modules the tenant is provisioned with.
//
// Selection reaches the form through a hidden `presetId` input (the same shape
// ThemePresetPicker uses for `themeId`), so it stays inside the existing
// uncontrolled <form action={createTenantAction}> with no extra plumbing.

import { Check } from "lucide-react";
import { TENANT_PRESET_LIST, type TenantPreset } from "@/lib/tenant/presets";
import { FEATURE_META } from "@/lib/features/catalog";

type Props = {
  /** Selected preset id, or "" for the plain single-catalog storefront. */
  value: string;
  onChange: (presetId: string) => void;
};

/** Human labels for the entitlements a preset grants ("what you get"). */
function grantLabels(preset: TenantPreset): string[] {
  return preset.features.map((key) => FEATURE_META[key]?.label ?? key);
}

function Option({
  selected,
  title,
  tagline,
  grants,
  onSelect,
}: {
  selected: boolean;
  title: string;
  tagline: string;
  grants?: string[];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/50 hover:bg-muted/40"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{tagline}</span>
      {grants && grants.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {grants.map((g) => (
            <span
              key={g}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {g}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

export function TenantPresetPicker({ value, onChange }: Props) {

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Option
          selected={value === ""}
          title="Standard storefront"
          tagline="One catalog, classic home. Modules granted later as needed."
          onSelect={() => onChange("")}
        />
        {TENANT_PRESET_LIST.map((p) => (
          <Option
            key={p.id}
            selected={value === p.id}
            title={p.name}
            tagline={p.tagline}
            grants={grantLabels(p)}
            onSelect={() => onChange(p.id)}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A preset provisions the storefront layout, module settings and entitlements. Products are
        never copied — the new tenant starts with its own empty catalog.
      </p>
      <input type="hidden" name="presetId" value={value} />
    </div>
  );
}
