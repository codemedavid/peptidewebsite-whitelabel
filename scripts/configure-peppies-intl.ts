/**
 * Configure storefront settings for tenant `peppies-intl`.
 *
 * Writes into the shared `branding.config` blob (read-modify-write, never
 * clobbering the rest of the Brand config), exactly like savePaymentMethodsAction.
 * Only fields that the storefront reads SERVER-SIDE are set here, so they show up
 * on every device/customer:
 *
 *   • paymentMethods  → enables Cash on Delivery (COD) at checkout
 *   • currency        → "₱" (brand.currency, used by the checkout summary)
 *   • checkoutNote    → the ₱150 / Cebu / nationwide / COD line (a real Brand
 *                       field rendered at checkout — unlike `shippingNote`, which
 *                       lives on the Order type, not Brand)
 *
 * Note: the per-region shipping RATE table (ShippingLocation[], the "₱150
 * Nationwide" selectable rate) is kept in the Store Admin → Shipping screen
 * (localStorage in this build), so it can't be seeded from here — add a
 * "Nationwide — ₱150" entry there so it's selectable in the cart total.
 *
 * Run from the project root:
 *   npx tsx scripts/configure-peppies-intl.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "peppies-intl";

// COD payment method (shape mirrors normalizeMethods in actions/storefront-admin.ts).
const PAYMENT_METHODS = [
  {
    id: "cod",
    name: "Cash on Delivery (COD)",
    account: "Pay in cash when your order arrives",
    number: "",
    qrImage: "",
    order: 1,
    active: true,
  },
];

const CURRENCY = "₱";
const CHECKOUT_NOTE =
  "₱150 shipping nationwide 🇵🇭 · Ships from Cebu · COD available 💜 · PH price list effective March 21, 2026. Send us your order and we'll confirm availability, total and shipping.";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...current,
    paymentMethods: PAYMENT_METHODS,
    currency: CURRENCY,
    checkoutNote: CHECKOUT_NOTE,
  };
  // Remove the dead key written by an earlier version (shippingNote isn't a
  // Brand field, so nothing rendered it).
  delete (config as Record<string, unknown>).shippingNote;

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  console.log("Updated branding.config:");
  console.log("  • paymentMethods: Cash on Delivery (COD) — active");
  console.log(`  • currency: ${CURRENCY}`);
  console.log(`  • checkoutNote: ${CHECKOUT_NOTE}`);
  console.log("  • removed stale shippingNote key (if present)");
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
