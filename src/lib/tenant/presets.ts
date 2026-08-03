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

/**
 * Sentinel for an `off` entry meaning "delete this key from the tenant's config"
 * rather than "write this value". A symbol, so it can never collide with a real
 * config value and can never survive a JSON write — the gate asserts it never
 * reaches a persisted config.
 */
export const PRESET_UNSET: unique symbol = Symbol("preset:unset");

/**
 * What REMOVING a preset writes, per structural key: either a literal value, or
 * PRESET_UNSET to delete the key so it falls back to the app default.
 *
 * DECLARED, never derived. "Off" is not uniformly `false` in this config, and
 * guessing wrong is silently destructive in both directions:
 *   • groupBuyAllowOnHand is read as `!== false` (storefront/on-hand-gate.ts) —
 *     absent means on-hand stays buyable, so writing `false` would PAUSE a
 *     store's normal sales: the opposite of switching the preset off.
 *   • showPageCOA is read as `!== false` (storefront/visibility.ts) — writing
 *     `false` is an explicit owner-off that would keep Lab Reports hidden even
 *     after the entitlement is granted again.
 *   • homeLayout is the mirror case: resolveHomeLayout reads an ABSENT key while
 *     entitled as two-ways, so removal must keep an explicit "classic" rather
 *     than delete it — the same trap documented on KGLOW_TWO_WAYS.config.
 *
 * Must cover exactly the keys in the preset's `config`, and may never name a key
 * from `defaults` — removal switches the shape off, it never touches the owner's
 * rules or copy. Both invariants are enforced by npm run test:tenant-presets.
 */
export type PresetOff = {
  [K in keyof PresetConfig]?: PresetConfig[K] | typeof PRESET_UNSET;
};

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
   * The inverse of `config` — what removing the preset writes for each key it
   * owns, so the shape is a switch rather than a one-way stamp. See PresetOff:
   * exhaustive over `config`, disjoint from `defaults`, and hand-declared
   * because an absent key is not uniformly "off" in this config.
   */
  off: PresetOff;
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
 * Reproduces the K Glow storefront shape: the group-buy manager and its analytics
 * slice in the store admin, the order-ratio floor requiring one bacteriostatic
 * water per peptide vial, the Lab Reports page, and on-hand products that stay
 * buyable while a round is live.
 *
 * The dual "two ways to order" HOME — the on-hand list beside the live group-buy
 * card — is DEFAULT OFF (config.homeLayout "classic"). The entitlement is still
 * granted, so switching it on is one config key, but stamping the preset never
 * changes a storefront's home layout on its own: an operator applying it to a
 * live store gets the group-buy machinery without a redesigned front page.
 *
 * Other values mirror the live k-glow tenant as of 2026-07-26 (groupBuyRules
 * enabled with a strict 1:1 ratio); the group-buy settings and copy are the
 * shared defaults, which is what k-glow renders today since it stores neither
 * key. Products are NOT part of this preset — each tenant keeps its own catalog;
 * only the storefront's behaviour is duplicated.
 */
const KGLOW_TWO_WAYS: TenantPreset = {
  id: KGLOW_TWO_WAYS_ID,
  name: "K Glow — Group buy + on-hand",
  tagline:
    "Group-buy rounds, ratio rules and Lab Reports on the classic home. The two-ways split home is included but off by default.",
  themeId: "kglow",
  config: {
    // The dual "two ways to order" home ships OFF: a stamped store opens on the
    // classic hero → catalog home, and the split layout is a deliberate second
    // step. It must be an explicit "classic" rather than an absent key, because
    // resolveHomeLayout reads absent-while-entitled as ON — leaving it out would
    // switch the split layout on for every tenant the preset touches.
    // Turn it on later with:
    //   npx tsx scripts/enable-two-ways-home.ts <slug> two-ways
    // No extra grant needed — GB_TWO_WAYS_HOME is already given below.
    homeLayout: "classic",
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
  // Switching K Glow's shape back off. Note only ONE key is written: the other
  // four are cleared, because their absent state already IS the off state and
  // writing `false` would say something stronger (and, for the first two, worse)
  // than "this store no longer runs the preset". See PresetOff.
  off: {
    // Kept, never cleared: an absent homeLayout while GB_TWO_WAYS_HOME is
    // entitled resolves to two-ways. The revoke below should make that moot, but
    // an explicit "classic" means the front page cannot flip even if the tenant
    // picks the grant up again from its plan.
    homeLayout: "classic",
    // Absent = on-hand buyable, which is the normal store. `false` would pause
    // on-hand sales — an active setting, not an off-switch.
    groupBuyAllowOnHand: PRESET_UNSET,
    // Absent = hidden; page.tsx projects both from the entitlement anyway.
    showAdminGroupBuy: PRESET_UNSET,
    showAnalyticsGroupBuys: PRESET_UNSET,
    // Absent = owner-on, gated by the STORE_COA grant we revoke. Clearing rather
    // than writing `false` keeps a future re-grant able to show Lab Reports.
    showPageCOA: PRESET_UNSET,
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
    FEATURES.GB_TWO_WAYS_HOME, // the two-ways home — granted, but left switched off
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

/** One thing applying or removing the preset will change — the confirm list. */
export type PresetChange =
  | { kind: "theme"; from: string; to: string }
  | { kind: "config"; key: string; from: unknown; to: unknown }
  /** A grant, emitted only by applying. */
  | { kind: "feature"; key: FeatureKey }
  /** A revoke, emitted only by removing. A separate member rather than a flag on
   *  "feature" so the existing apply UI, which filters on kind, cannot render a
   *  revoke as if it were a grant. */
  | { kind: "revoke"; key: FeatureKey };

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

// ── Removing ─────────────────────────────────────────────────────────────────

/** What the caller should persist to switch the shape off, plus the diff.
 *
 *  Deliberately carries NO themeId: removal leaves the tenant's look alone. A
 *  theme is a visual choice the owner may have kept on purpose, and there is no
 *  record of what preceded it — reverting it would be a guess. */
export type PresetRemoval = {
  config: Record<string, unknown>;
  /** Preset features the tenant currently has. Revoked, never merely un-granted. */
  featuresToRevoke: FeatureKey[];
  changes: PresetChange[];
};

/**
 * Undo a preset: the inverse of applyTenantPreset, and the other half of "the
 * store shape is a switch".
 *
 * Scope is deliberately narrow — it touches ONLY the structural keys the preset
 * owns (via `preset.off`) and the preset's entitlements. Left alone:
 *   • the theme, and every identity/secret key (forbidden to presets anyway);
 *   • the `defaults` blocks — group-buy rules, explainer copy, round defaults.
 *     Applying seeds those fill-if-absent precisely because owners edit them, so
 *     removal deleting them would destroy real work that apply promised to keep.
 *     A store that stops running group buys keeps its rules for when it resumes.
 *   • products, orders and COA reports, which were never part of the preset.
 *
 * ONE ASYMMETRY WORTH KNOWING: apply is additive (it grants only what is
 * missing), but remove revokes every one of the preset's features the tenant
 * currently has — including any it held BEFORE the preset was ever applied,
 * because nothing records which grants the preset itself introduced. That is why
 * the operator surface previews the revoke list before writing.
 *
 * Idempotent and non-mutating, like the applier: removing twice yields an empty
 * `changes` and an identical config, so a double-click is harmless.
 */
export function removeTenantPreset(
  current: TenantPresetTarget,
  preset: TenantPreset,
): PresetRemoval {
  const currentConfig = asConfig(current.config);
  const enabled = new Set(current.enabledFeatures ?? []);

  const changes: PresetChange[] = [];
  const config: Record<string, unknown> = { ...currentConfig };

  for (const [key, to] of Object.entries(preset.off) as [string, unknown][]) {
    // Removal only ever touches keys that are CURRENTLY SET. An absent key means
    // the preset is not in effect there, so there is nothing to undo — and
    // writing one anyway would be a change, not a removal. Concretely: without
    // this guard, removing the preset from a tenant that never had it would
    // stamp homeLayout "classic" and take down a two-ways home that tenant got
    // from its plan. It is also what makes a second removal a true no-op.
    if (!(key in currentConfig)) continue;

    const from = currentConfig[key];

    // Clear the key so it falls back to the app default.
    if (to === PRESET_UNSET) {
      delete config[key];
      changes.push({ kind: "config", key, from, to: undefined });
      continue;
    }

    // Reset the key to the preset's declared off value. After a plain apply this
    // is already equal (apply wrote "classic", off says "classic") so it is a
    // no-op; it bites when the owner has since switched the shape on, e.g.
    // homeLayout "two-ways" — removing the preset takes the split home with it.
    if (sameValue(from, to)) continue;
    config[key] = cloneValue(to);
    changes.push({ kind: "config", key, from, to: config[key] });
  }

  const featuresToRevoke = preset.features.filter((f) => enabled.has(f));
  for (const key of featuresToRevoke) changes.push({ kind: "revoke", key });

  return { config, featuresToRevoke, changes };
}
