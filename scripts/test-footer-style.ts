// Compact footer style + product-card font weight — RED/GREEN gate
// (npm run test:footer-style).
//
// HP Glow asked for two storefront look changes (reference screenshots):
//   • Image #1 — product-card titles/prices read heavier (Inter, bolder).
//   • Image #2 — a dark "compact" footer: logo + name + tagline on the left,
//     pill quick-links (Lab Reports · FAQ · Viber) on the right, and a centered
//     "Made with ♥ © {year} {brand}. All rights reserved." line.
//
// The reusable core lives in src/lib/storefront/footer-style.ts:
//   - normalizeFooterStyle: untrusted config in → "columns" | "compact",
//     failing closed to "columns" so existing tenants are unaffected.
//   - buildFooterQuickLinks: derives the compact footer's pill buttons from
//     EXISTING brand config (COA page, FAQ page, active contact channels), so
//     no new content fields are invented and other tenants can opt in.
//
// Journeys covered:
//  1. Unset / garbage footerStyle → "columns" (pre-feature look preserved).
//  2. footerStyle "compact" round-trips.
//  3. HP Glow-shaped brand → Lab Reports + FAQ outline pills, then a Viber
//     accent pill whose href is a viber:// deep link and whose label carries
//     the number.
//  4. COA page turned off → no Lab Reports pill (respects page visibility).
//  5. No active contact channel → no accent pill.
//  6. Product-card name/price CSS carries the heavier Inter weights (Image #1).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeFooterStyle,
  buildFooterQuickLinks,
  type FooterQuickLink,
} from "../src/lib/storefront/footer-style";
import type { Brand } from "../src/storefront/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

// A minimal brand fixture — buildFooterQuickLinks only reads a few fields, so a
// partial cast keeps the test focused on the behaviour under test.
function brand(overrides: Partial<Brand>): Brand {
  return { ...(overrides as object) } as Brand;
}

console.log("normalizeFooterStyle — untrusted config in, safe style out");
{
  check("unset → columns", normalizeFooterStyle(undefined) === "columns");
  check("garbage → columns", normalizeFooterStyle("darkmode") === "columns");
  check("null → columns", normalizeFooterStyle(null) === "columns");
  check("'columns' round-trips", normalizeFooterStyle("columns") === "columns");
  check("'compact' round-trips", normalizeFooterStyle("compact") === "compact");
}

console.log("buildFooterQuickLinks — HP Glow shape (Image #2)");
{
  const hpglow = brand({
    showPageCOA: true,
    showPageFAQ: true,
    contactChannels: [{ type: "viber", destination: "09772189091", enabled: true }],
  });
  const links = buildFooterQuickLinks(hpglow);
  const byKey = (k: string): FooterQuickLink | undefined => links.find((l) => l.key === k);

  const coa = byKey("coa");
  check("Lab Reports pill present", !!coa && coa.href === "#coa" && coa.variant === "outline", coa);
  check("Lab Reports labelled 'Lab Reports'", coa?.label === "Lab Reports", coa?.label);
  check("Lab Reports uses shield icon", coa?.icon === "shield", coa?.icon);

  const faq = byKey("faq");
  check("FAQ pill present", !!faq && faq.href === "#faq" && faq.variant === "outline", faq);
  check("FAQ labelled 'FAQ'", faq?.label === "FAQ", faq?.label);

  const viber = links.find((l) => l.variant === "accent");
  check("Viber accent pill present", !!viber, viber);
  check("Viber href is a viber:// deep link", !!viber && viber.href.startsWith("viber://"), viber?.href);
  check("Viber href strips non-digits", viber?.href === "viber://chat?number=09772189091", viber?.href);
  check("Viber label carries the number", !!viber && viber.label.includes("09772189091"), viber?.label);
  check("Viber pill is external", viber?.external === true, viber?.external);

  // Order: outline quick-links first, contact accent pill(s) last (matches the
  // reference — Lab Reports · FAQ · Viber, left to right).
  check(
    "order is coa, faq, viber",
    links.map((l) => l.key).slice(0, 2).join(",") === "coa,faq" && viber === links[links.length - 1],
    links.map((l) => l.key),
  );
}

console.log("buildFooterQuickLinks — respects page visibility & channel state");
{
  const noCoa = buildFooterQuickLinks(
    brand({ showPageCOA: false, showPageFAQ: true, contactChannels: [] }),
  );
  check("COA off → no Lab Reports pill", !noCoa.some((l) => l.key === "coa"), noCoa.map((l) => l.key));
  check("FAQ still present", noCoa.some((l) => l.key === "faq"));

  const noChannels = buildFooterQuickLinks(
    brand({ showPageCOA: true, showPageFAQ: true, contactChannels: [] }),
  );
  check("no active channel → no accent pill", !noChannels.some((l) => l.variant === "accent"), noChannels);

  const disabledChannel = buildFooterQuickLinks(
    brand({
      showPageCOA: true,
      showPageFAQ: true,
      contactChannels: [{ type: "viber", destination: "0917", enabled: false }],
    }),
  );
  check(
    "disabled channel → no accent pill",
    !disabledChannel.some((l) => l.variant === "accent"),
    disabledChannel,
  );
}

console.log("Product-card font weight (Image #1) — Inter, bolder");
{
  const css = readFileSync(join(__dirname, "../src/storefront/storefront.css"), "utf8");
  // The name and price blocks use .font-display (weight 500). The reference
  // reads much heavier, so the product-card rules must override with bold
  // weights. Guard both so a refactor can't silently revert the look.
  const nameRule = css.match(/\.sf-root \.product-card__name\s*\{[^}]*\}/)?.[0] ?? "";
  const priceRule = css.match(/\.sf-root \.product-card__price\s*\{[^}]*\}/)?.[0] ?? "";
  check("product-card__name is >= 700", /font-weight:\s*(700|800|900)/.test(nameRule), nameRule);
  check("product-card__price is >= 800", /font-weight:\s*(800|900)/.test(priceRule), priceRule);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll footer-style checks passed");
