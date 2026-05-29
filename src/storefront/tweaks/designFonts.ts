// The full set of selectable storefront fonts, loaded only where the branding
// font-picker is shown (the admin tweaks panel / platform branding editor) so
// the public storefront pays only for the tenant's actually-configured fonts.
// React 19 hoists a <link rel="stylesheet" href={DESIGN_FONTS_HREF}> into <head>
// wherever it's rendered.
//
// Derived from FONT_REGISTRY (the single source of truth) so the picker always
// previews exactly the families the storefront can render — and via the same
// weight-safe builder, so the request never 400s on a missing weight.
import { FONT_OPTIONS, googleFontsUrl } from "@/lib/theme/tokens";

export const DESIGN_FONTS_HREF = googleFontsUrl(...FONT_OPTIONS);
