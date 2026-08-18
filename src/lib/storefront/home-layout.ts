// The storefront's selectable HOME LAYOUTS — the single source of truth shared
// by the store-admin picker, the branding.config allow-list and resolveHomeLayout.
//
// The four values are not the same KIND of thing, and the difference is what
// resolveHomeLayout (./two-ways-home) encodes:
//
//   • "classic"   — the original hero → category chips → catalog scroll.
//   • "two-ways"  — a SOLD module (the on-hand + live group-buy split). The
//                   operator grant is the only way in; config can only opt OUT.
//   • "boutique"  — a LAYOUT CHOICE: imagery-led, category tiles, no grid on the
//                   home. Re-composes config every tenant already has, so the
//                   store owner picks it and no grant is involved.
//   • "editorial" — a LAYOUT CHOICE too: a left-rail storefront whose discovery
//                   is a typographic index of the tenant's categories rather
//                   than a tile grid. Same deal — owner-selectable, no grant.
//
// This module is deliberately tiny and dependency-free: every layout module
// imports the enum, so anything heavier here would pull the whole storefront
// view-model into the branding-update path.

export const HOME_LAYOUTS = ["classic", "two-ways", "boutique", "editorial"] as const;

export type HomeLayout = (typeof HOME_LAYOUTS)[number];

/** True only for the exact stored value — the picker writes it verbatim, so a
 *  near-miss ("Boutique", " boutique") is config drift and must fail closed. */
export function isBoutiqueLayout(value: unknown): boolean {
  return value === "boutique";
}

/** As above, for the editorial layout. */
export function isEditorialLayout(value: unknown): boolean {
  return value === "editorial";
}
