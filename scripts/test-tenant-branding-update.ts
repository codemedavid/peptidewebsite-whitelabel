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
// 12. Operator restyles the brand splash → nested merge, bounded durations.
// 13. The tool's JSON schema and this core agree on every field.

import { buildTenantBrandingUpdate } from "../src/lib/tenant/branding-update";
import { THEME_PRESETS } from "../src/lib/theme/presets";
import { UPDATE_BRANDING_TOOL } from "../src/lib/mcp/update-branding-tool";
import {
  MAX_SPLASH_TAGLINE,
  SPLASH_MAX_DURATION_CEILING,
  SPLASH_MAX_DURATION_FLOOR,
  SPLASH_MIN_DURATION_CEILING,
  normalizeBrandSplash,
} from "../src/lib/storefront/brand-splash";

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

console.log("Journey 10 — typography");
{
  const out = buildTenantBrandingUpdate(CURRENT, { fonts: { heading: "Instrument Serif", body: "Inter" } });
  check("no errors", out.errors.length === 0, out.errors);
  check("heading maps to headingFont", out.config.headingFont === "Instrument Serif", out.config.headingFont);
  check("body maps to bodyFont", out.config.bodyFont === "Inter", out.config.bodyFont);
  check("unpatched font keys absent", out.config.priceFont === undefined, out.config.priceFont);

  // "" is how an operator hands a face back to the theme default.
  const inherit = buildTenantBrandingUpdate({ themeId: "clinical-white", config: { ...LIVE_CONFIG, priceFont: "Georgia" } }, {
    fonts: { price: "" },
  });
  check("empty font string clears the override", inherit.config.priceFont === "" && inherit.errors.length === 0, inherit);

  check("unknown font key rejected", buildTenantBrandingUpdate(CURRENT, { fonts: { headline: "Inter" } }).errors.length > 0);
  check("non-string font rejected", buildTenantBrandingUpdate(CURRENT, { fonts: { body: 12 } }).errors.length > 0);
}

console.log("Journey 11 — a tenant with no branding config yet");
{
  // A Branding row can exist with an empty config, or not exist at all. Either
  // way the patch must still land rather than throw on a missing base object.
  for (const bare of [{ themeId: "clinical-white", config: {} }, { config: undefined }, { config: null }]) {
    const out = buildTenantBrandingUpdate(bare, { colors: { text: "#1C1917", background: "#FFFFFF" } });
    check(`patch applies over ${JSON.stringify(bare.config)}`, out.errors.length === 0 && out.config.text === "#1C1917", out);
  }

  // No stored themeId → any known preset is a genuine change, not a no-op.
  const themed = buildTenantBrandingUpdate({ config: {} }, { themeId: "clinical-white" });
  check("theme set on a themeless row", themed.themeId === "clinical-white" && themed.errors.length === 0, themed);
}

console.log("Journey 12 — brand splash");
{
  // The splash is the one brand surface that is a NESTED object, not a flat
  // config key. Every other section writes brandSplash's siblings; this one
  // writes INTO it, so the merge has to recurse or an operator changing the
  // backdrop silently wipes the tagline they set last week.
  const SPLASHED = {
    ...CURRENT,
    config: {
      ...LIVE_CONFIG,
      brandSplash: {
        enabled: true,
        design: "ring",
        logoUrl: "https://ik.imagekit.io/x/splash.png",
        bgColor: "#0B0B0B",
        tagline: "Research-grade peptides",
        showTagline: true,
        minDurationMs: 250,
        maxDurationMs: 900,
      },
    },
  };

  const tinted = buildTenantBrandingUpdate(SPLASHED, { splash: { bgColor: "#111111" } });
  const next = tinted.config.brandSplash as Record<string, unknown>;
  check("no errors on a splash tint", tinted.errors.length === 0, tinted.errors);
  check("bgColor applied", next?.bgColor === "#111111", next);
  check("tagline survives a color-only splash patch", next?.tagline === "Research-grade peptides", next);
  check("design survives", next?.design === "ring", next);
  check("logoUrl survives", next?.logoUrl === "https://ik.imagekit.io/x/splash.png", next);
  check("durations survive", next?.minDurationMs === 250 && next?.maxDurationMs === 900, next);
  check("splash patch reports a scoped path", tinted.changed.includes("splash.bgColor"), tinted.changed);
  check("sibling commerce config survives a splash patch", Array.isArray(tinted.config.paymentMethods), tinted.config.paymentMethods);

  // Fail loud, exactly like every other section.
  check("unknown splash key rejected", buildTenantBrandingUpdate(SPLASHED, { splash: { colour: "#fff" } }).errors.length > 0);
  check("non-hex splash color rejected", buildTenantBrandingUpdate(SPLASHED, { splash: { bgColor: "black" } }).errors.length > 0);
  check("bad design enum rejected", buildTenantBrandingUpdate(SPLASHED, { splash: { design: "spinner" } }).errors.length > 0);
  check("non-boolean enabled rejected", buildTenantBrandingUpdate(SPLASHED, { splash: { enabled: "yes" } }).errors.length > 0);
  check("non-boolean showTagline rejected", buildTenantBrandingUpdate(SPLASHED, { splash: { showTagline: 1 } }).errors.length > 0);
  check("splash must be an object", buildTenantBrandingUpdate(SPLASHED, { splash: "ring" }).errors.length > 0);

  // These land in an inline style attribute and an <img src>. Same trust
  // boundary as colors — the renderer drops junk, but a WRITE must refuse it.
  check(
    "javascript: splash logo rejected",
    buildTenantBrandingUpdate(SPLASHED, { splash: { logoUrl: "javascript:alert(1)" } }).errors.length > 0,
  );
  check(
    "css-smuggling bgColor rejected",
    buildTenantBrandingUpdate(SPLASHED, { splash: { bgColor: "#fff;background-image:url(x)" } }).errors.length > 0,
  );

  // Duration bounds are the reason an operator can't hide a live storefront
  // behind a loading screen by typing an extra zero.
  check(
    "over-ceiling maxDurationMs rejected",
    buildTenantBrandingUpdate(SPLASHED, { splash: { maxDurationMs: SPLASH_MAX_DURATION_CEILING + 1 } }).errors.length > 0,
  );
  check(
    "below-floor maxDurationMs rejected",
    buildTenantBrandingUpdate(SPLASHED, { splash: { maxDurationMs: SPLASH_MAX_DURATION_FLOOR - 1 } }).errors.length > 0,
  );
  check(
    "over-ceiling minDurationMs rejected",
    buildTenantBrandingUpdate(SPLASHED, { splash: { minDurationMs: SPLASH_MIN_DURATION_CEILING + 1 } }).errors.length > 0,
  );
  check("non-number duration rejected", buildTenantBrandingUpdate(SPLASHED, { splash: { minDurationMs: "250" } }).errors.length > 0);

  // The renderer silently yields the floor to the ceiling. A remote caller
  // cannot see that happen, so the write path says so instead of quietly
  // storing a pair that won't be honoured.
  const incoherent = buildTenantBrandingUpdate(SPLASHED, { splash: { minDurationMs: 2000 } });
  check("min above the stored max rejected", incoherent.errors.length > 0, incoherent.errors);
  check(
    "min above max is fine when both move together",
    buildTenantBrandingUpdate(SPLASHED, { splash: { minDurationMs: 2000, maxDurationMs: 2500 } }).errors.length === 0,
  );

  const long = buildTenantBrandingUpdate(SPLASHED, { splash: { tagline: "x".repeat(MAX_SPLASH_TAGLINE + 1) } });
  check("over-length tagline rejected", long.errors.length > 0, long.errors);

  // Clearing, the same way fonts clear: "" is a deliberate reset to the theme.
  const cleared = buildTenantBrandingUpdate(SPLASHED, { splash: { bgColor: "", logoUrl: "" } });
  const clearedSplash = cleared.config.brandSplash as Record<string, unknown>;
  check("empty splash color clears to the theme", cleared.errors.length === 0 && clearedSplash?.bgColor === "", cleared.errors);
  check("empty splash logo clears the upload", clearedSplash?.logoUrl === "", clearedSplash);

  // Turning it off is a one-key patch and must not disturb the styling behind it.
  const off = buildTenantBrandingUpdate(SPLASHED, { splash: { enabled: false } });
  const offSplash = off.config.brandSplash as Record<string, unknown>;
  check("splash can be switched off", off.errors.length === 0 && offSplash?.enabled === false, off.errors);
  check("styling survives being switched off", offSplash?.bgColor === "#0B0B0B", offSplash);

  // A tenant that has never opened the splash editor has no brandSplash at all.
  const fresh = buildTenantBrandingUpdate({ config: {} }, { splash: { design: "bar", accentColor: "#22C55E" } });
  const freshSplash = fresh.config.brandSplash as Record<string, unknown>;
  check("splash patch applies to a tenant with no brandSplash", fresh.errors.length === 0, fresh.errors);
  check("design written on a fresh tenant", freshSplash?.design === "bar", freshSplash);
  check("accentColor written on a fresh tenant", freshSplash?.accentColor === "#22C55E", freshSplash);

  // A no-op splash patch is a false success, same as every other section.
  check(
    "unchanged splash patch rejected as a no-op",
    buildTenantBrandingUpdate(SPLASHED, { splash: { design: "ring" } }).errors.length > 0,
  );

  // The normalizer must accept everything this writes, or the two halves have
  // drifted and the storefront would silently ignore an accepted patch.
  const round = buildTenantBrandingUpdate(SPLASHED, {
    splash: { design: "bar", accentColor: "#22C55E", tagline: "Peptides, properly", showTagline: true },
  });
  const normalized = normalizeBrandSplash(round.config.brandSplash);
  check("what the patch writes, the renderer reads back", normalized.design === "bar" && normalized.accentColor === "#22C55E", normalized);
  check("tagline round-trips through the normalizer", normalized.tagline === "Peptides, properly" && normalized.showTagline === true, normalized);
}

console.log("Journey 13 — the schema and the core cannot drift");
{
  // These two halves are edited in different files and fail in opposite
  // directions, which is how they drift unnoticed:
  //
  //   in the SCHEMA but not the CORE → the connector advertises a field, the
  //   model sends it, and the core rejects the WHOLE patch as an unknown key.
  //   in the CORE but not the SCHEMA → the field is unreachable. ChatGPT never
  //   learns it exists, so the capability silently isn't there. That is exactly
  //   what happened to layout.homeLayout, which this check now pins.
  //
  // Probing the core with a real patch per key is what makes this a behavior
  // test rather than two lists copied into a third place.
  const schema = UPDATE_BRANDING_TOOL.inputSchema.properties as Record<string, { properties?: Record<string, unknown>; enum?: string[]; type?: string }>;
  const BASE = { config: {} };

  // Every section the schema advertises must be a section the core accepts.
  for (const section of ["colors", "fonts", "layout", "hero", "identity", "catalog", "splash"]) {
    check(`schema advertises the ${section} section`, Boolean(schema[section]?.properties), Object.keys(schema));
    const rejected = buildTenantBrandingUpdate(BASE, { [section]: {} }).errors.some((e) =>
      e.includes(`Unknown branding section "${section}"`),
    );
    check(`core accepts the ${section} section`, !rejected);
  }

  // A value the core will accept for each JSON type, so the probe tests the
  // KEY's existence rather than accidentally testing its validation.
  const probeFor = (spec: { type?: string; enum?: string[] }): unknown => {
    if (spec.enum?.length) return spec.enum[0];
    if (spec.type === "boolean") return true;
    if (spec.type === "number") return undefined; // ranges differ per key; see below
    return "";
  };

  for (const section of ["colors", "fonts", "layout", "hero", "identity", "catalog", "splash"]) {
    const props = (schema[section]?.properties ?? {}) as Record<string, { type?: string; enum?: string[] }>;
    for (const [key, spec] of Object.entries(props)) {
      const probe = probeFor(spec);
      // Numbers carry per-key ranges the schema states only in prose; an
      // unknown-key error is still distinguishable from a range error.
      const patch = { [section]: { [key]: probe === undefined ? 0 : probe } };
      const errors = buildTenantBrandingUpdate(BASE, patch).errors;
      const unknown = errors.some((e) => e.includes(`Unknown ${section} field "${key}"`));
      check(`${section}.${key} is known to the core`, !unknown, errors);
    }
  }

  // The other direction, and the one that actually bit: a field the core
  // accepts but the schema never advertises is UNREACHABLE — ChatGPT is never
  // told it exists. The core already publishes its own allow-list in the
  // unknown-key error, so probe it with a key nothing could legitimately use
  // rather than duplicating the field tables into this test.
  for (const section of ["colors", "fonts", "layout", "hero", "identity", "catalog", "splash"]) {
    const [error] = buildTenantBrandingUpdate(BASE, { [section]: { __drift_probe__: 1 } }).errors;
    const allowed = (error?.match(/Allowed: (.+)\.$/)?.[1] ?? "").split(", ").filter(Boolean);
    check(`${section} publishes its allow-list`, allowed.length > 0, error);

    const advertised = new Set(Object.keys(schema[section]?.properties ?? {}));
    const unreachable = allowed.filter((key) => !advertised.has(key));
    check(`every ${section} field the core accepts is advertised`, unreachable.length === 0, unreachable);
  }

  // And the enums: every value the schema pins must match the core's, or the
  // connector offers a value the core refuses.
  const layoutProps = (schema.layout?.properties ?? {}) as Record<string, { enum?: string[] }>;
  for (const [key, spec] of Object.entries(layoutProps)) {
    if (!spec.enum) continue;
    for (const value of spec.enum) {
      const errors = buildTenantBrandingUpdate(BASE, { layout: { [key]: value } }).errors;
      check(`layout.${key}="${value}" is accepted by the core`, !errors.some((e) => e.startsWith(`layout.${key}`)), errors);
    }
  }

  const splashProps = (schema.splash?.properties ?? {}) as Record<string, { enum?: string[] }>;
  for (const value of splashProps.design?.enum ?? []) {
    const errors = buildTenantBrandingUpdate(BASE, { splash: { design: value } }).errors;
    check(`splash.design="${value}" is accepted by the core`, !errors.some((e) => e.startsWith("splash.design")), errors);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll tenant branding update checks passed");
