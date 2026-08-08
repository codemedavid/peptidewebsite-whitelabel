// Self-contained gate for the PURELUXXE tenant brief.
//
// Provisioning writes a real shop to the shared database in one transaction, so
// the brief has to be right BEFORE it runs — a mistyped price becomes a live
// storefront quoting the wrong number to real customers, and nothing in the
// provisioning path would notice.
//
// The transcription is the risk. 21 prices were read off a photographed price
// list by hand; every one of them is a number a customer will be charged. So
// they are pinned individually AND by checksum: a single-digit slip that a
// per-item check might survive still moves the total.
//
// The rest is the shape of the store the client asked for — Saudi riyals, the
// Business package, live on day one, reachable on WhatsApp — plus the one thing
// a palette can get silently wrong: unreadable button text.
//
//   npm run test:pureluxxe

import { BRIEF, PALETTE, SLUG, CURRENCY, PRICE_LIST } from "./lib/pureluxxe-brief";

import { onboardingSchema } from "../src/lib/onboarding/schema";
import { buildProvisioning } from "../src/lib/onboarding/mapping";
import { toWaDigits, validateWhatsapp } from "../src/lib/admin/whatsapp";
import { contrastRatio, hexToHslTriple } from "../src/lib/theme/color";
import { normalizeCurrency, formatMoney } from "../src/lib/storefront/currency";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The client's price list, verbatim from the photo they sent. This is the
 *  source of truth the brief is checked AGAINST — deliberately written out a
 *  second time here rather than imported, so a typo in the brief cannot agree
 *  with itself. */
const QUOTED: Record<string, number> = {
  "TIRZE 15": 200,
  "TIRZE 30": 300,
  "TIRZE 60": 400,
  "RETA 30": 450,
  "GHK-Cu": 200,
  "NAD+": 200,
  "GTT (Gluta)": 250,
  "GHK Topical": 150,
  "Fat Blaster": 250,
  "Klow Stack": 350,
  "5-Amino 50mg": 250,
  "KPV 10mg": 220,
  "Cagri 10mg": 250,
  "MOTS-C 10mg": 250,
  "Semax 10mg": 150,
  "Selank 10mg": 150,
  Tesamorelin: 400,
  "LipoC B12": 200,
  "Snap-8": 120,
  "Lemon Bottle": 150,
  "Lemon Bottle China": 100,
};
const QUOTED_TOTAL = 4990;

console.log("Pureluxxe — the tenant brief\n");

// ── The price list ──────────────────────────────────────────────────────────
console.log("every price matches the list the client sent");

check("the catalog has all 21 products", BRIEF.products.length === 21, `got ${BRIEF.products.length}`);

const byName = new Map(BRIEF.products.map((p) => [p.name, p.price]));
for (const [name, price] of Object.entries(QUOTED)) {
  const got = byName.get(name);
  check(
    `${name} is ${formatMoney(price, CURRENCY, { decimals: false })}`,
    got === price,
    got === undefined ? "missing from the brief" : `brief says ${got}`,
  );
}

const total = BRIEF.products.reduce((sum, p) => sum + p.price, 0);
check(
  "the catalog totals the same as the list",
  total === QUOTED_TOTAL,
  `brief totals ${total}, the list totals ${QUOTED_TOTAL} — a digit moved somewhere`,
);
check(
  "no product is unpriced",
  BRIEF.products.every((p) => p.price > 0),
  "a live shop must not list a 0 product",
);
check(
  "every product is filed under a category",
  BRIEF.products.every((p) => (p.category ?? "").trim().length > 0),
  "an uncategorised product falls out of the catalog's browse UI",
);
check(
  "PRICE_LIST agrees with the brief",
  PRICE_LIST.length === BRIEF.products.length &&
    PRICE_LIST.every((row) => byName.get(row.name) === row.price),
);

// ── The shop the client asked for ───────────────────────────────────────────
console.log("\nthe store is the one that was ordered");

check("the slug is pureluxxe", SLUG === "pureluxxe");
check("it trades in Saudi riyals", normalizeCurrency(CURRENCY).code === "SAR", `got ${CURRENCY}`);
check(
  "riyal prices are legible, not glued",
  formatMoney(200, CURRENCY, { decimals: false }) === "SAR 200",
  `got "${formatMoney(200, CURRENCY, { decimals: false })}"`,
);
check("the package is Business", BRIEF.packageKey === "pro", `got ${BRIEF.packageKey}`);
check("the business is named Pureluxxe", BRIEF.businessName === "Pureluxxe");
check("the contact person is recorded", (BRIEF.contactPerson ?? "").trim() === "Jeraldine");
check("the owner's email is the one given", BRIEF.email === "jgraceparfan@gmail.com");

// ── Reachability ────────────────────────────────────────────────────────────
// A storefront whose WhatsApp number is wrong takes orders nobody receives.
console.log("\ncustomers can actually reach the shop");

check("the WhatsApp number is valid", validateWhatsapp(BRIEF.whatsapp).ok, BRIEF.whatsapp);
check(
  "it dials the Saudi number given",
  toWaDigits(BRIEF.whatsapp) === "966592302130",
  `got ${toWaDigits(BRIEF.whatsapp)}`,
);
check("orders are routed to WhatsApp", BRIEF.orderDestination === "whatsapp");
check(
  "the order destination carries the same number",
  toWaDigits(BRIEF.orderDestinationValue ?? "") === "966592302130",
);

// ── The palette ─────────────────────────────────────────────────────────────
// Coral pink, taken from the client's logo. The failure mode a palette hides is
// unreadable button text — nothing else in the pipeline checks it.
console.log("\nthe coral palette is readable");

const ratio = (a: string, b: string) => contrastRatio(hexToHslTriple(a), hexToHslTriple(b));

check(
  "every palette colour is a hex triple",
  [PALETTE.main, PALETTE.accent, PALETTE.button, PALETTE.buttonText].every((c) =>
    /^#[0-9a-fA-F]{6}$/.test(c),
  ),
);
const buttonContrast = ratio(PALETTE.button, PALETTE.buttonText);
check(
  "button text passes WCAG AA on the coral button",
  buttonContrast >= 4.5,
  `contrast is ${buttonContrast.toFixed(2)}:1, AA needs 4.5:1`,
);
const inkContrast = ratio("#ffffff", PALETTE.main);
check(
  "the brand ink is readable on white",
  inkContrast >= 4.5,
  `contrast is ${inkContrast.toFixed(2)}:1`,
);

// ── The brief survives the real pipeline ────────────────────────────────────
// Provisioning runs the same schema + mapping the self-serve wizard runs. If the
// brief can't get through those, --apply would fail halfway.
console.log("\nthe brief provisions cleanly");

const parsed = onboardingSchema.safeParse(BRIEF);
check(
  "the onboarding schema accepts it",
  parsed.success,
  parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)),
);

if (parsed.success) {
  const plan = buildProvisioning(parsed.data, CURRENCY);
  check("the brand config is stamped SAR", plan.brandConfig.currency === "SAR");
  check("tenant settings are stamped SAR", plan.settings.currency === "SAR");
  check(
    "every product row is a riyal row",
    plan.productWrites.length === 21 && plan.productWrites.every((w) => w.currency === "SAR"),
    `got ${plan.productWrites.length} rows`,
  );
  check(
    "no product row lost its price",
    plan.productWrites.every((w) => w.priceCents > 0),
  );
  check(
    "the most expensive product survives the mapping",
    plan.productWrites.some((w) => w.priceCents === 45000),
    "RETA 30 at SAR 450 should map to 45000 minor units",
  );
}

console.log(
  failures === 0 ? "\nAll Pureluxxe checks passed." : `\n${failures} Pureluxxe check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
