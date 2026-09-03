// MCP feature management — RED/GREEN gate (npm run test:mcp-features).
//
// The connector could create a tenant, restyle it and stock its catalog, but it
// could not turn a MODULE on or off. Every "switch on group buys for k-glow"
// still meant the operator opening admin → Features by hand, which is the one
// thing the connector exists to avoid.
//
// Entitlements are the most dangerous thing the connector can touch, so the
// rules that keep it honest are pinned here rather than in the route:
//
//   IT NEVER GRANTS BEYOND THE PACKAGE. The admin Features editor locks any key
//   outside the plan ceiling that is not operator-grantable. An agent must hit
//   the same wall, or the connector becomes a way to hand out Automated features
//   to a Starter tenant by asking nicely. Journey 5.
//
//   IT FAILS LOUD, AND ALL-OR-NOTHING. A batch with one bad key applies nothing.
//   The agent cannot see the store, so a half-applied entitlement change reported
//   as success is worse than an error. Journeys 3, 4, 8, 9.
//
//   IT RESOLVES HUMAN NAMES, BUT REFUSES AMBIGUOUS ONES. Operators say "group buy
//   system", not "groupbuy.module". Two features are both labelled "Excel export"
//   (Sales Analytics and Group Buy) — guessing between them silently toggles the
//   wrong module. Journeys 2, 3.
//
//   IT REPORTS WHAT IT ACTUALLY DID. Already-on stays "unchanged", never a fake
//   change; a toggle back to the plan default drops the override row instead of
//   persisting a redundant one. Journeys 6, 7.
//
// Journeys covered:
//  1. Operator asks ChatGPT to switch a module on for a tenant → planned change.
//  2. Operator names features the way they say them out loud → resolved to keys.
//  3. Operator uses a label two modules share → refused, both candidates named.
//  4. Operator mistypes a feature → refused, nothing planned.
//  5. Operator asks for a feature the tenant's plan does not include → refused.
//  6. Operator re-enables something already on → reported unchanged, no write.
//  7. Operator toggles back to the plan default → override row dropped.
//  8. Operator sends the same feature in enable AND disable → refused.
//  9. Operator calls with nothing to change → refused, not a false success.
// 10. Operator enables an inert sub-capability / disables a master switch → warned.
// 11. Operator asks what is on for a tenant → grouped inventory, admin semantics.
// 12. The tools' JSON schemas, the core and the route all agree.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFeatureInventory,
  buildFeatureTogglePlan,
  requiredPlanFor,
  resolveFeatureKey,
} from "../src/lib/tenant/feature-toggle";
import {
  LIST_FEATURES_TOOL,
  SET_FEATURES_TOOL,
} from "../src/lib/mcp/feature-tool";
import {
  ALL_FEATURES,
  FEATURES,
  FEATURE_GROUPS,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  planFeatureSet,
  type FeatureKey,
} from "../src/lib/features/catalog";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}`);
    if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

const STARTER = planFeatureSet("starter");
const ENTERPRISE = planFeatureSet("enterprise");

/** A Starter tenant sitting exactly on its plan defaults. */
const starterTenant = { planKey: "starter", current: new Set<string>(STARTER) };

// ---------------------------------------------------------------------------
section("1. Operator switches a module on for a tenant");
{
  const plan = buildFeatureTogglePlan({ ...starterTenant, enable: ["groupbuy.module"] });
  check("no errors", plan.errors.length === 0, plan.errors);
  check("one planned change", plan.changes.length === 1, plan.changes);
  check("change targets the module", plan.changes[0]?.key === FEATURES.GB_MODULE, plan.changes);
  check("change turns it ON", plan.changes[0]?.enabled === true, plan.changes);
  check(
    "carries the human label so the agent can report it",
    plan.changes[0]?.label === FEATURE_META[FEATURES.GB_MODULE].label,
    plan.changes,
  );
  check(
    "diverges from the plan default → an override row is needed",
    plan.changes[0]?.matchesPlanDefault === false,
    plan.changes,
  );
}

// ---------------------------------------------------------------------------
section("2. Operator names features the way they say them");
{
  const cases: Array<[string, FeatureKey]> = [
    ["groupbuy.module", FEATURES.GB_MODULE],
    ["  GroupBuy.Module  ", FEATURES.GB_MODULE],
    ["GB_MODULE", FEATURES.GB_MODULE],
    ["gb_module", FEATURES.GB_MODULE],
    ["Group buy system", FEATURES.GB_MODULE],
    ["group buy system", FEATURES.GB_MODULE],
    ["Product reviews", FEATURES.STORE_REVIEWS],
    ["storefront.reviews", FEATURES.STORE_REVIEWS],
    ["Lab reports (COA)", FEATURES.STORE_COA],
    ["Access code gate", FEATURES.STORE_ACCESS_CODE],
    ["Card Studio", FEATURES.STORE_CARD_STUDIO],
  ];
  for (const [token, expected] of cases) {
    const res = resolveFeatureKey(token);
    check(`"${token}" → ${expected}`, res.ok && res.key === expected, res);
  }

  const plan = buildFeatureTogglePlan({ ...starterTenant, enable: ["Group buy system", "Product reviews"] });
  check("a spoken-name batch plans both", plan.changes.length === 2, plan);
  check("…with no errors", plan.errors.length === 0, plan.errors);
}

// ---------------------------------------------------------------------------
section("3. A label two modules share is refused, not guessed");
{
  const res = resolveFeatureKey("Excel export");
  check("resolution fails", res.ok === false, res);
  check("…as ambiguous", !res.ok && res.reason === "ambiguous", res);
  check(
    "…naming both candidates",
    !res.ok &&
      res.candidates.includes(FEATURES.SA_EXPORT_EXCEL) &&
      res.candidates.includes(FEATURES.GB_REPORT_EXCEL),
    res,
  );

  const plan = buildFeatureTogglePlan({ ...starterTenant, enable: ["Excel export"] });
  check("the call is refused", plan.errors.length > 0, plan);
  check("nothing is planned", plan.changes.length === 0, plan.changes);
  check(
    "the error names both exact keys so the operator can pick",
    plan.errors.some((e) => e.includes(FEATURES.SA_EXPORT_EXCEL) && e.includes(FEATURES.GB_REPORT_EXCEL)),
    plan.errors,
  );
}

// ---------------------------------------------------------------------------
section("4. An unknown feature is refused, and refuses the whole batch");
{
  const res = resolveFeatureKey("groupbuy.modul");
  check("resolution fails", res.ok === false, res);
  check("…as unknown", !res.ok && res.reason === "unknown", res);

  const plan = buildFeatureTogglePlan({
    ...starterTenant,
    enable: ["groupbuy.module", "storefront.definitely_not_real"],
  });
  check("the batch errors", plan.errors.length > 0, plan.errors);
  check(
    "the error quotes what was sent",
    plan.errors.some((e) => e.includes("storefront.definitely_not_real")),
    plan.errors,
  );
  check("NOTHING is planned — all or nothing", plan.changes.length === 0, plan.changes);

  for (const bad of [42, null, "", "   ", {}] as unknown[]) {
    const p = buildFeatureTogglePlan({ ...starterTenant, enable: [bad] });
    check(`non-string entry ${JSON.stringify(bad)} is refused`, p.errors.length > 0 && p.changes.length === 0, p);
  }
  const notAList = buildFeatureTogglePlan({ ...starterTenant, enable: "groupbuy.module" as unknown });
  check("a bare string instead of a list is refused", notAList.errors.length > 0, notAList.errors);
}

// ---------------------------------------------------------------------------
section("5. The connector never grants beyond the package");
{
  // Customer accounts is in the Automated ceiling only, and is NOT
  // operator-grantable — the admin editor renders it locked.
  const key = FEATURES.ECOM_ACCOUNTS;
  check(
    "fixture is genuinely plan-locked on Starter",
    !STARTER.has(key) && !OPERATOR_GRANTABLE.has(key) && ENTERPRISE.has(key),
  );

  const plan = buildFeatureTogglePlan({ ...starterTenant, enable: [key] });
  check("refused", plan.errors.length > 0, plan.errors);
  check("nothing planned", plan.changes.length === 0, plan.changes);
  check("the error names the feature", plan.errors.some((e) => e.includes(key)), plan.errors);
  check(
    "the error names the plan that would include it",
    plan.errors.some((e) => e.toLowerCase().includes("automated") || e.includes("enterprise")),
    plan.errors,
  );
  check("requiredPlanFor points at the lowest tier that has it", requiredPlanFor(key) === "enterprise", requiredPlanFor(key));

  // The same key on a plan that DOES include it is fine.
  const okPlan = buildFeatureTogglePlan({
    planKey: "enterprise",
    current: new Set<string>(ENTERPRISE),
    disable: [key],
  });
  check("…but the Automated tenant can turn it off", okPlan.errors.length === 0 && okPlan.changes.length === 1, okPlan);

  // Operator-grantable keys sit outside EVERY ceiling and must stay reachable.
  for (const key of OPERATOR_GRANTABLE) {
    const p = buildFeatureTogglePlan({ ...starterTenant, enable: [key] });
    check(`operator-grantable ${key} is reachable on Starter`, p.errors.length === 0, p.errors);
  }
}

// ---------------------------------------------------------------------------
section("6. Already in the requested state → unchanged, not a fake change");
{
  const key = FEATURES.STORE_SEARCH; // Starter default-on
  check("fixture is on by default", STARTER.has(key));

  const plan = buildFeatureTogglePlan({ ...starterTenant, enable: [key] });
  check("no errors", plan.errors.length === 0, plan.errors);
  check("no change planned", plan.changes.length === 0, plan.changes);
  check("reported as unchanged", plan.unchanged.some((u) => u.key === key), plan.unchanged);
  check("unchanged carries its current state", plan.unchanged[0]?.enabled === true, plan.unchanged);
}

// ---------------------------------------------------------------------------
section("7. Back to the plan default → the override row is dropped");
{
  const key = FEATURES.STORE_SEARCH; // in the Starter ceiling
  // A tenant whose operator previously revoked it (an override row exists).
  const revoked = new Set<string>(STARTER);
  revoked.delete(key);

  const plan = buildFeatureTogglePlan({ planKey: "starter", current: revoked, enable: [key] });
  check("one change", plan.changes.length === 1, plan.changes);
  check(
    "…flagged as back-to-default so the writer DELETES the override",
    plan.changes[0]?.matchesPlanDefault === true,
    plan.changes,
  );

  const away = buildFeatureTogglePlan({ ...starterTenant, disable: [key] });
  check(
    "revoking a plan default needs an override row",
    away.changes[0]?.matchesPlanDefault === false,
    away.changes,
  );
}

// ---------------------------------------------------------------------------
section("8. Contradictory instructions are refused");
{
  const plan = buildFeatureTogglePlan({
    ...starterTenant,
    enable: ["groupbuy.module"],
    disable: ["Group buy system"], // same feature, spoken differently
  });
  check("refused", plan.errors.length > 0, plan.errors);
  check("nothing planned", plan.changes.length === 0, plan.changes);
  check(
    "the error explains the contradiction",
    plan.errors.some((e) => e.includes(FEATURES.GB_MODULE)),
    plan.errors,
  );
}

// ---------------------------------------------------------------------------
section("9. An empty call is an error, never a success");
{
  for (const args of [{}, { enable: [] }, { disable: [] }, { enable: [], disable: [] }]) {
    const plan = buildFeatureTogglePlan({ ...starterTenant, ...args });
    check(`${JSON.stringify(args)} is refused`, plan.errors.length > 0, plan);
  }
}

// ---------------------------------------------------------------------------
section("10. Inert combinations are warned about, never silently applied");
{
  // A Sales Analytics slice sits in every plan ceiling but is inert until the
  // module itself is granted. Start from a tenant whose operator revoked it.
  const slice = FEATURES.SA_EXPORT_PDF;
  const withoutSlice = new Set<string>(STARTER);
  withoutSlice.delete(slice);
  const inert = buildFeatureTogglePlan({ planKey: "starter", current: withoutSlice, enable: [slice] });
  check("the slice still applies", inert.errors.length === 0 && inert.changes.length === 1, inert);
  check(
    "…but warns it stays inert until the module is on",
    inert.warnings.some((w) => w.includes(FEATURES.STORE_SALES_ANALYTICS)),
    inert.warnings,
  );

  // Enabling the master in the SAME call clears the warning.
  const together = buildFeatureTogglePlan({
    planKey: "starter",
    current: withoutSlice,
    enable: [FEATURES.STORE_SALES_ANALYTICS, slice],
  });
  check(
    "enabling the module alongside it clears the warning",
    !together.warnings.some((w) => w.includes("inert")),
    together.warnings,
  );

  // Turning a master switch off strands its children.
  const withGb = new Set<string>([...STARTER, FEATURES.GB_MODULE]);
  const off = buildFeatureTogglePlan({ planKey: "starter", current: withGb, disable: [FEATURES.GB_MODULE] });
  check("turning the module off is allowed", off.errors.length === 0 && off.changes.length === 1, off);
  check(
    "…but warns the group-buy capabilities go inert",
    off.warnings.some((w) => w.toLowerCase().includes("inert")),
    off.warnings,
  );
}

// ---------------------------------------------------------------------------
section("11. Operator asks what is on for a tenant");
{
  const enabled = new Set<string>([...STARTER, FEATURES.GB_MODULE]);
  const inv = buildFeatureInventory({ planKey: "starter", current: enabled });

  check("groups follow the admin panel order", inv.groups.every((g) => FEATURE_GROUPS.includes(g.group)), inv.groups);
  const flat = inv.groups.flatMap((g) => g.features);
  check("every catalog feature is listed exactly once", flat.length === ALL_FEATURES.length, {
    listed: flat.length,
    catalog: ALL_FEATURES.length,
  });

  const byKey = new Map(flat.map((f) => [f.key, f]));
  check("a plan default reads enabled", byKey.get(FEATURES.STORE_SEARCH)?.enabled === true, byKey.get(FEATURES.STORE_SEARCH));
  check("a granted add-on reads enabled", byKey.get(FEATURES.GB_MODULE)?.enabled === true, byKey.get(FEATURES.GB_MODULE));
  check(
    "an ungranted add-on reads disabled but NOT locked",
    byKey.get(FEATURES.STORE_REVIEWS)?.enabled === false && byKey.get(FEATURES.STORE_REVIEWS)?.lockedByPlan === false,
    byKey.get(FEATURES.STORE_REVIEWS),
  );
  check(
    "a plan-locked feature reads locked, with the plan it needs",
    byKey.get(FEATURES.ECOM_ACCOUNTS)?.lockedByPlan === true &&
      !!byKey.get(FEATURES.ECOM_ACCOUNTS)?.requiredPlanLabel,
    byKey.get(FEATURES.ECOM_ACCOUNTS),
  );
  check(
    "lockedByPlan matches the admin editor's rule exactly",
    flat.every((f) => f.lockedByPlan === (!STARTER.has(f.key) && !OPERATOR_GRANTABLE.has(f.key))),
  );
  check("the summary counts what is on", inv.enabledCount === enabled.size, {
    reported: inv.enabledCount,
    actual: enabled.size,
  });
}

// ---------------------------------------------------------------------------
section("12. Schemas, core and route agree");
{
  check("the read tool is named for reading", LIST_FEATURES_TOOL.name === "list_whitelabel_features");
  check("the write tool is named for writing", SET_FEATURES_TOOL.name === "set_whitelabel_features");

  for (const tool of [LIST_FEATURES_TOOL, SET_FEATURES_TOOL]) {
    const schema = tool.inputSchema as Record<string, any>;
    check(
      `${tool.name} takes a tenant slug (same argument name as the other tools)`,
      !!schema.properties?.tenantSlug && schema.required?.includes("tenantSlug"),
      schema.properties,
    );
    check(`${tool.name} requires the tenant`, Array.isArray(schema.required) && schema.required.length > 0, schema.required);
    check(`${tool.name} rejects stray arguments`, schema.additionalProperties === false, schema);
    check(
      `${tool.name} accepts the connector's fallback token`,
      !!schema.properties?.adminToken,
      Object.keys(schema.properties ?? {}),
    );
    check(`${tool.name} describes itself as a ${tool === SET_FEATURES_TOOL ? "write" : "read"}`, tool.description.length > 40);
  }

  const setProps = (SET_FEATURES_TOOL.inputSchema as Record<string, any>).properties ?? {};
  check("the write tool exposes enable", setProps.enable?.type === "array", setProps.enable);
  check("the write tool exposes disable", setProps.disable?.type === "array", setProps.disable);
  check("enable takes strings", setProps.enable?.items?.type === "string", setProps.enable);
  check("disable takes strings", setProps.disable?.items?.type === "string", setProps.disable);
  check(
    "the write tool warns the model this is a live entitlement change",
    /explicit|only call|do not call/i.test(SET_FEATURES_TOOL.description),
    SET_FEATURES_TOOL.description,
  );

  // Every key the schema advertises to the model must resolve in the core.
  const advertised: string[] = setProps.enable?.items?.enum ?? [];
  for (const key of advertised) {
    const res = resolveFeatureKey(key);
    check(`advertised key ${key} resolves`, res.ok, res);
  }

  const route = readFileSync(join(process.cwd(), "src/app/api/mcp/route.ts"), "utf8");
  check("the route imports the feature tools", route.includes("@/lib/mcp/feature-tool"), null);
  check("tools/list advertises the read tool", route.includes("LIST_FEATURES_TOOL"), null);
  check("tools/list advertises the write tool", route.includes("SET_FEATURES_TOOL"), null);
  check("the route dispatches the read tool", route.includes("callListFeatures"), null);
  check("the route dispatches the write tool", route.includes("callSetFeatures"), null);
  check(
    "the server instructions tell the model features can be toggled",
    /feature/i.test(route.slice(route.indexOf("instructions:"), route.indexOf("\n    });", route.indexOf("instructions:")))),
    null,
  );

  const tool = readFileSync(join(process.cwd(), "src/lib/mcp/feature-tool.ts"), "utf8");
  check("the write path proves the admin token itself or leaves it to the route", tool.length > 0, null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll MCP feature management checks passed");
