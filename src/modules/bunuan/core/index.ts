/**
 * Bunuan core — pure, client-safe rules for the kit-fill phase (no DB, no
 * Next). Kit identity, sizes and the counting rule live in
 * `@/lib/storefront/gb-kits`; stages in `@/lib/storefront/gb-stage`.
 */

export * from "./rules";
export * from "./counter";
export * from "./stage-sync";
