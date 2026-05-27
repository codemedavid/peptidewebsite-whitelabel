// The full set of selectable storefront fonts, loaded only where the branding
// font-picker is shown (the admin tweaks panel / platform branding editor) so
// the public storefront pays only for the tenant's actually-configured fonts.
// React 19 hoists a <link rel="stylesheet" href={DESIGN_FONTS_HREF}> into <head>
// wherever it's rendered.
export const DESIGN_FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  [
    "family=Playfair+Display:ital,wght@0,400..700;1,400..600",
    "family=DM+Serif+Display:ital@0;1",
    "family=Cormorant+Garamond:ital,wght@0,400..600;1,400..600",
    "family=Lora:ital,wght@0,400..600;1,400..600",
    "family=Inter:wght@400..700",
    "family=DM+Sans:wght@400..700",
    "family=Manrope:wght@400..700",
    "family=Work+Sans:wght@400..600",
    "family=IBM+Plex+Sans:wght@400..600",
  ].join("&") +
  "&display=swap";
