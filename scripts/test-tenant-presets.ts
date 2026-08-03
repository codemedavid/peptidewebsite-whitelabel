// RED/GREEN gate for the TENANT PRESET system — the reusable "duplicate the
// K Glow store" mechanism (src/lib/tenant/presets.ts).
//
//   npm run test:tenant-presets
//
// Why this exists: K Glow's "two ways to order" setup (on-hand catalog + live
// group buy) was assembled by hand — 4 one-off seed scripts, 9 manual feature
// grants, a manual theme pick and a pile of store-admin edits. Nothing about it
// was reusable, so the 16th tenant that wants group buy + on-hand meant a 16th
// copy-pasted scripts/configure-*.ts. A preset turns that into declarative data
// plus one pure applier, so the operator can stamp the whole setup onto a new OR
// an existing tenant from the platform admin.
//
// Journeys covered
//   J1 Operator creates a new tenant already configured like K Glow.
//   J2 Operator applies the preset to an EXISTING live tenant without wiping
//      that tenant's own identity (name, logo, colors, catalog, COA reports).
//   J3 Operator previews exactly which config keys / features will change.
//   J4 Developer adds a new preset as data, not another configure-*.ts script.
//   J5 Operator turns the stamped shape back OFF — the preset is a switch, not a
//      one-way stamp — without destroying the owner's rules, copy, catalog or
//      theme, and without silently flipping an absent-means-ON key the wrong way.
//
// Pure: no DB, no React, no network. The applier is a total function over
// (current branding state, preset) so every guarantee below is checked offline.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TENANT_PRESETS,
  TENANT_PRESET_LIST,
  KGLOW_TWO_WAYS_ID,
  PRESET_FORBIDDEN_KEYS,
  PRESET_UNSET,
  getTenantPreset,
  applyTenantPreset,
  removeTenantPreset,
  type TenantPreset,
} from "../src/lib/tenant/presets";
import { ALL_FEATURES, OPERATOR_GRANTABLE, FEATURES } from "../src/lib/features/catalog";
import { normalizeGroupBuyContent } from "../src/lib/storefront/gb-content";
import { normalizeGroupBuyRules } from "../src/lib/storefront/group-buy-rules";
import { normalizeGroupBuySettings } from "../src/lib/storefront/group-buy";
import { resolveHomeLayout } from "../src/lib/storefront/two-ways-home";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

/** A realistic already-live tenant: its own brand identity + its own content. */
function livingTenant() {
  return {
    themeId: "clinical-white",
    config: {
      name: "Pep Stack Davao",
      logoUrl: "https://ik.imagekit.io/x/pepstack-logo.png",
      main: "#123456",
      accent: "#654321",
      currency: "₱",
      industry: "Peptides",
      adminPassword: "super-secret-owner-pw",
      resellerAccessCode: "WHOLESALE-2026",
      coaReports: [{ id: "c1", name: "BPC-157", lab: "Janoshik" }],
      categories: ["Peptides", "Bac Water"],
      // Already running the two-ways home, so applying the preset is seen
      // switching it back OFF — the preset owns homeLayout and ships it classic.
      homeLayout: "two-ways",
      showPageCOA: false,
    } as Record<string, unknown>,
    enabledFeatures: [] as string[],
  };
}

// ── 1. Registry ──────────────────────────────────────────────────────────────
console.log("\n1. Preset registry");

check("exports a non-empty preset registry", () => {
  assert.ok(TENANT_PRESET_LIST.length > 0, "TENANT_PRESET_LIST is empty");
  assert.equal(TENANT_PRESET_LIST.length, Object.keys(TENANT_PRESETS).length);
});

check("registers the K Glow two-ways preset under a stable id", () => {
  assert.equal(KGLOW_TWO_WAYS_ID, "kglow-two-ways");
  assert.ok(TENANT_PRESETS[KGLOW_TWO_WAYS_ID], "kglow-two-ways preset missing");
});

check("getTenantPreset returns the preset by id and null for unknown ids", () => {
  assert.equal(getTenantPreset(KGLOW_TWO_WAYS_ID)?.id, KGLOW_TWO_WAYS_ID);
  assert.equal(getTenantPreset("no-such-preset"), null);
  assert.equal(getTenantPreset(""), null);
});

check("every preset carries id / name / tagline", () => {
  for (const p of TENANT_PRESET_LIST) {
    assert.ok(p.id.trim(), "blank id");
    assert.ok(p.name.trim(), `${p.id}: blank name`);
    assert.ok(p.tagline.trim(), `${p.id}: blank tagline`);
  }
});

check("no preset carries a theme — a preset changes how a store works, not how it looks", () => {
  for (const p of TENANT_PRESET_LIST) {
    assert.ok(
      !("themeId" in p),
      `${p.id} declares a themeId; the theme belongs to the tenant, not the store shape`,
    );
  }
});

check("registry keys match their preset ids", () => {
  for (const [key, p] of Object.entries(TENANT_PRESETS)) assert.equal(key, p.id);
});

// ── 2. The K Glow preset's contents ──────────────────────────────────────────
console.log("\n2. K Glow two-ways preset");

const kglow: TenantPreset = TENANT_PRESETS[KGLOW_TWO_WAYS_ID];

check("does not carry a theme", () => {
  assert.equal((kglow as { themeId?: string }).themeId, undefined);
});

check("ships the two-ways home OFF — the storefront home stays classic", () => {
  // The preset sets up the group-buy machinery, but the dual "two ways to order"
  // home is opt-in: applying the preset must never flip a storefront onto the
  // split layout on its own. An explicit "classic" (not an absent key) is what
  // turns it off, because resolveHomeLayout reads absent-while-entitled as ON.
  assert.equal(kglow.config.homeLayout, "classic");
});

check("grants the four entitlements group buy + on-hand needs", () => {
  const granted = new Set<string>(kglow.features);
  for (const key of [
    FEATURES.GB_TWO_WAYS_HOME,
    FEATURES.GB_MODULE,
    FEATURES.GB_RULES,
    FEATURES.STORE_COA,
  ]) {
    assert.ok(granted.has(key), `missing grant: ${key}`);
  }
});

check("the applied preset resolves to the classic home, entitled or not", () => {
  // resolveHomeLayout: the entitlement is the ONLY way in; config can only opt
  // out. The preset grants the entitlement (so the store CAN run two-ways) but
  // opts out in config, so a freshly-stamped store renders the classic home.
  const entitled = kglow.features.includes(FEATURES.GB_TWO_WAYS_HOME);
  assert.equal(resolveHomeLayout(entitled, kglow.config.homeLayout as string), "classic");
  assert.equal(resolveHomeLayout(false, kglow.config.homeLayout as string), "classic");
});

check("still grants the entitlement, so the owner can switch two-ways on later", () => {
  // Off by default, one config key away: with the grant in place, flipping
  // branding.config.homeLayout to "two-ways" (scripts/enable-two-ways-home.ts)
  // is all it takes — no second trip to admin → Features.
  const entitled = kglow.features.includes(FEATURES.GB_TWO_WAYS_HOME);
  assert.ok(entitled, "preset must keep granting groupbuy.two_ways_home");
  assert.equal(resolveHomeLayout(entitled, "two-ways"), "two-ways");
});

check("leaves on-hand products buyable while a round is live", () => {
  assert.equal(kglow.config.groupBuyAllowOnHand, true);
});

check("exposes the group-buy manager and its analytics slice", () => {
  assert.equal(kglow.config.showAdminGroupBuy, true);
  assert.equal(kglow.config.showAnalyticsGroupBuys, true);
});

check("enables the Lab Reports page it grants the entitlement for", () => {
  assert.equal(kglow.config.showPageCOA, true);
});

// ── 3. Feature keys are real and operator-grantable ──────────────────────────
console.log("\n3. Feature-grant safety");

check("every preset feature is a key in the feature catalog", () => {
  const known = new Set<string>(ALL_FEATURES);
  for (const p of TENANT_PRESET_LIST) {
    for (const f of p.features) assert.ok(known.has(f), `${p.id}: unknown feature ${f}`);
  }
});

check("every preset feature is operator-grantable on any plan", () => {
  // A preset must never hand out a feature the operator could not grant by hand
  // from admin → Features, or applying it would silently exceed the plan ceiling.
  for (const p of TENANT_PRESET_LIST) {
    for (const f of p.features) {
      assert.ok(OPERATOR_GRANTABLE.has(f), `${p.id}: ${f} is not operator-grantable`);
    }
  }
});

check("no preset lists a feature twice", () => {
  for (const p of TENANT_PRESET_LIST) {
    assert.equal(new Set(p.features).size, p.features.length, `${p.id}: duplicate features`);
  }
});

// ── 4. A preset may never write identity, secrets or projected keys ──────────
console.log("\n4. Forbidden config keys");

check("PRESET_FORBIDDEN_KEYS covers secrets, identity and server-projected keys", () => {
  for (const k of [
    // secrets
    "adminPassword",
    "resellerAccessCode",
    "accessGate",
    // identity / owner content
    "name",
    "logoUrl",
    "main",
    "accent",
    "coaReports",
    "categories",
    // server-projected (never stored)
    "groupBuyCaps",
    "groupBuyGate",
    "groupBuyBanner",
    "subscription",
    "trial",
  ]) {
    assert.ok(PRESET_FORBIDDEN_KEYS.has(k), `not forbidden: ${k}`);
  }
});

check("no preset writes a forbidden key", () => {
  for (const p of TENANT_PRESET_LIST) {
    for (const k of Object.keys(p.config)) {
      assert.ok(!PRESET_FORBIDDEN_KEYS.has(k), `${p.id} writes forbidden key ${k}`);
    }
  }
});

check("every preset config key is a real Brand key", () => {
  const src = readFileSync(join(__dirname, "..", "src", "storefront", "types.ts"), "utf8");
  for (const p of TENANT_PRESET_LIST) {
    for (const k of [...Object.keys(p.config), ...Object.keys(p.defaults ?? {})]) {
      assert.match(src, new RegExp(`^\\s+${k}\\??:`, "m"), `${p.id}: ${k} not in Brand`);
    }
  }
});

// ── 5. Applying to an EXISTING tenant preserves its identity ─────────────────
console.log("\n5. Apply to an existing tenant (J2)");

check("preserves every config key the preset does not own", () => {
  const before = livingTenant();
  const out = applyTenantPreset(before, kglow);
  for (const k of ["name", "logoUrl", "main", "accent", "currency", "industry"]) {
    assert.deepEqual(out.config[k], before.config[k], `clobbered ${k}`);
  }
});

check("never touches the tenant's secrets", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.equal(out.config.adminPassword, "super-secret-owner-pw");
  assert.equal(out.config.resellerAccessCode, "WHOLESALE-2026");
});

check("never touches the tenant's own content collections", () => {
  const before = livingTenant();
  const out = applyTenantPreset(before, kglow);
  assert.deepEqual(out.config.coaReports, before.config.coaReports);
  assert.deepEqual(out.config.categories, before.config.categories);
});

check("overwrites the keys the preset does own", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.equal(out.config.homeLayout, "classic", "homeLayout not switched");
  assert.equal(out.config.showPageCOA, true, "showPageCOA not switched on");
});

check("never touches the tenant's theme", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.ok(!("themeId" in out), "application returned a themeId to persist");
  assert.ok(!out.changes.some((c) => c.kind === "theme"), "proposed a theme change");
});

check("does not mutate the caller's config object", () => {
  const before = livingTenant();
  const snapshot = JSON.stringify(before.config);
  const out = applyTenantPreset(before, kglow);
  assert.equal(JSON.stringify(before.config), snapshot, "input config was mutated");
  assert.notEqual(out.config, before.config, "returned the same object reference");
});

// ── 6. Applying to a BRAND-NEW tenant (J1) ───────────────────────────────────
console.log("\n6. Apply at tenant creation (J1)");

check("an empty config yields a complete group-buy setup on the classic home", () => {
  const out = applyTenantPreset({ themeId: "default", config: {}, enabledFeatures: [] }, kglow);
  assert.ok(!("themeId" in out), "a new tenant's operator-picked theme was overridden");
  assert.equal(out.config.homeLayout, "classic");
  assert.equal(out.featuresToGrant.length, kglow.features.length);
});

check("tolerates absent / malformed current state", () => {
  const cases: Parameters<typeof applyTenantPreset>[0][] = [
    {},
    { config: null },
    { config: undefined },
    { config: "nonsense" },
    { config: [] },
    { themeId: null },
  ];
  for (const current of cases) {
    const out = applyTenantPreset(current, kglow);
    assert.equal(out.config.homeLayout, "classic");
    assert.ok(!("themeId" in out));
  }
});

// ── 7. Feature grants ────────────────────────────────────────────────────────
console.log("\n7. Feature grants");

check("grants every preset feature the tenant lacks", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.deepEqual([...out.featuresToGrant].sort(), [...kglow.features].sort());
});

check("skips features the tenant already has", () => {
  const current = { ...livingTenant(), enabledFeatures: [FEATURES.GB_MODULE, FEATURES.STORE_COA] };
  const out = applyTenantPreset(current, kglow);
  assert.ok(!out.featuresToGrant.includes(FEATURES.GB_MODULE), "re-granted GB_MODULE");
  assert.ok(!out.featuresToGrant.includes(FEATURES.STORE_COA), "re-granted STORE_COA");
  assert.ok(out.featuresToGrant.includes(FEATURES.GB_TWO_WAYS_HOME), "missed two-ways grant");
});

check("is additive only — never revokes what the tenant already has", () => {
  const current = { ...livingTenant(), enabledFeatures: ["storefront.card_studio"] };
  const out = applyTenantPreset(current, kglow);
  assert.ok(!("featuresToRevoke" in out), "preset application must be additive only");
});

// ── 8. Change preview (J3) ───────────────────────────────────────────────────
console.log("\n8. Change preview (J3)");

check("reports no theme change even when the tenant's theme differs", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.equal(out.changes.find((c) => c.kind === "theme"), undefined);
});

check("reports each changed config key with its before/after", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  const home = out.changes.find((c) => c.kind === "config" && c.key === "homeLayout");
  assert.deepEqual(home, { kind: "config", key: "homeLayout", from: "two-ways", to: "classic" });
  const coa = out.changes.find((c) => c.kind === "config" && c.key === "showPageCOA");
  assert.deepEqual(coa, { kind: "config", key: "showPageCOA", from: false, to: true });
});

check("reports each feature that will be granted", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  const feats = out.changes.filter((c) => c.kind === "feature").map((c) => c.key);
  assert.deepEqual(feats.sort(), [...kglow.features].sort());
});

check("reports no change for a config key that already matches", () => {
  const current = { themeId: "kglow", config: { homeLayout: "classic" }, enabledFeatures: [] };
  const out = applyTenantPreset(current, kglow);
  assert.ok(
    !out.changes.some((c) => c.kind === "config" && c.key === "homeLayout"),
    "reported a no-op config change",
  );
});

// ── 9. Idempotency ───────────────────────────────────────────────────────────
console.log("\n9. Idempotency");

check("re-applying to its own output reports zero changes", () => {
  const first = applyTenantPreset(livingTenant(), kglow);
  const second = applyTenantPreset(
    { themeId: "clinical-white", config: first.config, enabledFeatures: first.featuresToGrant },
    kglow,
  );
  assert.deepEqual(second.changes, [], `still changing: ${JSON.stringify(second.changes)}`);
  assert.deepEqual(second.featuresToGrant, []);
  assert.deepEqual(second.config, first.config);
});

// ── 10. Preset payloads survive their own normalizers ────────────────────────
console.log("\n10. Normalizer round-trip");

check("groupBuyContent normalizes to itself", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.deepEqual(normalizeGroupBuyContent(out.config.groupBuyContent), out.config.groupBuyContent);
});

check("groupBuyRules normalizes to itself", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.deepEqual(normalizeGroupBuyRules(out.config.groupBuyRules), out.config.groupBuyRules);
});

check("groupBuySettings normalizes to itself", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  assert.deepEqual(
    normalizeGroupBuySettings(out.config.groupBuySettings),
    out.config.groupBuySettings,
  );
});

check("the ratio floor is on, strict, 1 bac water per peptide", () => {
  const rules = normalizeGroupBuyRules(kglow.defaults?.groupBuyRules);
  assert.equal(rules.enabled, true);
  assert.equal(rules.ratio.enabled, true);
  assert.equal(rules.ratio.mode, "strict");
  assert.equal(rules.ratio.bacWaterPerPeptide, 1);
});

// ── 11. Owner-edited settings are seeded, never overwritten ──────────────────
console.log("\n11. Fill-if-absent defaults");

/** The owner-editable blocks a preset may only SEED, never replace. */
const SEEDED_KEYS = ["groupBuyRules", "groupBuyContent", "groupBuySettings"] as const;

check("owner-editable group-buy blocks live in `defaults`, not `config`", () => {
  for (const k of SEEDED_KEYS) {
    assert.ok(!(k in kglow.config), `${k} must not be in config (it would clobber owner edits)`);
    assert.ok(k in (kglow.defaults ?? {}), `${k} missing from defaults`);
  }
});

check("seeds the defaults when the tenant has none", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  for (const k of SEEDED_KEYS) assert.ok(out.config[k], `${k} not seeded`);
});

check("preserves the owner's own group-buy rules, copy and settings", () => {
  // A store already running group buys: 3-vial minimum, custom explainer copy,
  // a 30-day default round. Applying the preset must not reset any of it.
  const ownerRules = {
    enabled: true,
    minOrder: { minVialsPerProduct: 3, minTotalVials: 12 },
    bacWater: { restrictionsDisabled: false, allowUnlimited: false, maxPerPeptide: 2 },
    ratio: {
      enabled: true,
      mode: "warn",
      bacWaterPerPeptide: 2,
      defaultBacWaterProductId: null,
      message: "",
    },
    validation: { cart: true, checkout: false },
  };
  const ownerContent = {
    howTitle: "How our pasabuy works",
    steps: ["Pick your peptides.", "We order in bulk."],
    terms: "Slots lock on payment.",
  };
  const ownerSettings = {
    defaultStatus: "active",
    defaultDurationDays: 30,
    defaultDeliveryEta: "2 weeks",
  };

  const before = livingTenant();
  const current = {
    ...before,
    config: {
      ...before.config,
      groupBuyRules: ownerRules,
      groupBuyContent: ownerContent,
      groupBuySettings: ownerSettings,
    },
  };

  const out = applyTenantPreset(current, kglow);
  assert.deepEqual(out.config.groupBuyRules, ownerRules, "clobbered owner rules");
  assert.deepEqual(out.config.groupBuyContent, ownerContent, "clobbered owner copy");
  assert.deepEqual(out.config.groupBuySettings, ownerSettings, "clobbered owner settings");
  for (const k of SEEDED_KEYS) {
    assert.ok(
      !out.changes.some((c) => c.kind === "config" && c.key === k),
      `reported a change for owner-held ${k}`,
    );
  }
});

check("still switches the structural keys on a configured tenant", () => {
  // Seeding must not become a no-op preset: the layout keys still apply.
  const before = livingTenant();
  const current = {
    ...before,
    config: { ...before.config, groupBuyRules: { enabled: true } },
  };
  const out = applyTenantPreset(current, kglow);
  assert.equal(out.config.homeLayout, "classic");
  assert.equal(out.config.showAdminGroupBuy, true);
});

check("a seeded default is reported as an addition, not a replacement", () => {
  const out = applyTenantPreset(livingTenant(), kglow);
  const c = out.changes.find((x) => x.kind === "config" && x.key === "groupBuyRules");
  assert.ok(c, "no change reported for the seeded groupBuyRules");
  if (c?.kind === "config") assert.equal(c.from, undefined, "seed reported as a replacement");
});

check("no preset default writes a forbidden key", () => {
  for (const p of TENANT_PRESET_LIST) {
    for (const k of Object.keys(p.defaults ?? {})) {
      assert.ok(!PRESET_FORBIDDEN_KEYS.has(k), `${p.id} seeds forbidden key ${k}`);
    }
  }
});

check("config and defaults never declare the same key", () => {
  for (const p of TENANT_PRESET_LIST) {
    for (const k of Object.keys(p.defaults ?? {})) {
      assert.ok(!(k in p.config), `${p.id}: ${k} is in both config and defaults`);
    }
  }
});

// ── 12. Removing a preset — the shape is a switch (J5) ───────────────────────
console.log("\n12. Remove the preset (J5)");

// A tenant that has HAD the preset stamped on it: the structural keys are set,
// the four entitlements resolve, and the owner has since edited the seeded
// group-buy rules. Removing must undo the shape without touching that edit.
function stampedTenant() {
  const applied = applyTenantPreset(livingTenant(), kglow);
  const config = { ...applied.config };
  // The owner customised the seeded rules after the preset was applied.
  config.groupBuyRules = { enabled: true, ratio: { enabled: true, bacWaterPerPeptide: 2 } };
  return {
    themeId: "clinical-white",
    config,
    enabledFeatures: [...kglow.features] as string[],
  };
}

check("every preset declares an off value for exactly the keys its config owns", () => {
  for (const p of TENANT_PRESET_LIST) {
    const configKeys = Object.keys(p.config).sort();
    const offKeys = Object.keys(p.off).sort();
    assert.deepEqual(
      offKeys,
      configKeys,
      `${p.id}: off must cover exactly its config keys (config=${configKeys}, off=${offKeys})`,
    );
  }
});

check("no preset's off block touches a seeded default or a forbidden key", () => {
  for (const p of TENANT_PRESET_LIST) {
    for (const k of Object.keys(p.off)) {
      assert.ok(!PRESET_FORBIDDEN_KEYS.has(k), `${p.id}: off writes forbidden key ${k}`);
      assert.ok(!(k in (p.defaults ?? {})), `${p.id}: off touches owner-editable ${k}`);
    }
  }
});

check("removing never reports a theme change — the tenant keeps its look", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.ok(
    !out.changes.some((c) => c.kind === "theme"),
    "removal proposed a theme change",
  );
  assert.ok(!("themeId" in out), "removal returned a themeId to persist");
});

check("removing keeps the owner's edited group-buy rules, copy and round defaults", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.deepEqual(
    out.config.groupBuyRules,
    { enabled: true, ratio: { enabled: true, bacWaterPerPeptide: 2 } },
    "removal destroyed the owner's edited rules",
  );
  assert.ok(out.config.groupBuyContent, "removal dropped groupBuyContent");
  assert.ok(out.config.groupBuySettings, "removal dropped groupBuySettings");
});

check("removing keeps identity, secrets and the owner's own content", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.equal(out.config.name, "Pep Stack Davao");
  assert.equal(out.config.logoUrl, "https://ik.imagekit.io/x/pepstack-logo.png");
  assert.equal(out.config.main, "#123456");
  assert.equal(out.config.adminPassword, "super-secret-owner-pw");
  assert.deepEqual(out.config.categories, ["Peptides", "Bac Water"]);
  assert.equal((out.config.coaReports as unknown[]).length, 1);
});

// The two hazard keys. Both are read as `!== false`, so writing an explicit
// `false` is NOT the off-state — it is a new, stickier owner decision.
check("removing UNSETS groupBuyAllowOnHand rather than writing false", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.ok(
    !("groupBuyAllowOnHand" in out.config),
    "removal left groupBuyAllowOnHand set — `false` here PAUSES on-hand sales (on-hand-gate.ts reads `!== false`)",
  );
});

check("removing UNSETS showPageCOA rather than writing false", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.ok(
    !("showPageCOA" in out.config),
    "removal left showPageCOA set — `false` would keep Lab Reports hidden even after a future re-grant",
  );
});

check("removing keeps homeLayout explicitly classic — absent-while-entitled reads as two-ways", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.equal(
    out.config.homeLayout,
    "classic",
    "removal must not delete homeLayout: resolveHomeLayout treats an absent key as ON",
  );
  assert.equal(resolveHomeLayout(true, out.config.homeLayout as string), "classic");
});

check("removing switches the store-admin surfaces off", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.ok(!("showAdminGroupBuy" in out.config), "showAdminGroupBuy survived removal");
  assert.ok(!("showAnalyticsGroupBuys" in out.config), "showAnalyticsGroupBuys survived removal");
});

check("removing revokes exactly the preset's features that are currently enabled", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  assert.deepEqual([...out.featuresToRevoke].sort(), [...kglow.features].sort());
});

check("removing revokes nothing the tenant does not already have", () => {
  const partial = {
    ...stampedTenant(),
    enabledFeatures: [FEATURES.GB_MODULE] as string[],
  };
  const out = removeTenantPreset(partial, kglow);
  assert.deepEqual(out.featuresToRevoke, [FEATURES.GB_MODULE]);
});

check("removing reports one revoke change per feature, distinct from a grant", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  const revokes = out.changes.filter((c) => c.kind === "revoke");
  assert.equal(revokes.length, kglow.features.length);
  assert.ok(
    !out.changes.some((c) => c.kind === "feature"),
    "removal emitted a grant-shaped change",
  );
});

check("removing reports each config key it clears", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  const cleared = out.changes.filter((c) => c.kind === "config" && c.to === undefined);
  assert.ok(cleared.length >= 4, `expected the 4 unset keys, got ${cleared.length}`);
});

check("removing is idempotent — a second removal changes nothing", () => {
  const first = removeTenantPreset(stampedTenant(), kglow);
  const second = removeTenantPreset(
    { themeId: "kglow", config: first.config, enabledFeatures: [] },
    kglow,
  );
  assert.deepEqual(second.changes, [], "second removal still proposed changes");
  assert.deepEqual(second.config, first.config);
  assert.deepEqual(second.featuresToRevoke, []);
});

check("removing a preset the tenant never had is a no-op", () => {
  const out = removeTenantPreset(
    { themeId: "clinical-white", config: { name: "Untouched" }, enabledFeatures: [] },
    kglow,
  );
  assert.deepEqual(out.changes, []);
  assert.deepEqual(out.config, { name: "Untouched" });
});

check("removing never mutates the caller's state", () => {
  const current = stampedTenant();
  const snapshot = JSON.parse(JSON.stringify(current));
  removeTenantPreset(current, kglow);
  assert.deepEqual(JSON.parse(JSON.stringify(current)), snapshot, "input was mutated");
});

check("apply → remove → apply restores the stamped shape", () => {
  const start = livingTenant();
  const applied = applyTenantPreset(start, kglow);
  const removed = removeTenantPreset(
    { themeId: applied.themeId, config: applied.config, enabledFeatures: [...kglow.features] },
    kglow,
  );
  const reapplied = applyTenantPreset(
    { themeId: "kglow", config: removed.config, enabledFeatures: [] },
    kglow,
  );
  for (const key of Object.keys(kglow.config)) {
    assert.deepEqual(
      reapplied.config[key],
      applied.config[key],
      `${key} did not survive the apply→remove→apply round trip`,
    );
  }
  assert.deepEqual([...reapplied.featuresToGrant].sort(), [...kglow.features].sort());
});

check("PRESET_UNSET is never persisted into a tenant's config", () => {
  const out = removeTenantPreset(stampedTenant(), kglow);
  for (const [k, v] of Object.entries(out.config)) {
    assert.notEqual(v, PRESET_UNSET, `${k} kept the UNSET sentinel`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
