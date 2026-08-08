// Self-contained gate for the OWNER'S CURRENCY PICKER.
//
// The currency is now a setting every surface honours (see test:currency and
// test:currency-surfaces), but nothing can WRITE it. That makes the feature
// operator-only: a shop can be provisioned in riyals and its owner can never
// change it. The ask was "so i can freely change currency on any currency" —
// which is a screen, not just a resolver.
//
// Two halves.
//
// THE PICKER — a store-admin view, reachable from the nav, gated by a staff
// permission like every other module, saving through a server action. Wiring, so
// the guarantees are structural: the view exists, the nav lists it, the
// permission key exists, the action is exported and gated.
//
// PROVISIONING — the other way a currency gets set. buildProvisioning stamped a
// hardcoded ₱ onto every new tenant's brand config, product rows AND
// StoreSettings, so a store created through onboarding was a peso store however
// it was configured. It must take a currency, and must still default to the peso
// for every existing caller.
//
//   npm run test:currency-picker

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildProvisioning } from "../src/lib/onboarding/mapping";
import { STAFF_MODULES, STAFF_MODULE_KEYS } from "../src/storefront/admin/staff-permissions";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel: string) => {
  try {
    read(rel);
    return true;
  } catch {
    return false;
  }
};

/** A minimal but valid onboarding payload — only the fields buildProvisioning
 *  reads. Cast because the zod-inferred type carries the whole wizard. */
const PAYLOAD = {
  businessName: "Pureluxxe",
  businessType: "beauty and wellness",
  email: "owner@example.com",
  whatsapp: "966500000000",
  orderDestination: "whatsapp",
  orderDestinationValue: "966500000000",
  paymentMethods: [],
  pages: [],
  categories: [],
  products: [
    { name: "TIRZE 15", description: "", price: 200, category: "peptides", imageUrl: "" },
    { name: "GHK-Cu", description: "", price: 200, category: "beauty", imageUrl: "" },
  ],
} as unknown as Parameters<typeof buildProvisioning>[0];

console.log("the owner's currency picker\n");

// ── Provisioning ────────────────────────────────────────────────────────────
// The regression risk: every existing caller passes one argument.
console.log("a new store is provisioned in the currency it was sold in");

const peso = buildProvisioning(PAYLOAD);
check(
  "with no currency the brand is still the peso",
  peso.brandConfig.currency === "₱",
  `got ${JSON.stringify(peso.brandConfig.currency)}`,
);
check("with no currency the settings are still PHP", peso.settings.currency === "PHP");
check(
  "with no currency every product row is still a peso row",
  peso.productWrites.length === 2 && peso.productWrites.every((w) => w.currency === "PHP"),
);

const riyal = buildProvisioning(PAYLOAD, "SAR");
check(
  "the brand config carries the chosen currency",
  riyal.brandConfig.currency === "SAR",
  `got ${JSON.stringify(riyal.brandConfig.currency)}`,
);
check(
  "StoreSettings carries the ISO code",
  riyal.settings.currency === "SAR",
  `got ${JSON.stringify(riyal.settings.currency)}`,
);
check(
  "every product row is written in the chosen currency",
  riyal.productWrites.length === 2 && riyal.productWrites.every((w) => w.currency === "SAR"),
  `got ${JSON.stringify(riyal.productWrites.map((w) => w.currency))}`,
);
check(
  "a product's display symbol matches too",
  riyal.productWrites.every(
    (w) => ((w.metadata as Record<string, unknown> | null)?.currencySymbol ?? "SAR") === "SAR",
  ),
  "a row stamped ₱ would show the old currency on its card forever",
);
check(
  "an unregistered currency is accepted, not swapped for pesos",
  buildProvisioning(PAYLOAD, "ZMW").brandConfig.currency === "ZMW",
  "the list is open — see lib/storefront/currency",
);
check(
  "junk falls back to the peso rather than storing junk",
  buildProvisioning(PAYLOAD, "   ").brandConfig.currency === "₱",
);

// ── The picker is reachable ─────────────────────────────────────────────────
console.log("\nthe owner can find and use the screen");

check(
  "the picker component exists",
  exists("src/storefront/admin/AdminCurrency.tsx"),
  "src/storefront/admin/AdminCurrency.tsx is missing",
);

const nav = exists("src/storefront/admin/admin-nav.ts")
  ? read("src/storefront/admin/admin-nav.ts")
  : "";
check(
  "the nav lists a currency view",
  /view:\s*"currency"/.test(nav),
  "an unreachable screen is not a feature",
);

check(
  "there is a staff permission for it",
  STAFF_MODULE_KEYS.includes("currency"),
  "every other module is gated; an ungated one is a hole in the staff model",
);
check(
  "the permission is labelled for the owner's checklist",
  STAFF_MODULES.some((m) => m.key === "currency" && m.label.trim().length > 0),
);

const page = exists("src/storefront/admin/AdminPage.tsx")
  ? read("src/storefront/admin/AdminPage.tsx")
  : "";
check(
  "the view router renders it",
  page.includes("AdminCurrency"),
  "AdminPage.tsx never mounts the component",
);

// ── The save path ───────────────────────────────────────────────────────────
// Changing currency must not leave rows behind: a product created before the
// switch carries its own captured symbol, and StoreSettings holds an ISO code.
console.log("\nsaving a currency updates everything that stores one");

const actions = read("src/actions/storefront-admin.ts");
check("a save action is exported", /export async function saveCurrencyAction/.test(actions));
check(
  "the action is permission-gated",
  /saveCurrencyAction[\s\S]{0,400}?requireStaffPermission\("currency"\)/.test(actions),
  "an ungated write lets any staff member reprice the whole shop",
);
check(
  "the action re-normalizes untrusted input",
  /saveCurrencyAction[\s\S]{0,600}?normalizeCurrency\(/.test(actions),
  "a tampered form post must not store a value the storefront reads differently",
);
check(
  "the action syncs StoreSettings",
  /saveCurrencyAction[\s\S]{0,1400}?storeSettings\.upsert/.test(actions),
  "StoreSettings.currency would keep the old ISO code",
);
check(
  "the action re-stamps existing product rows",
  /saveCurrencyAction[\s\S]{0,1800}?product\.updateMany/.test(actions),
  "products created before the switch would keep showing the old currency",
);

console.log(
  failures === 0
    ? "\nAll currency-picker checks passed."
    : `\n${failures} currency-picker check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
