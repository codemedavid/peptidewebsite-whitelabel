// TENANT PRESETS — "stamp a whole store setup onto a tenant" as declarative data.
//
// The white-label problem this solves: K Glow's "two ways to order" storefront
// (an on-hand catalog that ships now + a live group buy at a lower price) was
// assembled by hand — four one-off seed scripts, nine feature grants clicked in
// admin → Features, a theme picked from the dropdown, and a set of store-admin
// edits for the group-buy rules and copy. None of it was reusable, so every
// additional tenant that wanted the same shape meant another copy-pasted
// scripts/configure-<slug>.ts. This module makes the setup a value: a preset is
// { themeId, config, features }, and one pure applier merges it onto whatever
// the tenant already has.
//
// Shape deliberately mirrors the house preset pattern (lib/theme/presets.ts's
// ThemeSeed registry, storefront/cardDesign.ts's CardPreset): a compact hand-
// authored record, a `Record<id, preset>` registry, a `get*` lookup.
//
// Two hard rules, both enforced by npm run test:tenant-presets:
//   1. ADDITIVE ONLY. Applying a preset never revokes an entitlement and never
//      overwrites a config key the preset does not explicitly own. A live tenant
//      keeps its name, logo, colors, catalog, COA reports and secrets.
//   2. NOTHING FORBIDDEN. A preset may not write tenant identity, owner secrets,
//      or server-projected keys (see PRESET_FORBIDDEN_KEYS) — the first two are
//      per-tenant by definition, the third is recomputed per request and would
//      be stale garbage the moment it were persisted.
//
// Pure + JSON-safe (no DB, no React, no next/*) so the applier is testable
// offline and can be reused by the create-tenant transaction, the apply-to-
// existing-tenant action, and any future CLI.

import { FEATURES, type FeatureKey } from "../features/catalog";
import { GB_CONTENT_DEFAULTS } from "../storefront/gb-content";
import { GROUP_BUY_SETTINGS_DEFAULTS } from "../storefront/group-buy";
import { DEFAULT_GROUP_BUY_RULES, DEFAULT_RATIO } from "../storefront/group-buy-rules";
import type { Brand } from "../../storefront/types";

// ── Forbidden keys ───────────────────────────────────────────────────────────

/**
 * Config keys a preset may never write, in three groups:
 *   • secrets   — per-tenant credentials; copying them between stores would hand
 *                 one tenant's owner password to another store.
 *   • identity  — what makes the tenant *that* brand (name, logo, palette,
 *                 fonts) plus the owner's own content collections. A preset
 *                 changes how a store WORKS, never who it IS.
 *   • projected — keys page.tsx computes per request from entitlements and live
 *                 DB rows. They exist on Brand for the client's benefit and are
 *                 never stored; persisting one freezes a stale value.
 */
const FORBIDDEN_KEYS = [
  // secrets
  "adminPassword",
  "resellerAccessCode",
  "accessGate",
  // identity — brand
  "name",
  "logoUrl",
  "logoCurve",
  "main",
  "accent",
  "button",
  "buttonText",
  "background",
  "surface",
  "text",
  "headerBg",
  "headerText",
  "borderColor",
  "borderWidth",
  "headingFont",
  "bodyFont",
  "buttonFont",
  "priceFont",
  "currency",
  "industry",
  "metaDescription",
  "defaultProductImage",
  // identity — the owner's own content
  "coaReports",
  "protocols",
  "faqGroups",
  "categories",
  "promoCodes",
  "paymentMethods",
  "couriers",
  "shippingLocations",
  "contactChannels",
  "orderNotifications",
  "orderNumberFormat",
  "cardDesign",
  "cardTemplates",
  "nav",
  "banner",
  "noticeModal",
  // server-projected — recomputed per request, never stored
  "groupBuyCaps",
  "groupBuyGate",
  "groupBuyBanner",
  "trial",
  "subscription",
  "bestSellerCounts",
  "newModules",
  "staffLoginActive",
  "adminFeeEntitled",
  "trackNoteEntitled",
  "coaEntitled",
  "protocolsEntitled",
  "calculatorEntitled",
  "reviewsEntitled",
] as const;

type ForbiddenKey = (typeof FORBIDDEN_KEYS)[number];

/** Runtime blocklist — the gate asserts no preset's config intersects it. */
export const PRESET_FORBIDDEN_KEYS: ReadonlySet<string> = new Set(FORBIDDEN_KEYS);

/**
 * The config a preset is allowed to declare: stored Brand keys minus the
 * forbidden ones. Typed as an Omit so a preset that reaches for `logoUrl` or
 * `groupBuyCaps` fails to compile rather than failing the gate at test time.
 */
export type PresetConfig = Omit<Partial<Brand>, ForbiddenKey>;

// ── Preset shape ─────────────────────────────────────────────────────────────

export type TenantPreset = {
  /** Stable id — persisted in change logs and passed by the admin UI. */
  id: string;
  /** Operator-facing label in the preset picker. */
  name: string;
  /** One-line description of the store shape this produces. */
  tagline: string;
  /** Theme preset applied to Branding.themeId (see lib/theme/presets.ts). */
  themeId: string;
  /**
   * Structural keys the preset OWNS and always overwrites — the layout and
   * module switches that define the store shape. Keep these to scalars the
   * operator can eyeball in the confirm diff.
   */
  config: PresetConfig;
  /**
   * Owner-editable blocks the preset only SEEDS: written when the tenant has no
   * value, left strictly alone when it does. Group-buy rules, explainer copy and
   * round defaults are edited by store owners in their own admin, so replacing
   * them on a live store would silently destroy real work — and "apply preset"
   * is advertised as additive. New tenants still get a complete setup because
   * their config is empty.
   */
  defaults?: PresetConfig;
  /**
   * Entitlements granted on apply. Every key must be OPERATOR_GRANTABLE so a
   * preset can never hand a tenant something the operator could not grant by
   * hand — applying is a shortcut for clicking, not a plan-ceiling bypass.
   */
  features: readonly FeatureKey[];
};

// ── The K Glow "two ways to order" preset ────────────────────────────────────

export const KGLOW_TWO_WAYS_ID = "kglow-two-ways";

/**
 * Reproduces the K Glow storefront shape: the two-ways home (on-hand list that
 * ships now + the live group-buy card at the group price), the group-buy manager
 * and its analytics slice in the store admin, the order-ratio floor requiring one
 * bacteriostatic water per peptide vial, and the Lab Reports page.
 *
 * Values mirror the live k-glow tenant as of 2026-07-26 (homeLayout "two-ways",
 * groupBuyRules enabled with a strict 1:1 ratio); the group-buy settings and copy
 * are the shared defaults, which is what k-glow renders today since it stores
 * neither key. Products are NOT part of this preset — each tenant keeps its own
 * catalog; only the storefront's behaviour and layout are duplicated.
 */
const KGLOW_TWO_WAYS: TenantPreset = {
  id: KGLOW_TWO_WAYS_ID,
  name: "K Glow — Two ways to order",
  tagline: "On-hand catalog that ships now, plus a live group buy at a lower price.",
  themeId: "kglow",
  config: {
    // The storefront home becomes the on-hand + group-buy split. Inert unless
    // GB_TWO_WAYS_HOME is also granted below (resolveHomeLayout: the grant is
    // the only way in, config can only opt out) — so the two must ship together.
    homeLayout: "two-ways",
    // On-hand products stay buyable while a round is live. K Glow's whole pitch
    // is the CHOICE between the two paths, so pausing on-hand would defeat it.
    groupBuyAllowOnHand: true,
    // Store-admin surfaces for the module the preset grants.
    showAdminGroupBuy: true,
    showAnalyticsGroupBuys: true,
    // Lab Reports page, matching the STORE_COA grant below. The tenant supplies
    // its own reports — coaReports is forbidden, so nothing is copied over.
    showPageCOA: true,
  },
  // Seeded only when absent — a store already running group buys keeps its own
  // rules, copy and round defaults.
  defaults: {
    // Round defaults the "New group buy" form prefills from.
    groupBuySettings: { ...GROUP_BUY_SETTINGS_DEFAULTS },
    // "How group buys work" explainer + the live-round terms line.
    groupBuyContent: {
      ...GB_CONTENT_DEFAULTS,
      steps: [...GB_CONTENT_DEFAULTS.steps],
    },
    // Order Ratio Control: one bac water per peptide vial, enforced strictly in
    // both the cart and at checkout — the rule that makes a bulk round shippable.
    groupBuyRules: {
      ...DEFAULT_GROUP_BUY_RULES,
      enabled: true,
      minOrder: { ...DEFAULT_GROUP_BUY_RULES.minOrder },
      bacWater: { ...DEFAULT_GROUP_BUY_RULES.bacWater },
      ratio: { ...DEFAULT_RATIO, enabled: true, mode: "strict", bacWaterPerPeptide: 1 },
      validation: { ...DEFAULT_GROUP_BUY_RULES.validation },
    },
  },
  features: [
    FEATURES.GB_TWO_WAYS_HOME, // the two-ways home itself
    FEATURES.GB_MODULE, // group-buy manager, live banner, order attribution
    FEATURES.GB_RULES, // the ratio / min-order engine configured above
    FEATURES.STORE_COA, // Lab Reports page + its store-admin manager
  ],
};

// ── Registry ─────────────────────────────────────────────────────────────────

/** Every preset, in display order. Add new store shapes here — not as another
 *  scripts/configure-<slug>.ts. */
export const TENANT_PRESET_LIST: readonly TenantPreset[] = [KGLOW_TWO_WAYS];

export const TENANT_PRESETS: Record<string, TenantPreset> = Object.fromEntries(
  TENANT_PRESET_LIST.map((p) => [p.id, p]),
);

/** Look a preset up by id. Null for unknown/blank ids — callers take untrusted
 *  input (a form field, a script argv) and must not throw on a typo. */
export function getTenantPreset(id: string | null | undefined): TenantPreset | null {
  if (!id) return null;
  return TENANT_PRESETS[id] ?? null;
}

// ── Applying ─────────────────────────────────────────────────────────────────

/** One thing applying the preset will change — the operator's confirm list. */
export type PresetChange =
  | { kind: "theme"; from: string; to: string }
  | { kind: "config"; key: string; from: unknown; to: unknown }
  | { kind: "feature"; key: FeatureKey };

/** The tenant's current state. Every field is optional/untrusted: callers read
 *  it straight out of a Branding row whose `config` is an untyped Json column. */
export type TenantPresetTarget = {
  themeId?: string | null;
  config?: unknown;
  /** Feature keys the tenant already resolves to (plan ∪ overrides). */
  enabledFeatures?: readonly string[];
};

/** What the caller should persist, plus the diff that produced it. */
export type PresetApplication = {
  themeId: string;
  config: Record<string, unknown>;
  /** Preset features the tenant does not already have. Additive only. */
  featuresToGrant: FeatureKey[];
  changes: PresetChange[];
};

/** Branding.config is an untyped Json column — coerce anything else to {}. */
function asConfig(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/** Structural equality over JSON-safe config values. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Deep-clone a preset value before it lands in the tenant's config, so the
 * persisted object never aliases the shared module-level preset. Config is JSON
 * by definition, so a JSON round-trip is both sufficient and the same
 * normalization Prisma applies on write.
 */
function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Merge a preset onto a tenant's current branding state.
 *
 * Additive and non-destructive: the returned config is the tenant's existing
 * config with ONLY the preset's own keys overwritten, so identity, secrets and
 * owner content survive untouched. Features are a grant list, never a revoke
 * list. The input is never mutated; the result is always a fresh object.
 *
 * Idempotent: applying to the output of a previous application yields an empty
 * `changes` array and an identical config — which is what makes it safe to wire
 * behind a button an operator may double-click.
 */
export function applyTenantPreset(
  current: TenantPresetTarget,
  preset: TenantPreset,
): PresetApplication {
  const currentConfig = asConfig(current.config);
  const currentTheme = current.themeId ?? "";
  const enabled = new Set(current.enabledFeatures ?? []);

  const changes: PresetChange[] = [];

  if (currentTheme !== preset.themeId) {
    changes.push({ kind: "theme", from: currentTheme, to: preset.themeId });
  }

  const config: Record<string, unknown> = { ...currentConfig };

  // Structural keys: the preset owns them, so they always win.
  for (const [key, to] of Object.entries(preset.config)) {
    const from = currentConfig[key];
    if (sameValue(from, to)) continue;
    config[key] = cloneValue(to);
    changes.push({ kind: "config", key, from, to: config[key] });
  }

  // Owner-editable blocks: seed only into a gap. Anything the tenant already
  // holds — however customised — is left exactly as it is.
  for (const [key, to] of Object.entries(preset.defaults ?? {})) {
    if (currentConfig[key] !== undefined) continue;
    config[key] = cloneValue(to);
    changes.push({ kind: "config", key, from: undefined, to: config[key] });
  }

  const featuresToGrant = preset.features.filter((f) => !enabled.has(f));
  for (const key of featuresToGrant) changes.push({ kind: "feature", key });

  return { themeId: preset.themeId, config, featuresToGrant, changes };
}
