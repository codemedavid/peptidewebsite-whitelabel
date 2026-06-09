# Theme system

The white-label theme engine. A **theme preset** re-skins the entire storefront
(and the admin preview) — colors, fonts, radius, status colors, and an optional
brand gradient — by swapping a set of CSS custom properties at runtime. Tenants
layer their own role overrides on top.

## Files

| File | Role |
|---|---|
| `color.ts` | HEX ⇄ HSL conversion + WCAG contrast/luminance + `bestForeground()`. The one home for color math (no import cycle). |
| `presets.ts` | The registry: `ThemeTokens`/`ThemePreset` types, `THEME_CATEGORIES`, the `buildTheme()` factory, the 3 core presets, `THEME_SEEDS` (the new themes), and the assembled `THEME_PRESETS` / `DEFAULT_THEME` / `presetsByCategory()`. |
| `tokens.ts` | The tenant-editable **role** layer (main/accent/button/buttonText/background/surface/text), font registry, hero typography. Re-exports the color math. |
| `resolve-css-vars.ts` | Turns a tenant's `Branding` into inline CSS vars (`--background`, `--primary`, `--success`, `--brand-gradient-*`, …). Applied on the storefront wrapper. |
| `../../components/theme/ThemePresetPicker.tsx` | The shared, category-grouped selector + mini-preview thumbnail used by the BrandingEditor and the new-tenant form. |

## Token model

Each preset's `colors` is the full shadcn token set as **HSL channel triples**
(`"H S% L%"`, so they drop into `hsl(var(--token))`):

- Surfaces: `background`, `card`, `secondary`, `muted` (+ their `*-foreground`)
- Brand: `primary` (+`-foreground`), `accent` (+`-foreground`), `ring`
- Lines/fields: `border`, `input`
- **Status:** `destructive` (= error), `success`, `warning`, `info` (+ each `*-foreground`)

`resolve-css-vars.ts` emits every key as `--<token>`, so any token added to the
type is automatically available as a CSS var **and** (if registered in
`tailwind.config.ts`) as a utility class like `bg-success` / `text-info`.

## Adding a theme

1. Append a `ThemeSeed` to `THEME_SEEDS` in `presets.ts`. You only choose the
   meaningful colors as hex — `buildTheme()` derives the on-color foregrounds,
   the secondary/muted surfaces, `input`, and the focus `ring`:

   ```ts
   {
     id: "midnight-rose", name: "Midnight Rose", category: "dark", mode: "dark",
     tagline: "Deep plum with a rose signal",
     headingFont: "Sora", bodyFont: "Inter", radius: "0.75rem",
     primary: "#F43F5E", primaryForeground: "#1A0A10",
     accent: "#FB7185", accentForeground: "#1A0A10",
     background: "#120A0F", surface: "#1C1016", subtle: "#241620",
     text: "#F5E9EE", mutedText: "#B79FAA", border: "#3A2630",
     success: "#34D399", warning: "#FBBF24", info: "#60A5FA", error: "#FB7185",
     gradientFrom: null, gradientTo: null, // or two hex stops
   }
   ```

   `headingFont`/`bodyFont` must be keys of `FONT_REGISTRY` in `tokens.ts`.

2. Run the accessibility gate — it fails the build on any AA violation:

   ```
   npm run test:themes
   ```

   Body-text pairs must clear **4.5:1**; status fills use the **3:1** UI floor.

That's it — the new theme shows up, grouped under its category, in every selector
automatically (they all read `THEME_PRESETS` / `presetsByCategory()`).

## Backwards compatibility / migration

`Branding.themeId` is a free string. Unknown or legacy ids resolve to
`DEFAULT_THEME` (`clinical-white`), so existing tenants are unaffected and **no
data migration is required**. The three original presets keep their hand-tuned
triples verbatim; status colors were added without touching their existing tokens.
