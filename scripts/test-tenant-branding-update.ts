// Tenant branding UPDATE — RED/GREEN gate (npm run test:branding-update).
//
// The MCP connector could only ever CREATE a tenant. Restyling a live store
// (theme, palette, storefront layout, hero) had no write path at all, so an
// operator asking an agent to "redesign skn-aesthetic-supply-co" had two bad
// options: make a duplicate tenant, or re-run the creation endpoint over the
// live one. This module is the missing third option — a PATCH over the existing
// branding row.
//
// Everything dangerous about that lives here, which is why the pure core is
// tested rather than the route:
//
//   IT IS A PATCH, NOT A REPLACE. branding.config carries a store's whole life
//   — payment methods, FAQ, COAs, promo codes, categories, group-buy rules. A
//   restyle touches a dozen color keys. Any merge that drops an untouched key
//   silently destroys live commerce data, and nothing in the request would show
//   it. Journey 1 pins this.
//
//   IT FAILS LOUD, NOT CLOSED. The rest of the storefront normalizes untrusted
//   JSON by discarding junk (see brand-border.ts). That is right for RENDER and
//   wrong for a WRITE: an operator who mistypes a key deserves an error, not a
//   silent no-op reported as success. Journeys 2, 4, 5 and 7 pin this.
//
//   COLORS ARE A CSS-INJECTION SURFACE. These values land in inline style
//   custom properties, so only #hex passes. Journey 2.
//
//   CONTRAST IS ADVISORY. The SKN brief was "stronger text/background
//   contrast" — the exact defect a human eye catches and an agent does not.
//   A failing pair warns; it does not block, because an operator may be
//   mid-restyle. Journey 3.
//
// Journeys covered:
//  1. Operator restyles an existing tenant's palette → untouched config survives.
//  2. Operator sends a non-hex color → rejected before it reaches inline CSS.
//  3. Operator sets a low-contrast text/background pair → warned, still applied.
//  4. Operator names a theme preset that doesn't exist → rejected.
//  5. Operator mistypes a field name → rejected, nothing written.
//  6. Operator edits one hero line → the other hero copy is untouched.
//  7. Operator calls with nothing to change → rejected, not a false success.
//  8. Operator sends a bad layout enum / out-of-range number → rejected.
//  9. Operator retitles the catalog / rewrites the meta description.

import { buildTenantBrandingUpdate } from "../src/lib/tenant/branding-update";
import { THEME_PRESETS } from "../src/lib/theme/presets";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

/** A realistic live tenant: a restyle must not cost it any of this. */
const LIVE_CONFIG = {
  name: "SKN Aesthetic Supply Co",
  industry: "aesthetic supplies",
  currency: "₱",
  main: "#8a7560",
  accent: "#c9b8a4",
  background: "#f3ece3",
  surface: "#faf6f1",
  text: "#6b6155",
  button: "#8a7560",
  buttonText: "#ffffff",
  heroLine1: "SKN Aesthetic Supply Co",
  heroLine2: "Clinic-grade essentials",
  heroSub: "Everything your treatment room runs on.",
  heroChipLabel: "Now open",
  paymentMethods: [{ id: "gcash", label: "GCash", number: "0917" }],
  faqGroups: [{ title: "Shipping", items: [{ q: "How long?", a: "2-3 days." }] }],
  promoCodes: [{ code: "LAUNCH10", percent: 10 }],
  categories: [{ id: "skincare", label: "Skincare" }],
  shippingLocations: [{ id: "mm", label: "Metro Manila", fee: 120 }],
  heroMedia: { mode: "text", url: "", alt: "", ratio: "standard" },
};

const CURRENT = { themeId: "clinical-white", config: LIVE_CONFIG };

console.log("Journey 1 — a restyle is a patch: untouched config survives");
{
  const out = buildTenantBrandingUpdate(CURRENT, {
    colors: { background: "#FFFFFF", surface: "#FAFAF8", text: "#1C1917", main: "#8A7560" },
  });

  check("no errors", out.errors.length === 0, out.errors);
  check("new background applied", out.config.background === "#FFFFFF", out.config.background);
  check("new text applied", out.config.text === "#1C1917", out.config.text);

  // The whole point of the module. Every one of these is live commerce data.
  check("paymentMethods survive", JSON.stringify(out.config.paymentMethods) === JSON.stringify(LIVE_CONFIG.paymentMethods));
  check("faqGroups survive", JSON.stringify(out.config.faqGroups) === JSON.stringify(LIVE_CONFIG.faqGroups));
  check("promoCodes survive", JSON.stringify(out.config.promoCodes) === JSON.stringify(LIVE_CONFIG.promoCodes));
  check("categories survive", JSON.stringify(out.config.categories) === JSON.stringify(LIVE_CONFIG.categories));
  check("shippingLocations survive", JSON.stringify(out.config.shippingLocations) === JSON.stringify(LIVE_CONFIG.shippingLocations));
  check("hero copy untouched", out.config.heroLine1 === LIVE_CONFIG.heroLine1 && out.config.heroSub === LIVE_CONFIG.heroSub);
  check("accent left alone (not in the patch)", out.config.accent === LIVE_CONFIG.accent, out.config.accent);
  check("heroMedia survives", JSON.stringify(out.config.heroMedia) === JSON.stringify(LIVE_CONFIG.heroMedia));

  // Immutability — the caller's row object must not be edited in place.
  check("input config not mutated", LIVE_CONFIG.background === "#f3ece3", LIVE_CONFIG.background);
  check("returns a new object", (out.config as unknown) !== (CURRENT.config as unknown));

  // The operator needs to see what actually moved.
  check("changed lists the four colors", out.changed.length === 4, out.changed);
  check("changed uses dotted paths", out.changed.includes("colors.background"), out.changed);
  // themeId untouched → not re-stated, so the caller writes nothing to that column.
  check("themeId absent when unchanged", out.themeId === undefined, out.themeId);
}

console.log("Journey 2 — colors are a CSS-injection surface: only #hex passes");
{
  for (const bad of ["red", "rgb(1,2,3)", "javascript:alert(1)", "#fff;}.x{color:red", "#12345", "", 42, null, {}]) {
    const out = buildTenantBrandingUpdate(CURRENT, { colors: { background: bad } });
    check(`rejected: ${JSON.stringify(bad)}`, out.errors.length > 0, out);
    check(`nothing written for ${JSON.stringify(bad)}`, out.changed.length === 0, out.changed);
  }

  // Both hex forms are legitimate hand-typed values.
  check("#RGB accepted", buildTenantBrandingUpdate(CURRENT, { colors: { text: "#111" } }).errors.length === 0);
  check("#RRGGBB accepted", buildTenantBrandingUpdate(CURRENT, { colors: { text: "#111111" } }).errors.length === 0);
}

console.log("Journey 3 — low contrast warns but still applies");
{
  // The exact SKN defect: warm beige text on warm beige ground (~1.5:1).
  const weak = buildTenantBrandingUpdate(CURRENT, {
    colors: { text: "#B8A894", background: "#F3ECE3" },
  });
  check("weak pair still applies", weak.errors.length === 0 && weak.config.text === "#B8A894", weak);
  check("weak pair warns", weak.warnings.some((w) => /contrast/i.test(w)), weak.warnings);
  check("warning names the ratio", weak.warnings.some((w) => /\d\.\d+:1/.test(w)), weak.warnings);

  // A genuinely accessible pair must stay quiet, or the warning means nothing.
  const strong = buildTenantBrandingUpdate(CURRENT, {
    colors: { text: "#1C1917", background: "#FFFFFF" },
  });
  check("AA-passing pair does not warn", strong.warnings.length === 0, strong.warnings);

  // Button label on button fill is the other pair a restyle routinely breaks.
  const button = buildTenantBrandingUpdate(CURRENT, {
    colors: { button: "#F3ECE3", buttonText: "#FFFFFF" },
  });
  check("button pair warns", button.warnings.some((w) => /button/i.test(w)), button.warnings);
}

console.log("Journey 4 — theme preset must exist");
{
  const known = Object.keys(THEME_PRESETS).find((id) => id !== "clinical-white")!;
  const ok = buildTenantBrandingUpdate(CURRENT, { themeId: known });
  check(`known preset accepted: ${known}`, ok.errors.length === 0, ok.errors);
  check("themeId returned when it changes", ok.themeId === known, ok.themeId);

  const bad = buildTenantBrandingUpdate(CURRENT, { themeId: "definitely-not-a-theme" });
  check("unknown preset rejected", bad.errors.length > 0, bad.errors);
  check("error names the bad id", bad.errors.some((e) => e.includes("definitely-not-a-theme")), bad.errors);

  // Re-stating the CURRENT theme is a no-op, not a change.
  const same = buildTenantBrandingUpdate(CURRENT, { themeId: "clinical-white", colors: { text: "#111" } });
  check("unchanged themeId not reported", same.themeId === undefined, same.themeId);
}

console.log("Journey 5 — a mistyped field is an error, never a silent write");
{
  const typo = buildTenantBrandingUpdate(CURRENT, { colors: { backgroundColor: "#FFFFFF" } });
  check("unknown color key rejected", typo.errors.length > 0, typo.errors);
  check("error names the key", typo.errors.some((e) => e.includes("backgroundColor")), typo.errors);

  const section = buildTenantBrandingUpdate(CURRENT, { palette: { text: "#111" } });
  check("unknown section rejected", section.errors.length > 0, section.errors);

  // The dangerous one: arbitrary JSON must never reach branding.config, because
  // the storefront reads keys like paymentMethods straight out of it.
  const smuggle = buildTenantBrandingUpdate(CURRENT, { paymentMethods: [], resellerAccessCode: "hunter2" });
  check("arbitrary top-level keys rejected", smuggle.errors.length > 0, smuggle.errors);
  check("smuggled key not written", smuggle.changed.length === 0, smuggle.changed);

  // Errors anywhere ⇒ nothing is applied. Partial application of a rejected
  // patch would leave the store half-restyled with no way to tell.
  const mixed = buildTenantBrandingUpdate(CURRENT, {
    colors: { background: "#FFFFFF", text: "not-a-color" },
  });
  check("valid sibling not applied when a sibling fails", mixed.changed.length === 0, mixed.changed);
  check("config returned unchanged on error", mixed.config.background === LIVE_CONFIG.background, mixed.config.background);
}

console.log("Journey 6 — hero copy is edited field by field");
{
  const out = buildTenantBrandingUpdate(CURRENT, { hero: { line2: "Clinic-grade skin essentials" } });
  check("no errors", out.errors.length === 0, out.errors);
  check("line2 updated", out.config.heroLine2 === "Clinic-grade skin essentials", out.config.heroLine2);
  check("line1 untouched", out.config.heroLine1 === LIVE_CONFIG.heroLine1, out.config.heroLine1);
  check("sub untouched", out.config.heroSub === LIVE_CONFIG.heroSub, out.config.heroSub);
  check("chip untouched", out.config.heroChipLabel === LIVE_CONFIG.heroChipLabel, out.config.heroChipLabel);
  check("hero.* maps onto the flat hero keys", out.changed.includes("hero.line2"), out.changed);

  // Clearing a line is a legitimate edit and must be distinguishable from "omitted".
  const cleared = buildTenantBrandingUpdate(CURRENT, { hero: { line2: "" } });
  check("empty string clears the field", cleared.config.heroLine2 === "" && cleared.errors.length === 0, cleared);
}

console.log("Journey 7 — an empty call is an error, not a false success");
{
  for (const empty of [{}, { colors: {} }, { hero: {} }, { layout: {} }]) {
    const out = buildTenantBrandingUpdate(CURRENT, empty);
    check(`empty patch rejected: ${JSON.stringify(empty)}`, out.errors.length > 0, out.errors);
  }
  check("non-object patch rejected", buildTenantBrandingUpdate(CURRENT, "restyle it").errors.length > 0);
  check("null patch rejected", buildTenantBrandingUpdate(CURRENT, null).errors.length > 0);
}

console.log("Journey 8 — layout values are validated, not trusted");
{
  const ok = buildTenantBrandingUpdate(CURRENT, {
    layout: { heroVariant: "editorial", footerStyle: "compact", siteBorder: true, showCategories: false, logoCurve: 12 },
  });
  check("valid layout applies", ok.errors.length === 0, ok.errors);
  check("heroVariant written flat", ok.config.heroVariant === "editorial", ok.config.heroVariant);
  check("boolean toggle written", ok.config.showCategories === false, ok.config.showCategories);
  check("numeric written", ok.config.logoCurve === 12, ok.config.logoCurve);

  check("bad enum rejected", buildTenantBrandingUpdate(CURRENT, { layout: { heroVariant: "fancy" } }).errors.length > 0);
  check("bad footerStyle rejected", buildTenantBrandingUpdate(CURRENT, { layout: { footerStyle: "grid" } }).errors.length > 0);
  check("non-boolean toggle rejected", buildTenantBrandingUpdate(CURRENT, { layout: { showHero: "yes" } }).errors.length > 0);
  check("out-of-range logoCurve rejected", buildTenantBrandingUpdate(CURRENT, { layout: { logoCurve: 500 } }).errors.length > 0);
  check("out-of-range borderWidth rejected", buildTenantBrandingUpdate(CURRENT, { colors: { borderWidth: 99 } }).errors.length > 0);
  check("valid borderWidth accepted", buildTenantBrandingUpdate(CURRENT, { colors: { borderWidth: 2 } }).errors.length === 0);
}

console.log("Journey 9 — identity + catalog copy round-trip");
{
  const out = buildTenantBrandingUpdate(CURRENT, {
    identity: { industry: "aesthetic supply", metaDescription: "Clinic-grade aesthetic supplies." },
    catalog: { eyebrow: "The shelf", title: "Shop supplies" },
  });
  check("no errors", out.errors.length === 0, out.errors);
  check("industry updated", out.config.industry === "aesthetic supply", out.config.industry);
  check("metaDescription updated", out.config.metaDescription === "Clinic-grade aesthetic supplies.", out.config.metaDescription);
  check("catalog copy updated", out.config.catalogEyebrow === "The shelf" && out.config.catalogTitle === "Shop supplies", out.config);
  check("store name preserved when not patched", out.config.name === LIVE_CONFIG.name, out.config.name);

  // Long free text must be capped rather than accepted unbounded into a JSON column.
  const long = buildTenantBrandingUpdate(CURRENT, { identity: { metaDescription: "x".repeat(5_000) } });
  check("overlong copy rejected", long.errors.length > 0, long.errors);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll tenant branding update checks passed");
