// Read-only audit: what does each tenant's saved footer config actually render
// now that dead links are filtered? (tsx scripts/inspect-footer-config.ts)
//
// Written to size the blast radius of the footer-links change: the stock
// "Legal → Privacy / Terms / Disclaimer" column and the placeholder "#" socials
// were saved into branding.config for every tenant who ever opened the
// Storefront tab, so removing them from BRAND alone would not have reached them.
// Prints saved-vs-rendered per tenant. Touches nothing.

import { PrismaClient } from "@prisma/client";
import { buildFooterColumns, buildFooterSocials } from "@/lib/storefront/footer-links";
import type { Brand, FooterColumn, FooterSocial } from "@/storefront/types";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.branding.findMany({
    select: { tenantId: true, config: true, tenant: { select: { slug: true } } },
  });

  let withLegal = 0;
  let losingSocials = 0;

  for (const row of rows) {
    const config = (row.config ?? {}) as Partial<Brand>;
    const savedCols: FooterColumn[] = config.footerColumns || [];
    const savedSocials: FooterSocial[] = config.footerSocials || [];
    if (savedCols.length === 0 && savedSocials.length === 0) continue;

    const brand = config as Brand;
    const legal = savedCols.find((c) => (c.title || "").trim().toLowerCase() === "legal");
    const renderedCols = buildFooterColumns(brand).map((c) => c.title);
    const renderedSocials = buildFooterSocials(brand);
    const shownBefore = savedSocials.filter((s) => s.show !== false).length;

    if (legal) withLegal++;
    if (shownBefore > renderedSocials.length) losingSocials++;

    console.log(`\n${row.tenant?.slug ?? row.tenantId}`);
    console.log(
      "  saved Legal column :",
      legal ? (legal.links || []).map((l) => `${l.label}→${l.href || "(empty)"}`).join(", ") : "—",
    );
    console.log("  renders columns    :", renderedCols.length ? renderedCols.join(", ") : "(none)");
    console.log(
      "  saved socials      :",
      savedSocials.length
        ? savedSocials
            .map((s) => `${s.label}→${s.href || "(empty)"}${s.show === false ? " [hidden]" : ""}`)
            .join(", ")
        : "—",
    );
    console.log(
      "  renders socials    :",
      renderedSocials.length
        ? renderedSocials.map((s) => `${s.label}→${s.href}`).join(", ")
        : "(none)",
    );
  }

  console.log(
    `\n${withLegal} tenant(s) had a saved Legal column; ${losingSocials} tenant(s) lose at least one linkless social icon.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
