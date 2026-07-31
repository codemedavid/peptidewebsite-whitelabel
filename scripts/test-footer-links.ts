// Footer links — dead-link hygiene gate (npm run test:footer-links).
//
// Two owner-facing asks, one shared rule: a footer link nobody can follow
// should not be on the page.
//
//   1. The stock "Legal → Privacy / Terms / Disclaimer" column shipped in
//      BRAND.footerColumns with every href set to "#". Three dead links on
//      every store. It is gone from the defaults, and dropped at render time
//      for the tenants who already saved it — but ONLY while all of its links
//      are dead, so an operator who pastes real policy URLs keeps the column.
//
//   2. Social icons rendered whenever `show !== false`, regardless of href, so
//      the three placeholder socials in the defaults ("#") drew three icons
//      that went nowhere. Now a link IS the switch: no usable URL → no icon.
//      The branding editor (super admin → Storefront tab, and the store-admin
//      Tweaks panel — same component) offers one URL field per platform, and
//      "empty" is the default state.
//
// The core lives in src/lib/storefront/footer-links.ts. Everything there takes
// untrusted branding.config JSON and fails closed: unparseable or non-http(s)
// hrefs (javascript:, data:, mailto:) resolve to "" and therefore render
// nothing, which also closes the config-driven XSS hole the old
// `<a href={s.href}>` had.
//
// Journeys covered:
//  1. isDeadHref classifies placeholder hrefs without eating real hash routes.
//  2. normalizeSocialHref upgrades bare handles, rejects unsafe schemes.
//  3. buildFooterSocials hides linkless socials, honours the hide-only `show`.
//  4. buildFooterColumns drops the placeholder Legal column, keeps a real one.
//  5. The shipped defaults (src/storefront/data.ts) carry no Legal column and
//     no placeholder social hrefs.
//  6. Footer.tsx opens socials with rel="noopener noreferrer", and the editor
//     is wired to the platform registry.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isDeadHref,
  normalizeSocialHref,
  buildFooterSocials,
  buildFooterColumns,
  SOCIAL_PLATFORMS,
} from "../src/lib/storefront/footer-links";
import { BRAND } from "../src/storefront/data";
import type { Brand, FooterColumn, FooterSocial } from "../src/storefront/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

// Partial fixtures: the helpers read a handful of Brand fields, so a cast keeps
// each test focused on the behaviour under test (same shape as test-footer-style).
function brand(overrides: Partial<Brand>): Brand {
  return { ...(overrides as object) } as Brand;
}
const titles = (cols: FooterColumn[]) => cols.map((c) => c.title);
const labels = (socials: FooterSocial[]) => socials.map((s) => s.label);

console.log("isDeadHref — placeholder vs. real destination");
{
  check("empty string is dead", isDeadHref(""));
  check("whitespace is dead", isDeadHref("   "));
  check("'#' is dead", isDeadHref("#"));
  check("'#!' is dead", isDeadHref("#!"));
  check("'/' is dead", isDeadHref("/"));
  check("bare 'https://' is dead", isDeadHref("https://"));
  check("undefined is dead", isDeadHref(undefined));
  check("null is dead", isDeadHref(null));
  check("non-string is dead", isDeadHref(42));

  check("'#catalog' is alive", !isDeadHref("#catalog"));
  check("'#faq' is alive", !isDeadHref("#faq"));
  check("https URL is alive", !isDeadHref("https://example.com/privacy"));
  check("mailto is alive", !isDeadHref("mailto:hello@store.ph"));
  check("relative path is alive", !isDeadHref("/privacy"));
}

console.log("normalizeSocialHref — usable http(s) URL or nothing");
{
  check(
    "https URL kept",
    normalizeSocialHref("https://instagram.com/mystore") === "https://instagram.com/mystore",
    normalizeSocialHref("https://instagram.com/mystore"),
  );
  check("http URL kept", normalizeSocialHref("http://x.com/a") === "http://x.com/a");
  check(
    "surrounding whitespace trimmed",
    normalizeSocialHref("  https://t.me/mystore  ") === "https://t.me/mystore",
    normalizeSocialHref("  https://t.me/mystore  "),
  );
  check(
    "scheme-less domain upgraded to https",
    normalizeSocialHref("instagram.com/mystore") === "https://instagram.com/mystore",
    normalizeSocialHref("instagram.com/mystore"),
  );
  check(
    "www. domain upgraded to https",
    normalizeSocialHref("www.facebook.com/mystore") === "https://www.facebook.com/mystore",
    normalizeSocialHref("www.facebook.com/mystore"),
  );

  check("empty → ''", normalizeSocialHref("") === "");
  check("'#' → ''", normalizeSocialHref("#") === "");
  check("whitespace → ''", normalizeSocialHref("   ") === "");
  check("undefined → ''", normalizeSocialHref(undefined) === "");
  // Untrusted config must never reach an href attribute with an active scheme.
  check("javascript: rejected", normalizeSocialHref("javascript:alert(1)") === "");
  check("JavaScript: rejected (case-insensitive)", normalizeSocialHref("JavaScript:alert(1)") === "");
  check(
    "javascript: with padding rejected",
    normalizeSocialHref("  javascript:alert(1)") === "",
    normalizeSocialHref("  javascript:alert(1)"),
  );
  check("data: rejected", normalizeSocialHref("data:text/html,<script>x</script>") === "");
  check("mailto: rejected for socials", normalizeSocialHref("mailto:hi@store.ph") === "");
  check("bare handle rejected (no domain)", normalizeSocialHref("@mystore") === "");
}

console.log("SOCIAL_PLATFORMS — one entry per drawable glyph");
{
  const icons = SOCIAL_PLATFORMS.map((p) => p.icon);
  for (const want of ["instagram", "facebook", "twitter", "tiktok", "telegram", "whatsapp", "viber"]) {
    check(`registry covers ${want}`, icons.includes(want), icons);
  }
  check("every platform has a label", SOCIAL_PLATFORMS.every((p) => !!p.label));
  check("every platform has a placeholder", SOCIAL_PLATFORMS.every((p) => !!p.placeholder));
  check("no duplicate icons", new Set(icons).size === icons.length, icons);
}

console.log("buildFooterSocials — a link is the switch");
{
  const placeholders = brand({
    footerSocials: [
      { label: "Instagram", href: "#", icon: "instagram", show: true },
      { label: "Facebook", href: "", icon: "facebook", show: true },
      { label: "Twitter", href: "   ", icon: "twitter", show: true },
    ],
  });
  check(
    "all-placeholder socials → none rendered",
    buildFooterSocials(placeholders).length === 0,
    buildFooterSocials(placeholders),
  );

  const mixed = brand({
    footerSocials: [
      { label: "Instagram", href: "https://instagram.com/mystore", icon: "instagram", show: true },
      { label: "Facebook", href: "#", icon: "facebook", show: true },
      { label: "TikTok", href: "tiktok.com/@mystore", icon: "tiktok", show: true },
    ],
  });
  const built = buildFooterSocials(mixed);
  check("only linked socials survive", labels(built).join(",") === "Instagram,TikTok", labels(built));
  check(
    "scheme-less href normalized on the way out",
    built[1]?.href === "https://tiktok.com/@mystore",
    built[1]?.href,
  );
  check("display order preserved", built[0]?.label === "Instagram", labels(built));

  const hidden = brand({
    footerSocials: [
      { label: "Instagram", href: "https://instagram.com/mystore", icon: "instagram", show: false },
      { label: "Viber", href: "https://viber.com/mystore", icon: "viber", show: true },
    ],
  });
  check(
    "show:false still hides a linked social",
    labels(buildFooterSocials(hidden)).join(",") === "Viber",
    labels(buildFooterSocials(hidden)),
  );

  const unsafe = brand({
    footerSocials: [{ label: "Bad", href: "javascript:alert(1)", icon: "circle", show: true }],
  });
  check("unsafe scheme never renders", buildFooterSocials(unsafe).length === 0, buildFooterSocials(unsafe));

  const sectionOff = brand({
    footerShowSocials: false,
    footerSocials: [{ label: "Instagram", href: "https://instagram.com/x", icon: "instagram", show: true }],
  });
  check("footerShowSocials:false → none", buildFooterSocials(sectionOff).length === 0);

  check("missing footerSocials → []", buildFooterSocials(brand({})).length === 0);

  const unknownIcon = brand({
    footerSocials: [{ label: "Threads", href: "https://threads.net/@x", icon: "threads", show: true }],
  });
  check(
    "unknown icon falls back to the generic glyph",
    buildFooterSocials(unknownIcon)[0]?.icon === "circle",
    buildFooterSocials(unknownIcon)[0]?.icon,
  );
}

console.log("buildFooterColumns — the placeholder Legal column retires");
function legalCol(hrefs: string[]): FooterColumn {
  return {
    title: "Legal",
    links: [
      { label: "Privacy", href: hrefs[0] },
      { label: "Terms", href: hrefs[1] },
      { label: "Disclaimer", href: hrefs[2] },
    ],
  };
}
{
  const shopCol: FooterColumn = {
    title: "Shop",
    links: [
      { label: "All Products", href: "#catalog" },
      { label: "Featured", href: "#" },
    ],
  };

  const stock = brand({ footerColumns: [shopCol, legalCol(["#", "#", "#"])] });
  const stockCols = buildFooterColumns(stock);
  check("all-dead Legal column dropped", !titles(stockCols).includes("Legal"), titles(stockCols));
  check("other columns untouched", titles(stockCols).includes("Shop"), titles(stockCols));
  // Narrow on purpose: only the Legal column is subject to the dead-link sweep,
  // so the rest of the stock footer keeps rendering exactly as before.
  check(
    "dead links in non-legal columns preserved",
    stockCols.find((c) => c.title === "Shop")?.links.length === 2,
    stockCols.find((c) => c.title === "Shop")?.links,
  );

  const real = brand({
    footerColumns: [
      legalCol(["https://store.ph/privacy", "https://store.ph/terms", "https://store.ph/disclaimer"]),
    ],
  });
  check(
    "Legal column with real URLs kept",
    titles(buildFooterColumns(real)).includes("Legal"),
    titles(buildFooterColumns(real)),
  );

  const partly = brand({ footerColumns: [legalCol(["https://store.ph/privacy", "#", "#"])] });
  const partlyCols = buildFooterColumns(partly);
  check("one real link keeps the Legal column", titles(partlyCols).includes("Legal"), titles(partlyCols));

  const lowercase = brand({
    footerColumns: [{ title: "  legal  ", links: [{ label: "Privacy", href: "#" }] }],
  });
  check(
    "title match is case/whitespace insensitive",
    buildFooterColumns(lowercase).length === 0,
    titles(buildFooterColumns(lowercase)),
  );

  // Pre-existing behaviour that must survive the refactor.
  const legalOff = brand({
    footerShowLegal: false,
    footerColumns: [
      legalCol(["https://store.ph/privacy", "https://store.ph/terms", "https://store.ph/x"]),
    ],
  });
  check(
    "footerShowLegal:false drops even a real Legal column",
    buildFooterColumns(legalOff).length === 0,
    titles(buildFooterColumns(legalOff)),
  );

  const hiddenPage = brand({
    showPageFAQ: false,
    footerColumns: [
      { title: "Support", links: [{ label: "FAQ", href: "#faq" }, { label: "Track", href: "#track" }] },
    ],
  });
  const hiddenCols = buildFooterColumns(hiddenPage);
  check(
    "links to hidden pages stripped",
    hiddenCols[0]?.links.length === 1 && hiddenCols[0]?.links[0]?.label === "Track",
    hiddenCols[0]?.links,
  );

  const emptied = brand({
    showPageFAQ: false,
    footerColumns: [{ title: "Support", links: [{ label: "FAQ", href: "#faq" }] }],
  });
  check(
    "column emptied by visibility is dropped",
    buildFooterColumns(emptied).length === 0,
    titles(buildFooterColumns(emptied)),
  );

  check("missing footerColumns → []", buildFooterColumns(brand({})).length === 0);

  const columnsOff = brand({ footerShowColumns: false, footerColumns: [shopCol] });
  check(
    "footerShowColumns:false → []",
    buildFooterColumns(columnsOff).length === 0,
    titles(buildFooterColumns(columnsOff)),
  );

  // The reseller column is appended for entitled tenants (was inline in Footer).
  const reseller = brand({ showPageMerchant: true, footerColumns: [shopCol] });
  check(
    "entitled tenant gets a Wholesale column",
    titles(buildFooterColumns(reseller)).includes("Wholesale"),
    titles(buildFooterColumns(reseller)),
  );
  const alreadyLinked = brand({
    showPageMerchant: true,
    footerColumns: [{ title: "Shop", links: [{ label: "Reseller pricing", href: "#merchant" }] }],
  });
  check(
    "no duplicate Wholesale column when already linked",
    buildFooterColumns(alreadyLinked).filter((c) => c.title === "Wholesale").length === 0,
    titles(buildFooterColumns(alreadyLinked)),
  );
  check(
    "not entitled → no Wholesale column",
    !titles(buildFooterColumns(brand({ footerColumns: [shopCol] }))).includes("Wholesale"),
  );
}

console.log("Shipped defaults (src/storefront/data.ts)");
{
  const cols = BRAND.footerColumns || [];
  check(
    "no Legal column in the defaults",
    !cols.some((c) => (c.title || "").trim().toLowerCase() === "legal"),
    titles(cols),
  );
  check(
    "no Privacy/Terms/Disclaimer link anywhere in the defaults",
    !cols.some((c) =>
      (c.links || []).some((l) =>
        ["privacy", "terms", "disclaimer"].includes((l.label || "").trim().toLowerCase()),
      ),
    ),
    cols.flatMap((c) => (c.links || []).map((l) => l.label)),
  );
  check("other default columns still ship", cols.length >= 3, titles(cols));
  check(
    "default socials carry no placeholder href",
    (BRAND.footerSocials || []).every((s) => !s.href || s.href.trim() === ""),
    (BRAND.footerSocials || []).map((s) => s.href),
  );
  check(
    "a brand-new store renders zero social icons",
    buildFooterSocials(BRAND).length === 0,
    buildFooterSocials(BRAND),
  );
  check(
    "a brand-new store renders no Legal column",
    !titles(buildFooterColumns(BRAND)).includes("Legal"),
    titles(buildFooterColumns(BRAND)),
  );
}

console.log("Wiring guards");
{
  const footer = readFileSync(join(__dirname, "../src/storefront/components/Footer.tsx"), "utf8");
  check("Footer renders socials from buildFooterSocials", footer.includes("buildFooterSocials("), false);
  check("Footer renders columns from buildFooterColumns", footer.includes("buildFooterColumns("), false);
  // Outbound social links must not hand window.opener to the target page.
  const socialAnchor = footer.match(/<a[^>]*site-footer__social[^>]*>/s)?.[0] ?? "";
  check(
    'social anchor carries target="_blank" + rel="noopener noreferrer"',
    /rel="noopener noreferrer"/.test(socialAnchor) && /target="_blank"/.test(socialAnchor),
    socialAnchor,
  );

  const editor = readFileSync(join(__dirname, "../src/storefront/tweaks/FooterEditor.tsx"), "utf8");
  check("editor drives its rows off SOCIAL_PLATFORMS", editor.includes("SOCIAL_PLATFORMS"), false);
  check("editor validates hrefs with normalizeSocialHref", editor.includes("normalizeSocialHref"), false);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll footer-links checks passed");
