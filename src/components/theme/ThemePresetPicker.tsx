"use client";

import {
  THEME_PRESETS,
  presetsByCategory,
  type ThemePreset,
  type ThemeTokens,
} from "@/lib/theme/presets";

/**
 * A tiny "website in a chip" preview for the theme selector — a mini header with
 * a brand dot + nav, a content card, and a primary/accent/success control stack,
 * all painted from the preset's own tokens so each card reads as the real theme.
 */
export function ThemeThumb({ t }: { t: ThemePreset }) {
  const c = (k: keyof ThemeTokens) => `hsl(${t.colors[k]})`;
  return (
    <div
      className="h-[52px] w-full overflow-hidden rounded-[6px] border"
      style={{ background: c("background"), borderColor: c("border") }}
      aria-hidden
    >
      {/* header */}
      <div className="flex items-center gap-1 px-1.5 py-1" style={{ background: c("card") }}>
        <span className="h-2 w-2 rounded-full" style={{ background: c("primary") }} />
        <span className="h-1 w-5 rounded-full" style={{ background: c("foreground"), opacity: 0.65 }} />
        <span className="ml-auto h-2 w-3.5 rounded-[2px]" style={{ background: c("primary") }} />
      </div>
      {/* body: content card + control stack */}
      <div className="flex gap-1 p-1.5">
        <div
          className="flex-1 rounded-[3px] p-1"
          style={{ background: c("card"), border: `1px solid ${c("border")}` }}
        >
          <span className="block h-1 w-8 rounded-full" style={{ background: c("foreground"), opacity: 0.85 }} />
          <span className="mt-1 block h-1 w-5 rounded-full" style={{ background: c("muted-foreground") }} />
          <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: c("accent") }} />
        </div>
        <div className="flex w-4 flex-col gap-1">
          <span className="h-2 rounded-[2px]" style={{ background: c("primary") }} />
          <span className="h-1.5 rounded-[2px]" style={{ background: c("accent") }} />
          <span className="h-1.5 rounded-[2px]" style={{ background: c("success") }} />
        </div>
      </div>
    </div>
  );
}

/**
 * The shared theme picker — category-grouped cards, each a {@link ThemeThumb}
 * preview + name + light/dark badge. Used by the BrandingEditor and the
 * new-tenant form so the selector stays identical everywhere.
 */
export function ThemePresetPicker({
  value,
  onChange,
  columns = 2,
}: {
  value: string;
  onChange: (id: string) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className="space-y-4">
      {presetsByCategory().map((group) => (
        <div key={group.category}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </h3>
          <div className={`grid gap-2 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {group.presets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.id)}
                aria-pressed={value === t.id}
                title={t.tagline}
                className={`rounded-[var(--radius)] border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  value === t.id ? "border-primary ring-2 ring-primary" : "border-border hover:bg-muted"
                }`}
              >
                <ThemeThumb t={t} />
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium">{t.name}</span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
                    style={{
                      background: `hsl(${t.colors.background})`,
                      color: `hsl(${t.colors["muted-foreground"]})`,
                      border: `1px solid hsl(${t.colors.border})`,
                    }}
                  >
                    {t.mode}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Total number of registered presets (for selector headings). */
export const THEME_COUNT = Object.keys(THEME_PRESETS).length;
