/**
 * Self-contained test for the "pay first, details later" sign-up flow
 * (no DB, no Next, no network).
 *
 *   1. QR PH as a platform payment method — a 2% processing fee on the FULL
 *      checkout total (base + Starter extras + setup fee), integer centavos.
 *      checkoutQuote() (client paybox) and amountDueFromConfig() (server stamp)
 *      must agree for the same inputs.
 *   2. normalizePackagePayment keeps the operator's qrph tag; anything that is
 *      not literally `true` reads false (so no existing method starts charging).
 *   3. The opaque access token: only its sha256 is stored, deterministically.
 *   4. Pure decisions the server actions hang off:
 *        - detailsUpdateDecision — who may send post-payment details
 *        - decideLeadWrite       — update an existing lead vs insert a new one
 *   5. Wizard shape: business → package → checkout before payment; branding,
 *      products, orders and payments become optional post-payment steps.
 *
 *   npm run test:onboarding-pay-first
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkoutQuote,
  amountDueFromConfig,
  qrphFeeCents,
} from "../src/lib/onboarding/pricing";
import { defaultPlanConfig } from "../src/lib/platform/plan-config";
import { packagesFrom } from "../src/marketing/config";
import { STARTER_EXTRA_FEATURE_PRICE_CENTS, onboardingSchema } from "../src/lib/onboarding/schema";
import {
  normalizePackagePayment,
  defaultPackagePayment,
} from "../src/lib/platform/package-payment";
import { QRPH_FEE_PERCENT } from "../src/lib/storefront/payment-fee";
import { newAccessToken, hashAccessToken } from "../src/lib/onboarding/access-token";
import {
  detailsUpdateDecision,
  decideLeadWrite,
  whatsappKey,
  submissionReference,
  LEAD_DEDUPE_WINDOW_MS,
} from "../src/lib/onboarding/pay-first";
import { baseStoreSlug, pickStoreSlug, RESERVED_STORE_SLUGS } from "../src/lib/onboarding/store-slug";
import {
  STEPS,
  DETAILS_STEPS,
  INITIAL_DRAFT,
  validateStep,
  draftToPayload,
  type Draft,
} from "../src/components/onboarding/useOnboardingForm";
import { SITE, PACKAGE_PAYMENT } from "../src/marketing/config";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const pkgs = packagesFrom(defaultPlanConfig().plans);
const pkg = (k: string) => pkgs.find((p) => p.key === k)!;
const config = defaultPlanConfig();

// ──────────────────────────── 1. QR PH fee ────────────────────────────
console.log("\nQR PH processing fee (2%) on the package checkout\n");

check("the platform fee uses the storefront's QR PH rate (2%)", () => {
  assert.strictEqual(QRPH_FEE_PERCENT, 2);
  assert.strictEqual(qrphFeeCents(100_000), 2_000);
});

check("qrphFeeCents rounds to whole centavos (no float dust)", () => {
  // 2% of ₱1,123.45 = ₱22.469 → 2247 centavos
  assert.strictEqual(qrphFeeCents(112_345), 2_247);
  assert.ok(Number.isInteger(qrphFeeCents(129_800)));
  assert.strictEqual(qrphFeeCents(0), 0);
  assert.strictEqual(qrphFeeCents(-500), 0);
});

check("non-QR PH method → no fee, total unchanged", () => {
  const q = checkoutQuote(pkg("starter"), { trial: false, extraFeatureCount: 0, qrphFee: false });
  assert.strictEqual(q.paymentFeeCents, 0);
  assert.strictEqual(q.totalCents, 129_800);
  const legacy = checkoutQuote(pkg("starter"), { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(legacy.paymentFeeCents, 0, "fee must default off");
  assert.strictEqual(legacy.totalCents, 129_800);
});

check("QR PH → +2% of base + setup fee (Starter monthly ₱1,298 → ₱1,323.96)", () => {
  const q = checkoutQuote(pkg("starter"), { trial: false, extraFeatureCount: 0, qrphFee: true });
  assert.strictEqual(q.paymentFeeCents, 2_596);
  assert.strictEqual(q.totalCents, 129_800 + 2_596);
});

check("QR PH fee covers yearly base + setup fee + Starter extras together", () => {
  const plain = checkoutQuote(pkg("starter"), {
    trial: false,
    extraFeatureCount: 2,
    billingCycle: "yearly",
  });
  const q = checkoutQuote(pkg("starter"), {
    trial: false,
    extraFeatureCount: 2,
    billingCycle: "yearly",
    qrphFee: true,
  });
  const preFee = plain.baseCents + plain.addonCents + plain.setupFeeCents;
  assert.strictEqual(plain.totalCents, preFee);
  assert.strictEqual(q.addonCents, 2 * STARTER_EXTRA_FEATURE_PRICE_CENTS);
  assert.ok(q.setupFeeCents > 0, "Starter carries a setup fee");
  assert.strictEqual(q.paymentFeeCents, Math.round((preFee * 2) / 100));
  assert.strictEqual(q.totalCents, preFee + q.paymentFeeCents);
});

check("amountDueFromConfig equals the client quote for the same inputs (with + without fee)", () => {
  for (const planKey of ["starter", "pro", "enterprise"]) {
    for (const billingCycle of ["monthly", "yearly"] as const) {
      for (const qrphFee of [false, true]) {
        const extra = planKey === "starter" ? 1 : 0;
        const client = checkoutQuote(pkg(planKey), {
          trial: false,
          extraFeatureCount: extra,
          billingCycle,
          qrphFee,
        }).totalCents;
        const server = amountDueFromConfig(config, {
          planKey,
          trial: false,
          extraFeatureCount: extra,
          billingCycle,
          qrphFee,
        });
        assert.strictEqual(server, client, `${planKey}/${billingCycle}/qrph=${qrphFee}`);
      }
    }
  }
});

// ──────────────────────────── 2. qrph tag ────────────────────────────
console.log("\nPackagePaymentMethod.qrph\n");

check("normalizePackagePayment keeps qrph: true", () => {
  const c = normalizePackagePayment({ methods: [{ id: "a", method: "QR PH", qrph: true }] });
  assert.strictEqual(c.methods[0].qrph, true);
});

check("absent / garbage qrph defaults to false", () => {
  const c = normalizePackagePayment({
    methods: [
      { id: "a", method: "GCash" },
      { id: "b", method: "Maya", qrph: "true" },
      { id: "c", method: "Bank", qrph: 1 },
      { id: "d", method: "X", qrph: null },
    ],
  });
  assert.deepStrictEqual(
    c.methods.map((m) => m.qrph),
    [false, false, false, false],
  );
});

check("the code fallback ships a QR PH method tagged qrph with the owner's QR image", () => {
  const qr = PACKAGE_PAYMENT.methods.find((m) => m.qrph);
  assert.ok(qr, "no qrph method in PACKAGE_PAYMENT");
  assert.strictEqual(qr!.method, "QR PH");
  assert.strictEqual(qr!.account, "Jonina David");
  assert.strictEqual(qr!.qr, "/payment/qrph-qr.jpg");
  const lifted = defaultPackagePayment().methods.find((m) => m.method === "QR PH");
  assert.ok(lifted?.qrph, "defaultPackagePayment drops the qrph tag");
  assert.ok(
    defaultPackagePayment().methods.filter((m) => m.method !== "QR PH").every((m) => !m.qrph),
    "only QR PH carries the fee",
  );
});

check("the admin manager exposes a per-method QR PH checkbox", () => {
  const src = read("src/components/admin/pages/PackagePaymentManager.tsx");
  assert.ok(/qrph/.test(src), "PackagePaymentManager does not touch qrph");
  assert.ok(/2% processing fee/.test(src), "checkbox copy missing");
});

// ──────────────────────────── 3. token ────────────────────────────
console.log("\nAccess token\n");

check("hashAccessToken is deterministic and never equals the raw token", () => {
  const t = newAccessToken();
  assert.ok(t.length >= 40, "32 random bytes → ≥ 43 base64url chars");
  assert.ok(/^[A-Za-z0-9_-]+$/.test(t), "token must be base64url");
  assert.strictEqual(hashAccessToken(t), hashAccessToken(t));
  assert.notStrictEqual(hashAccessToken(t), t);
  assert.notStrictEqual(newAccessToken(), t, "tokens must be fresh");
  assert.match(hashAccessToken(t), /^[0-9a-f]{64}$/);
});

// ──────────────────────────── 4. pure decisions ────────────────────────────
console.log("\nDetails-update guard\n");

check("refuses an unknown token", () => {
  const d = detailsUpdateDecision(null);
  assert.strictEqual(d.ok, false);
});

check("refuses a submission with no tenant (an unpaid lead)", () => {
  assert.strictEqual(detailsUpdateDecision({ tenantId: null, tenantStatus: null }).ok, false);
});

check("refuses a tenant that is no longer pending_setup (never overwrite a live store)", () => {
  for (const s of ["active", "suspended", "cancelled"]) {
    assert.strictEqual(detailsUpdateDecision({ tenantId: "t1", tenantStatus: s }).ok, false, s);
  }
});

check("allows a pending_setup tenant", () => {
  assert.strictEqual(detailsUpdateDecision({ tenantId: "t1", tenantStatus: "pending_setup" }).ok, true);
});

console.log("\nLead dedupe\n");

const now = new Date("2026-11-13T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const lead = (over: Partial<Parameters<typeof decideLeadWrite>[0]["recent"][number]> = {}) => ({
  id: "lead1",
  whatsapp: "0917 123 4567",
  tenantId: null as string | null,
  setupStatus: "lead",
  createdAt: ago(60 * 60 * 1000),
  ...over,
});

check("whatsappKey treats 0917… and +63 917… as the same number", () => {
  assert.strictEqual(whatsappKey("0917 123 4567"), whatsappKey("+63 917 123 4567"));
  assert.strictEqual(whatsappKey("639171234567"), "639171234567");
});

check("same WhatsApp within 24h, no tenant → update that lead", () => {
  const d = decideLeadWrite({ whatsapp: "+63 917 123 4567", now, tokenMatch: null, recent: [lead()] });
  assert.deepStrictEqual(d, { action: "update", id: "lead1" });
});

check("same WhatsApp but older than 24h → insert", () => {
  const d = decideLeadWrite({
    whatsapp: "639171234567",
    now,
    tokenMatch: null,
    recent: [lead({ createdAt: ago(LEAD_DEDUPE_WINDOW_MS + 1000) })],
  });
  assert.deepStrictEqual(d, { action: "insert" });
});

check("same WhatsApp but the row already has a tenant → insert", () => {
  const d = decideLeadWrite({
    whatsapp: "639171234567",
    now,
    tokenMatch: null,
    recent: [lead({ tenantId: "t1", setupStatus: "tenant_created" })],
  });
  assert.deepStrictEqual(d, { action: "insert" });
});

check("different WhatsApp → insert", () => {
  const d = decideLeadWrite({ whatsapp: "639998887777", now, tokenMatch: null, recent: [lead()] });
  assert.deepStrictEqual(d, { action: "insert" });
});

check("a valid lead token wins (updates its own row even with a new number)", () => {
  const mine = lead({ id: "mine", whatsapp: "639000000001" });
  const d = decideLeadWrite({ whatsapp: "639171234567", now, tokenMatch: mine, recent: [lead()] });
  assert.deepStrictEqual(d, { action: "update", id: "mine" });
});

check("a token pointing at a converted (paid) row is ignored", () => {
  const paid = lead({ id: "paid", tenantId: "t9", setupStatus: "tenant_created" });
  const d = decideLeadWrite({ whatsapp: "639998887777", now, tokenMatch: paid, recent: [] });
  assert.deepStrictEqual(d, { action: "insert" });
});

check("submissionReference = first 8 chars, uppercased", () => {
  assert.strictEqual(submissionReference("cmabc123xyz"), "CMABC123");
});

console.log("\nStore address preview (same derivation as the server)\n");

check("baseStoreSlug slugifies, and falls back to 'store' when unusable", () => {
  assert.strictEqual(baseStoreSlug("Glow Manila!"), "glow-manila");
  assert.strictEqual(baseStoreSlug("!!!"), "store");
  assert.strictEqual(baseStoreSlug("A"), "store");
});

check("pickStoreSlug avoids taken + reserved slugs", () => {
  assert.strictEqual(pickStoreSlug("Glow Manila", []), "glow-manila");
  assert.strictEqual(pickStoreSlug("Glow Manila", ["glow-manila"]), "glow-manila-2");
  assert.ok(RESERVED_STORE_SLUGS.has("admin"));
  assert.strictEqual(pickStoreSlug("Admin", []), "admin-2");
});

// ──────────────────────────── 5. wizard shape ────────────────────────────
console.log("\nWizard: pay first, details later\n");

check("pre-payment steps are business → package → checkout", () => {
  assert.deepStrictEqual(
    STEPS.map((s) => s.key),
    ["business", "package", "checkout"],
  );
});

check("post-payment optional steps are branding → products → orders → payments", () => {
  assert.deepStrictEqual(
    DETAILS_STEPS.map((s) => s.key),
    ["branding", "products", "orders", "payments"],
  );
});

const paid: Draft = {
  ...INITIAL_DRAFT,
  businessName: "Glow Manila",
  whatsapp: "639171234567",
  paidWithMethodId: "pp1",
  paymentProofUrl: "https://ik.imagekit.io/x/proof.jpg",
  termsAccepted: true,
  products: [],
  paymentMethods: [],
  orderDestinationValue: "",
};

check("checkout validates without any product / branding / order fields", () => {
  assert.deepStrictEqual(validateStep(2, paid), {});
});

check("checkout requires choosing which method you paid with", () => {
  const e = validateStep(2, { ...paid, paidWithMethodId: "" });
  assert.ok(e.paidWithMethodId, "expected a paidWithMethodId error");
});

check("checkout rejects a method id that isn't on offer", () => {
  const e = validateStep(2, paid, { methodIds: ["pp2"] });
  assert.ok(e.paidWithMethodId);
  assert.deepStrictEqual(validateStep(2, paid, { methodIds: ["pp1"] }), {});
});

check("the server schema accepts a sign-up with no details at all", () => {
  const r = onboardingSchema.safeParse({
    businessName: "Glow Manila",
    whatsapp: "639171234567",
    termsAccepted: true,
    paymentProofUrl: "https://x/y.jpg",
    paidWithMethodId: "pp1",
  });
  assert.ok(r.success, r.success ? "" : r.error.issues[0]?.message);
  assert.strictEqual(r.success && r.data.paidWithMethodId, "pp1");
});

check("draftToPayload carries paidWithMethodId", () => {
  assert.strictEqual(draftToPayload(paid).paidWithMethodId, "pp1");
});

const wizardSrc = read("src/components/onboarding/OnboardingWizard.tsx");
const stepsSrc = read("src/components/onboarding/steps/index.tsx");

check("wizard renders BusinessStep, PackageStep, CheckoutStep as the paid flow", () => {
  const m = wizardSrc.match(/const STEP_COMPONENTS = \[([\s\S]*?)\]/);
  assert.ok(m, "STEP_COMPONENTS not found");
  assert.deepStrictEqual(
    m![1].split(",").map((s) => s.trim()).filter(Boolean),
    ["BusinessStep", "PackageStep", "CheckoutStep"],
  );
});

check("post-payment steps offer a skip and a 'Send details' finish", () => {
  assert.ok(/Skip — we&apos;ll ask you on WhatsApp|Skip — we'll ask you on WhatsApp/.test(wizardSrc));
  assert.ok(/Send details/.test(wizardSrc));
  assert.ok(wizardSrc.includes("updateOnboardingDetailsAction"));
});

check("progress counts only the 3 pre-payment steps", () => {
  assert.ok(/STEPS\.length/.test(wizardSrc));
  assert.ok(!/DETAILS_STEPS\.length\s*\+\s*STEPS\.length|STEPS\.length\s*\+\s*DETAILS_STEPS\.length/.test(wizardSrc));
});

check("checkout step lets the client pick the method they paid with + shows the QR PH fee line", () => {
  assert.ok(stepsSrc.includes("paidWithMethodId"));
  assert.ok(/role="radiogroup"/.test(stepsSrc));
  assert.ok(stepsSrc.includes("QRPH_FEE_LABEL") || /QR PH processing fee/.test(stepsSrc));
  assert.ok(/qrphFee:/.test(stepsSrc), "checkoutQuote is not fed the qrph flag");
});

check("business step previews the store address via previewStoreSlugAction", () => {
  assert.ok(stepsSrc.includes("previewStoreSlugAction"));
});

check("wizard saves the lead on Continue and passes the lead token to submit", () => {
  assert.ok(wizardSrc.includes("saveOnboardingLeadAction"));
  assert.ok(/submitOnboardingAction\(draftToPayload\(draft\),\s*draft\.leadToken/.test(wizardSrc));
});

// ──────────────────────────── server + admin wiring ────────────────────────────
console.log("\nServer + admin wiring\n");

const actionSrc = read("src/actions/public-onboarding.ts");

check("submit resolves the chosen method server-side and re-derives the fee", () => {
  assert.ok(actionSrc.includes("getPackagePayment"));
  assert.ok(actionSrc.includes("Please choose how you paid."));
  assert.ok(/qrphFee:\s*/.test(actionSrc));
  assert.ok(actionSrc.includes("paidWithMethod"));
  assert.ok(actionSrc.includes("paymentFeeCents"));
});

check("public actions exist: lead, preview, details", () => {
  for (const fn of ["saveOnboardingLeadAction", "previewStoreSlugAction", "updateOnboardingDetailsAction"]) {
    assert.ok(new RegExp(`export async function ${fn}`).test(actionSrc), fn);
  }
  assert.ok(actionSrc.includes("detailsUpdateDecision"), "details action must use the pure guard");
  assert.ok(actionSrc.includes("hashAccessToken"), "only the token hash may be stored/queried");
});

check("schema gains the four new OnboardingSubmission columns", () => {
  const schema = read("prisma/schema.prisma");
  const model = schema.slice(schema.indexOf("model OnboardingSubmission"));
  const body = model.slice(0, model.indexOf("\n}"));
  assert.ok(/paidWithMethod\s+String\?/.test(body));
  assert.ok(/paymentFeeCents\s+Int\?/.test(body));
  assert.ok(/accessTokenHash\s+String\?\s+@unique/.test(body));
  assert.ok(/detailsSubmittedAt\s+DateTime\?/.test(body));
  assert.ok(/\blead\b/.test(body), "setupStatus comment should mention lead");
});

check("admin knows the 'lead' status and shows paid-with + details state", () => {
  const types = read("src/lib/admin/onboarding-types.ts");
  assert.ok(/"lead"/.test(types));
  assert.ok(/lead:\s*"Unpaid lead"/.test(types));
  const detail = read("src/components/admin/pages/OnboardingDetail.tsx");
  assert.ok(/Paid with/.test(detail));
  assert.ok(/Details submitted/.test(detail) && /Details pending/.test(detail));
});

check("platform WhatsApp contact is configured and linked", () => {
  assert.strictEqual(SITE.contactWhatsapp, "639058429200");
  assert.strictEqual(SITE.contactWhatsappDisplay, "0905 842 9200");
  assert.ok(wizardSrc.includes("SITE.contactWhatsapp") || wizardSrc.includes("WhatsAppContact"));
  assert.ok(/noopener noreferrer/.test(read("src/components/onboarding/WhatsAppContact.tsx")));
  assert.ok(read("src/app/(marketing)/marketing/layout.tsx").includes("contactWhatsapp"));
});

// ──────────────────────────── summary ────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
